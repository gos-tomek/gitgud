import { handle } from "@astrojs/cloudflare/handler";
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { createServiceClient } from "@/lib/supabase-admin";
import { getGitHubToken, makeOctokit } from "@/lib/github";
import {
  listBoardRepos,
  listAndUpsertPrsForRepo,
  syncPrBatch,
  syncReviewCommentsForRepo,
  type PrRef,
} from "@/lib/services/github-sync";
import { classifyThreads, isBotComment } from "@/lib/services/classification";
import { logger } from "@/lib/logger";

export interface ClassificationBatchParams {
  boardId: string;
}

const CLASSIFICATION_BATCH_SIZE = 50;

// First-ever sync for a repo has no `last_synced_at` to anchor `since` on. Bound it to 90 days
// instead of true full history — even 90 days of a very active repo (e.g. ~2,375 PRs for
// supabase/supabase) can approach the 5000 req/hr GitHub primary rate limit at ~3 requests/PR;
// unbounded history is never feasible in a single run. See `check-rate-limit-*` steps below for
// how a window that still exceeds the limit gets handled.
const DEFAULT_BACKFILL_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

// All PRs for a repo are processed in a single syncPrBatch call. With GQL_PRS_PER_QUERY=500,
// 2700 PRs = 6 GraphQL batches ≈ 20 subrequests (6 GQL + overflow + Supabase writes) — well
// within the 50-subrequest free-plan budget. Avoiding per-chunk steps/sleeps is critical because
// each completed Workflow step adds replay overhead on every Workflow restart, and with ~18
// chunks the replay cost alone exceeded the budget before any new work could begin.

