import { handle } from "@astrojs/cloudflare/handler";
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { createServiceClient } from "@/lib/supabase-admin";
import { createGitHubClient } from "@/lib/github";
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

// Per-PR enrichment (detail + reviews) costs ~2 GitHub requests/PR. Chunking keeps each durable
// step's worst-case cost bounded so a `check-rate-limit-*` step run right before it can decide
// whether to sleep until the quota resets instead of burning through it mid-chunk.
const PR_DETAIL_CHUNK_SIZE = 150;

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

    // Octokit isn't Rpc.Serializable (it's a client instance, not plain data) so it can't be
    // returned from a step.do and reused in later steps — build it once here, outside any step,
    // like `supabase` above. It gets rebuilt (cheap: one PAT-decrypt RPC) on every `run()` resume.
    const octokit = await createGitHubClient(supabase, boardId, this.env.GITHUB_TOKEN_ENCRYPTION_KEY);

    // One shared timestamp for every repo's `last_synced_at` write this run, read durably once so
    // retries of later steps don't drift it forward.
    const syncStartedAt = await runStep(step, "read-sync-state", () => Promise.resolve(new Date().toISOString()));

    // `since` is tracked per repo (`github_repos.last_synced_at`), not per board — `since` is a
    // GitHub API parameter scoped to one repo, and a board could gain a repo later with its own
    // independent sync history that a shared board-level cursor would silently under-backfill.
    const targets = await runStep(step, "sync-list-prs", async () => {
      const repos = await listBoardRepos(supabase, boardId);
      const result: RepoSyncTarget[] = [];
      for (const repo of repos) {
        const since = repo.last_synced_at
          ? new Date(repo.last_synced_at)
          : new Date(Date.now() - DEFAULT_BACKFILL_WINDOW_MS);
        const prs = await listAndUpsertPrsForRepo(supabase, octokit, repo, since, Number.POSITIVE_INFINITY);
        result.push({
          repoId: repo.id,
          owner: repo.repo_owner,
          repoName: repo.repo_name,
          since: since.toISOString(),
          prs,
        });
      }
      return result;
    });

    for (let r = 0; r < targets.length; r++) {
      const { repoId, owner, repoName, since, prs } = targets[r];
      const prChunks = chunk(prs, PR_DETAIL_CHUNK_SIZE);

      for (let c = 0; c < prChunks.length; c++) {
        const rateLimit = await runStep(step, `check-rate-limit-${r}-${c}`, async () => {
          const { data } = await octokit.rest.rateLimit.get();
          return { remaining: data.resources.core.remaining, reset: data.resources.core.reset };
        });

        // 2 GitHub requests/PR (detail + reviews) — sleep until the window resets rather than
        // burning the rest of the budget mid-chunk and falling into the same retry-from-scratch
        // loop a plain step.do retry would cause.
        if (rateLimit.remaining < prChunks[c].length * 2) {
          await step.sleepUntil(`wait-for-rate-limit-${r}-${c}`, new Date(rateLimit.reset * 1000));
        }

        await runStep(step, `sync-pr-details-${r}-${c}`, async () => {
          return syncPrBatch(supabase, octokit, owner, repoName, prChunks[c]);
        });
      }

      await runStep(step, `sync-review-comments-${r}`, async () => {
        return syncReviewCommentsForRepo(supabase, octokit, repoId, owner, repoName, new Date(since));
      });

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
