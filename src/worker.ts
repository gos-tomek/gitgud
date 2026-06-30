import { handle } from "@astrojs/cloudflare/handler";
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { createServiceClient } from "@/lib/supabase-admin";
import { getGitHubToken, makeOctokit } from "@/lib/github";
import {
  listBoardRepos,
  listAndUpsertPrsForRepo,
  syncPrBatch,
  syncReviewCommentsForRepo,
  GQL_PRS_PER_QUERY,
} from "@/lib/services/github-sync";
import { classifyThreads, isBotComment } from "@/lib/services/classification";
import { logger } from "@/lib/logger";

// --- Workflow params --- //
// Single interface with optional fields — Cloudflare's Workflow generic expects one type,
// and discriminated unions break `Workflow.create({ params })` typing.

export interface ClassificationBatchParams {
  boardId: string;
  phase?: "dispatch" | "sync-repo" | "classify";
  // sync-repo fields (required when phase === "sync-repo")
  repoId?: string;
  owner?: string;
  repoName?: string;
  since?: string;
  syncStartedAt?: string;
}

// --- Constants --- //

const CLASSIFICATION_BATCH_SIZE = 50;
const DEFAULT_BACKFILL_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

// --- Helpers --- //

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

function describeError(err: unknown): string {
  if (typeof err === "object" && err !== null) {
    const obj = err as Record<string, unknown>;
    if (typeof obj.stack === "string") return obj.stack;
    if (typeof obj.message === "string") return obj.message;
    try {
      return JSON.stringify(obj, Object.getOwnPropertyNames(obj));
    } catch {
      // fall through
    }
  }
  return String(err);
}

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

// --- Workflow --- //

export class ClassificationBatchWorkflow extends WorkflowEntrypoint<Env, ClassificationBatchParams> {
  async run(event: WorkflowEvent<ClassificationBatchParams>, step: WorkflowStep) {
    const phase = event.payload.phase ?? "dispatch";
    switch (phase) {
      case "dispatch":
        return this.runDispatch(event, step);
      case "sync-repo":
        return this.runSyncRepo(event, step);
      case "classify":
        return this.runClassify(event, step);
    }
  }

  private async runDispatch(event: WorkflowEvent<ClassificationBatchParams>, step: WorkflowStep) {
    const { boardId } = event.payload;
    const supabase = createServiceClient(this.env.SUPABASE_URL, this.env.SUPABASE_SERVICE_KEY);

    const syncStartedAt = await runStep(step, "read-sync-state", () => Promise.resolve(new Date().toISOString()));

    const repos = await runStep(step, "list-board-repos", () => listBoardRepos(supabase, boardId));

    // Use ms-precision timestamp so each dispatch run gets unique child IDs.
    // dateStamp (per-day) caused silent failures when the same repo was synced twice in one day.
    const syncStamp = new Date(syncStartedAt).getTime();

    await runStep(step, "spawn-children", async () => {
      const spawned: string[] = [];

      for (const repo of repos) {
        const since = repo.last_synced_at ?? new Date(Date.now() - DEFAULT_BACKFILL_WINDOW_MS).toISOString();
        const id = `sync-${repo.id}-${syncStamp}`;
        try {
          await this.env.CLASSIFICATION_BATCH.create({
            id,
            params: {
              boardId,
              phase: "sync-repo",
              repoId: repo.id,
              owner: repo.repo_owner,
              repoName: repo.repo_name,
              since,
              syncStartedAt,
            },
          });
          spawned.push(id);
        } catch (err) {
          logger.error(`[dispatch] Failed to spawn sync for repo ${repo.repo_owner}/${repo.repo_name}`, err);
        }
      }

      return { spawned };
    });
  }