interface UnclassifiedRootCommentRow {
  id: number;
  commenter_login: string;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

// `err instanceof Error` can be false even for a genuine Error if it crossed a realm boundary
// inside workerd's Workflow step plumbing — `message`/`stack` are real but the prototype isn't
// our `Error`. Duck-type instead of relying on instanceof, with JSON.stringify(getOwnPropertyNames)
// as a last resort since `message`/`stack` are non-enumerable (a plain JSON.stringify gives "{}").
function describeError(err: unknown): string {
  if (typeof err === "object" && err !== null) {
    const obj = err as Record<string, unknown>;
    if (typeof obj.stack === "string") return obj.stack;
    if (typeof obj.message === "string") return obj.message;
    try {
      return JSON.stringify(obj, Object.getOwnPropertyNames(obj));
    } catch {
      // fall through to String(err) below
    }
  }
  return String(err);
}

// Workflows serialize step.do callback errors across an internal RPC boundary; on some
// wrangler/workerd versions the original Error prototype/message is lost by the time it
// reaches the top-level inspector, surfacing only as "Uncaught #<Object>". Logging the real
// message/stack here (a plain console call, not subject to that boundary) keeps `wrangler dev`
// / `wrangler tail` output diagnosable regardless.
function runStep<T extends Rpc.Serializable<T>>(step: WorkflowStep, name: string, fn: () => Promise<T>): Promise<T> {
  return step.do(name, async () => {
    try {
      return await fn();
    } catch (err) {
      logger.error(`[classification-batch] Step "${name}" failed: ${describeError(err)}`);
      throw err;
    }
  });
}

interface RepoSyncTarget {
  repoId: string;
  owner: string;
  repoName: string;
  since: string;
  prs: PrRef[];
}

export class ClassificationBatchWorkflow extends WorkflowEntrypoint<Env, ClassificationBatchParams> {
  async run(event: WorkflowEvent<ClassificationBatchParams>, step: WorkflowStep) {
    const { boardId } = event.payload;
    const supabase = createServiceClient(this.env.SUPABASE_URL, this.env.SUPABASE_SERVICE_KEY);

    // Cache the decrypted PAT in a durable step so restarts don't burn a subrequest on every
    // `run()` resume. Octokit itself isn't serializable, but the token string is.
    const githubToken = await runStep(step, "get-github-token", () =>
      getGitHubToken(supabase, boardId, this.env.GITHUB_TOKEN_ENCRYPTION_KEY),
    );
    const octokit = makeOctokit(githubToken);

    // One shared timestamp for every repo's `last_synced_at` write this run, read durably once so
    // retries of later steps don't drift it forward.
    const syncStartedAt = await runStep(step, "read-sync-state", () => Promise.resolve(new Date().toISOString()));

    // `since` is tracked per repo (`github_repos.last_synced_at`), not per board — `since` is a
    // GitHub API parameter scoped to one repo, and a board could gain a repo later with its own
    // independent sync history that a shared board-level cursor would silently under-backfill.
    const repos = await runStep(step, "list-board-repos", () => listBoardRepos(supabase, boardId));

    // One durable step per repo (not one step for all repos) — a board with many repos could
    // otherwise make thousands of GitHub requests in a single step.do and lose all listing
    // progress on failure, retrying every repo from scratch instead of just the failed one.
    const targets: RepoSyncTarget[] = [];
    for (let r = 0; r < repos.length; r++) {
      const repo = repos[r];
      const target = await runStep(step, `sync-list-prs-${r}`, async () => {
        const since = repo.last_synced_at
          ? new Date(repo.last_synced_at)
          : new Date(Date.now() - DEFAULT_BACKFILL_WINDOW_MS);
        const prs = await listAndUpsertPrsForRepo(supabase, octokit, repo, since, Number.POSITIVE_INFINITY);
        return {
          repoId: repo.id,
          owner: repo.repo_owner,
          repoName: repo.repo_name,
          since: since.toISOString(),
          prs,
        };
      });
      targets.push(target);
    }

    // Free-plan Workers have 50 subrequests per invocation, shared across ALL steps that
    // execute in one invocation. The listing phase above uses ~28 subrequests for a large
    // repo (27 REST pages + 1 upsert), leaving only ~22 for subsequent chunks — not enough.
    // step.sleep creates a durable checkpoint; when the sleep expires, Cloudflare resumes
    // the Workflow in a NEW invocation with a fresh 50-subrequest budget.
    await step.sleep("budget-reset-after-listing", "1 second");

    for (let r = 0; r < targets.length; r++) {
      const { repoId, owner, repoName, since, prs } = targets[r];

      await runStep(step, `sync-pr-details-${r}`, async () => {
        return syncPrBatch(supabase, octokit, owner, repoName, prs);
      });

      // Review comment steps use up to 47 subrequests each — almost the full free-plan
      // budget. Force a new invocation so they don't share budget with preceding chunks.
      await step.sleep(`budget-reset-before-reviews-${r}`, "1 second");

      // 45 pages × 1 REST subrequest + 1 mapPrNumbersToIds + 1 upsert = 47 subrequests/step —
      // safely under the Free-plan cap of 50. On repos with >4 500 review comments per sync
      // window each continuation step picks up where the previous one stopped via the cursor.
      let reviewSince = new Date(since);
      for (let p = 0; ; p++) {
        const result = await runStep(step, `sync-review-comments-${r}-${p}`, async () => {
          const { comments, nextSince } = await syncReviewCommentsForRepo(
            supabase,
            octokit,
            repoId,
            owner,
            repoName,
            reviewSince,
            45,
          );
          return { comments, nextSince: nextSince?.toISOString() ?? null };
        });
        if (!result.nextSince) break;
        reviewSince = new Date(result.nextSince);
      }

      await runStep(step, `update-last-synced-${r}`, async () => {
        const updateResult = await supabase
          .from("github_repos")
          .update({ last_synced_at: syncStartedAt })
          .eq("id", repoId);
        if (updateResult.error) throw updateResult.error;
        return { updated: true };
      });
    }

    const threadRootIds = await runStep(step, "fetch-unclassified", async () => {
      const result = await supabase.rpc("get_unclassified_root_comments_for_board", { p_board_id: boardId });
      if (result.error) throw result.error;
      return (result.data as UnclassifiedRootCommentRow[])
        .filter((row) => !isBotComment(row.commenter_login))
        .map((row) => row.id);
    });

    // Store each batch's results immediately after it classifies, rather than accumulating
    // everything in memory for one trailing upsert. AI calls cost real money — banking each
    // batch's results into `thread_classifications` right away means a manual termination or a
    // later batch's permanent failure only loses that one batch's spend, not every batch that
    // already succeeded in this run.
    const batches = chunk(threadRootIds, CLASSIFICATION_BATCH_SIZE);
    for (let i = 0; i < batches.length; i++) {
      const batchResults = await runStep(step, `classify-batch-${i}`, async () => {
        return classifyThreads(this.env.AI, supabase, batches[i]);
      });

      await runStep(step, `store-results-${i}`, async () => {
        if (batchResults.length === 0) return { stored: 0 };
        const { error } = await supabase
          .from("thread_classifications")
          .upsert(batchResults, { onConflict: "thread_root_comment_id" });
        if (error) throw error;
        return { stored: batchResults.length };
      });
    }
  }
}

export default {
  fetch: handle,
  async scheduled(_controller, env, _ctx) {
    const supabase = createServiceClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);

    const { data, error } = await supabase.from("github_repos").select("board_id");
    if (error) {
      logger.error("[classification-batch] Failed to query active boards", error);
      return;
    }

    const boardIds = [...new Set((data as { board_id: string }[]).map((row) => row.board_id))];
    const dateStamp = new Date().toISOString().slice(0, 10);

    await Promise.all(
      boardIds.map((boardId) =>
        env.CLASSIFICATION_BATCH.create({ id: `board-${boardId}-${dateStamp}`, params: { boardId } }).catch(
          (err: unknown) => {
            logger.error(`[classification-batch] Failed to dispatch Workflow for board ${boardId}`, err);
          },
        ),
      ),
    );
  },
} satisfies ExportedHandler<Env>;