  // Phase 2: sync PR details + review comments for one repo.
  // Steps: get-token, list-and-upsert-prs, sleep, sync-pr-details, sleep, sync-review-comments-0..N, update-last-synced, spawn-classify.
  // Each instance starts fresh — no replay overhead from the dispatcher.
  private async runSyncRepo(event: WorkflowEvent<ClassificationBatchParams>, step: WorkflowStep) {
    const { boardId, repoId, owner, repoName, since, syncStartedAt } = event.payload;
    if (!repoId || !owner || !repoName || !since || !syncStartedAt) {
      throw new Error("sync-repo phase requires repoId, owner, repoName, since, syncStartedAt");
    }

    const supabase = createServiceClient(this.env.SUPABASE_URL, this.env.SUPABASE_SERVICE_KEY);

    const githubToken = await runStep(step, "get-github-token", () =>
      getGitHubToken(supabase, boardId, this.env.GITHUB_TOKEN_ENCRYPTION_KEY),
    );
    const octokit = makeOctokit(githubToken);

    const repoRow = { id: repoId, repo_owner: owner, repo_name: repoName, last_synced_at: null };
    const sinceDate = new Date(since);

    const prs = await runStep(step, "list-and-upsert-prs", () =>
      listAndUpsertPrsForRepo(supabase, octokit, repoRow, sinceDate, Number.POSITIVE_INFINITY),
    );

    await step.sleep("budget-reset-before-details", "1 second");

    const prChunks = chunk(prs, GQL_PRS_PER_QUERY);
    for (let i = 0; i < prChunks.length; i++) {
      const batchResult = await runStep(step, `sync-pr-details-${i}`, async () => {
        return syncPrBatch(supabase, octokit, owner, repoName, prChunks[i]);
      });
      if (i < prChunks.length - 1) {
        // 10 s baseline keeps the GQL request rate low enough to avoid GitHub's secondary rate
        // limit (which manifests as the connection being held open until our 60 s AbortSignal
        // fires). 30 s on errors gives the throttle window time to fully reset.
        await step.sleep(`budget-reset-details-${i}`, batchResult.errors.length > 0 ? "30 seconds" : "10 seconds");
      }
    }

    await step.sleep("budget-reset-before-reviews", "1 second");

    let reviewSince = sinceDate;
    for (let p = 0; ; p++) {
      const result = await runStep(step, `sync-review-comments-${p}`, async () => {
        const { comments, nextSince } = await syncReviewCommentsForRepo(
          supabase,
          octokit,
          repoId,
          owner,
          repoName,
          reviewSince,
          25,
        );
        return { comments, nextSince: nextSince?.toISOString() ?? null };
      });
      if (!result.nextSince) break;
      reviewSince = new Date(result.nextSince);
      await step.sleep(`budget-reset-review-${p}`, "1 second");
    }

    await runStep(step, "update-last-synced", async () => {
      const { error } = await supabase.from("github_repos").update({ last_synced_at: syncStartedAt }).eq("id", repoId);
      if (error) throw error;
      return { updated: true };
    });

    const syncStamp = new Date(syncStartedAt).getTime();
    await runStep(step, "spawn-classify", async () => {
      try {
        const classifyId = `classify-${boardId}-${repoId}-${syncStamp}`;
        await this.env.CLASSIFICATION_BATCH.create({
          id: classifyId,
          params: { boardId, phase: "classify" },
        });
        return { classifyId };
      } catch (err) {
        logger.error(`[sync-repo] Failed to spawn classify for board ${boardId} repo ${repoId}`, err);
        return { classifyId: null };
      }
    });
  }

  // Phase 3: classify unprocessed review threads.
  // Starts fresh — no replay from sync phases.
  private async runClassify(event: WorkflowEvent<ClassificationBatchParams>, step: WorkflowStep) {
    const { boardId } = event.payload;
    const supabase = createServiceClient(this.env.SUPABASE_URL, this.env.SUPABASE_SERVICE_KEY);

    const threadRootIds = await runStep(step, "fetch-unclassified", async () => {
      const result = await supabase.rpc("get_unclassified_root_comments_for_board", { p_board_id: boardId });
      if (result.error) throw result.error;
      return (result.data as UnclassifiedRootCommentRow[])
        .filter((row) => !isBotComment(row.commenter_login))
        .map((row) => row.id);
    });

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
