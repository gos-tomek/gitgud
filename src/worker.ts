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
  type PrRef,
} from "@/lib/services/github-sync";
import { classifyThreads, isBotComment } from "@/lib/services/classification";
import { logger } from "@/lib/logger";

// --- Workflow params --- //
// Single interface with optional fields — Cloudflare's Workflow generic expects one type,
// and discriminated unions break `Workflow.create({ params })` typing.

export interface ClassificationBatchParams {
  boardId: string;
  phase?: "dispatch" | "sync-repo" | "orchestrate" | "prdetails" | "reviews" | "classify" | "classify-chunk";
  // sync-repo / prdetails / reviews fields
  repoId?: string;
  owner?: string;
  repoName?: string;
  since?: string;
  syncStartedAt?: string;
  // prdetails: slice of PRs for this chunk
  prChunk?: PrRef[];
  chunkIndex?: number;
  // reviews: page index for chained review instances
  reviewPageIndex?: number;
  // classify: pre-fetched thread root IDs for recursive dispatcher (avoids re-querying DB)
  threadRootIds?: number[];
  // classify-chunk: slice of thread root IDs for this chunk
  threadChunk?: number[];
}

// --- Constants --- //

const CLASSIFICATION_BATCH_SIZE = 48;
const CLASSIFY_MAX_SPAWNS_PER_DISPATCHER = 45;
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

function runStep<T extends Rpc.Serializable<T>>(
  step: WorkflowStep,
  name: string,
  fn: () => Promise<T>,
  config?: Parameters<WorkflowStep["do"]>[1],
): Promise<T> {
  return step.do(name, config ?? {}, async () => {
    try {
      return await fn();
    } catch (err) {
      const message = `Step "${name}" failed: ${describeError(err)}`;
      logger.error(`[classification-batch] ${message}`);
      throw new Error(message);
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
      case "orchestrate":
        return this.runOrchestrate(event, step);
      case "prdetails":
        return this.runPrDetails(event, step);
      case "reviews":
        return this.runReviews(event, step);
      case "classify":
        return this.runClassify(event, step);
      case "classify-chunk":
        return this.runClassifyChunk(event, step);
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
        const id = `repo-${repo.id}-${syncStamp}`;
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

  // Phase 2: list PRs and hand off to orchestrate. Separated because listing alone can
  // consume 20+ external subs (REST pagination + Supabase), and Workflow.create() also
  // counts as an external sub — doing both in one invocation exceeds the free-plan 50-sub limit.
  private async runSyncRepo(event: WorkflowEvent<ClassificationBatchParams>, step: WorkflowStep) {
    const { boardId, repoId, owner, repoName, since, syncStartedAt } = event.payload;
    if (!repoId || !owner || !repoName || !since || !syncStartedAt) {
      throw new Error("sync-repo phase requires repoId, owner, repoName, since, syncStartedAt");
    }

    const supabase = createServiceClient(this.env.SUPABASE_URL, this.env.SUPABASE_SERVICE_KEY);
    const githubToken = await getGitHubToken(supabase, boardId, this.env.GITHUB_TOKEN_ENCRYPTION_KEY);
    const octokit = makeOctokit(githubToken);

    const repoRow = { id: repoId, repo_owner: owner, repo_name: repoName, last_synced_at: null };
    const sinceDate = new Date(since);
    const syncStamp = new Date(syncStartedAt).getTime();

    const prs = await runStep(step, "list-and-upsert-prs", () =>
      listAndUpsertPrsForRepo(supabase, octokit, repoRow, sinceDate, Number.POSITIVE_INFINITY),
    );

    logger.info(`[sync-repo] ${owner}/${repoName}: ${prs.length} PRs listed`);

    if (prs.length === 0) {
      await runStep(step, "update-last-synced", async () => {
        const { error } = await supabase
          .from("github_repos")
          .update({ last_synced_at: syncStartedAt })
          .eq("id", repoId);
        if (error) throw error;
        return { updated: true };
      });
      await runStep(step, "spawn-classify", async () => {
        const classifyId = `classify-${boardId}-${syncStamp}`;
        await this.env.CLASSIFICATION_BATCH.create({
          id: classifyId,
          params: { boardId, phase: "classify" },
        });
        return { classifyId };
      });
      return;
    }

    await runStep(step, "spawn-orchestrate", async () => {
      const orchestrateId = `orchestrate-${repoId}-${syncStamp}`;
      await this.env.CLASSIFICATION_BATCH.create({
        id: orchestrateId,
        params: {
          boardId,
          phase: "orchestrate",
          repoId,
          owner,
          repoName,
          since,
          syncStartedAt,
        },
      });
      return { orchestrateId };
    });
  }

  // Phase 2b: orchestrate — spawns prdetails children + reviews, all fire-and-forget.
  // No polling: .get()/.status() are also external subs, so polling N children burns 2N subs
  // per attempt — impossible on the free plan. Instead, prdetails and reviews run concurrently;
  // the last reviews instance finalizes (update-last-synced + classify). Classify works on
  // whatever data is in DB, so slow prdetails chunks get classified on the next sync cycle.
  private async runOrchestrate(event: WorkflowEvent<ClassificationBatchParams>, step: WorkflowStep) {
    const { boardId, repoId, owner, repoName, since, syncStartedAt } = event.payload;
    if (!repoId || !owner || !repoName || !since || !syncStartedAt) {
      throw new Error("orchestrate phase requires repoId, owner, repoName, since, syncStartedAt");
    }

    const supabase = createServiceClient(this.env.SUPABASE_URL, this.env.SUPABASE_SERVICE_KEY);
    const sinceDate = new Date(since);
    const syncStamp = new Date(syncStartedAt).getTime();

    // Re-read PR refs from DB — they were upserted by the sync-repo instance.
    const prs = await runStep(step, "read-pr-refs", async () => {
      const PAGE = 1000;
      const all: PrRef[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from("github_pull_requests")
          .select("id,number")
          .eq("repo_id", repoId)
          .gte("updated_at", sinceDate.toISOString())
          .range(from, from + PAGE - 1);
        if (error) throw new Error(`read-pr-refs page ${from / PAGE + 1}: ${error.message}`);
        all.push(...(data as PrRef[]));
        if (data.length < PAGE) break;
      }
      return all;
    });

    const prChunks = chunk(prs, GQL_PRS_PER_QUERY);
    logger.info(
      `[orchestrate] ${owner}/${repoName}: ${prs.length} PRs in ${prChunks.length} chunk(s) of ${GQL_PRS_PER_QUERY}`,
    );

    await runStep(step, "spawn-prdetails", async () => {
      const ids: string[] = [];
      for (let i = 0; i < prChunks.length; i++) {
        const id = `prdetails-${repoId}-${i}-${syncStamp}`;
        await this.env.CLASSIFICATION_BATCH.create({
          id,
          params: {
            boardId,
            phase: "prdetails",
            repoId,
            owner,
            repoName,
            syncStartedAt,
            prChunk: prChunks[i],
            chunkIndex: i,
          },
        });
        ids.push(id);
      }
      logger.info(`[orchestrate] ${owner}/${repoName}: spawned ${ids.length} prdetails instance(s)`);
      return ids;
    });

    await runStep(step, "spawn-reviews", async () => {
      const reviewsId = `reviews-${repoId}-0-${syncStamp}`;
      await this.env.CLASSIFICATION_BATCH.create({
        id: reviewsId,
        params: {
          boardId,
          phase: "reviews",
          repoId,
          owner,
          repoName,
          since,
          syncStartedAt,
          reviewPageIndex: 0,
        },
      });
      return { reviewsId };
    });
  }

  // Phase 3: enrich one chunk of PRs with size stats + reviews via GraphQL.
  // Own invocation = own 50-subrequest budget (~4-6 external subs per chunk).
  private async runPrDetails(event: WorkflowEvent<ClassificationBatchParams>, step: WorkflowStep) {
    const { boardId, repoId, owner, repoName, prChunk, chunkIndex } = event.payload;
    if (!repoId || !owner || !repoName || !prChunk || chunkIndex === undefined) {
      throw new Error("prdetails phase requires repoId, owner, repoName, prChunk, chunkIndex");
    }

    const supabase = createServiceClient(this.env.SUPABASE_URL, this.env.SUPABASE_SERVICE_KEY);
    const githubToken = await getGitHubToken(supabase, boardId, this.env.GITHUB_TOKEN_ENCRYPTION_KEY);
    const octokit = makeOctokit(githubToken);

    logger.info(`[prdetails] ${owner}/${repoName}: chunk ${chunkIndex} — ${prChunk.length} PRs`);

    await runStep(step, "sync-pr-details", async () => syncPrBatch(supabase, octokit, owner, repoName, prChunk), {
      retries: { limit: 0, delay: "1 second" },
    });
  }

  // Phase 4: sync review comments for one repo. Each instance processes up to 25 REST pages.
  // If truncated, chains to the next reviews instance. The last instance (not truncated)
  // finalizes: update-last-synced + spawn classify.
  private async runReviews(event: WorkflowEvent<ClassificationBatchParams>, step: WorkflowStep) {
    const { boardId, repoId, owner, repoName, since, syncStartedAt, reviewPageIndex } = event.payload;
    if (!repoId || !owner || !repoName || !since || !syncStartedAt || reviewPageIndex === undefined) {
      throw new Error("reviews phase requires repoId, owner, repoName, since, syncStartedAt, reviewPageIndex");
    }

    const supabase = createServiceClient(this.env.SUPABASE_URL, this.env.SUPABASE_SERVICE_KEY);
    const githubToken = await getGitHubToken(supabase, boardId, this.env.GITHUB_TOKEN_ENCRYPTION_KEY);
    const octokit = makeOctokit(githubToken);

    logger.info(`[reviews] ${owner}/${repoName}: page index ${reviewPageIndex}`);

    const result = await runStep(
      step,
      "sync-review-comments",
      async () => {
        const { comments, nextSince } = await syncReviewCommentsForRepo(
          supabase,
          octokit,
          repoId,
          owner,
          repoName,
          new Date(since),
          25,
        );
        return { comments, nextSince: nextSince?.toISOString() ?? null };
      },
      { retries: { limit: 0, delay: "1 second" } },
    );

    const syncStamp = new Date(syncStartedAt).getTime();

    const { nextSince } = result;
    if (nextSince) {
      const nextIdx = reviewPageIndex + 1;
      await runStep(step, "spawn-next-reviews", async () => {
        const id = `reviews-${repoId}-${nextIdx}-${syncStamp}`;
        await this.env.CLASSIFICATION_BATCH.create({
          id,
          params: {
            boardId,
            phase: "reviews",
            repoId,
            owner,
            repoName,
            since: nextSince,
            syncStartedAt,
            reviewPageIndex: nextIdx,
          },
        });
        logger.info(`[reviews] ${owner}/${repoName}: chained to reviews page ${nextIdx}`);
        return { nextReviewsId: id };
      });
    } else {
      await runStep(step, "update-last-synced", async () => {
        const { error } = await supabase
          .from("github_repos")
          .update({ last_synced_at: syncStartedAt })
          .eq("id", repoId);
        if (error) throw error;
        return { updated: true };
      });

      await runStep(step, "spawn-classify", async () => {
        try {
          const classifyId = `classify-${boardId}-${syncStamp}`;
          await this.env.CLASSIFICATION_BATCH.create({
            id: classifyId,
            params: { boardId, phase: "classify" },
          });
          return { classifyId };
        } catch (err) {
          logger.error(`[reviews] Failed to spawn classify for board ${boardId} repo ${repoId}`, err);
          return { classifyId: null };
        }
      });
    }
  }

  // Phase 5: classify dispatcher — fetches unclassified thread IDs, chunks them,
  // and spawns classify-chunk instances (fire-and-forget). Each chunk gets its own
  // 50-subrequest budget. When there are more chunks than one dispatcher can spawn
  // (50-subrequest limit), it spawns a recursive dispatcher with the remaining IDs.
  private async runClassify(event: WorkflowEvent<ClassificationBatchParams>, step: WorkflowStep) {
    const { boardId } = event.payload;

    let allThreadIds: number[];
    if (event.payload.threadRootIds && event.payload.threadRootIds.length > 0) {
      allThreadIds = event.payload.threadRootIds;
      logger.info(`[classify] board ${boardId}: recursive dispatcher received ${allThreadIds.length} thread IDs`);
    } else {
      const supabase = createServiceClient(this.env.SUPABASE_URL, this.env.SUPABASE_SERVICE_KEY);
      allThreadIds = await runStep(step, "fetch-unclassified", async () => {
        const result = await supabase.rpc("get_unclassified_root_comments_for_board", { p_board_id: boardId });
        if (result.error) throw result.error;
        return (result.data as UnclassifiedRootCommentRow[])
          .filter((row) => !isBotComment(row.commenter_login))
          .map((row) => row.id);
      });
    }

    if (allThreadIds.length === 0) return;

    const batches = chunk(allThreadIds, CLASSIFICATION_BATCH_SIZE);
    const spawnBatch = batches.slice(0, CLASSIFY_MAX_SPAWNS_PER_DISPATCHER);
    const remaining = batches.slice(CLASSIFY_MAX_SPAWNS_PER_DISPATCHER);

    await runStep(step, "spawn-classify-chunks", async () => {
      const ids: string[] = [];
      for (let i = 0; i < spawnBatch.length; i++) {
        const id = `classify-chunk-${boardId}-${i}-${Date.now()}`;
        await this.env.CLASSIFICATION_BATCH.create({
          id,
          params: { boardId, phase: "classify-chunk", threadChunk: spawnBatch[i], chunkIndex: i },
        });
        ids.push(id);
      }
      if (remaining.length > 0) {
        const remainingIds = remaining.flat();
        const dispatcherId = `classify-dispatch-${boardId}-${Date.now()}`;
        await this.env.CLASSIFICATION_BATCH.create({
          id: dispatcherId,
          params: { boardId, phase: "classify", threadRootIds: remainingIds },
        });
        logger.info(
          `[classify] board ${boardId}: spawned ${ids.length} chunk(s) + recursive dispatcher for ${remainingIds.length} remaining threads`,
        );
      } else {
        logger.info(`[classify] board ${boardId}: spawned ${ids.length} classify-chunk instance(s)`);
      }
      return ids;
    });
  }

  // Phase 5b: classify one chunk of threads. Own invocation = own 50-subrequest budget.
  private async runClassifyChunk(event: WorkflowEvent<ClassificationBatchParams>, step: WorkflowStep) {
    const { threadChunk, chunkIndex } = event.payload;
    if (!threadChunk || chunkIndex === undefined) {
      throw new Error("classify-chunk phase requires threadChunk, chunkIndex");
    }

    const supabase = createServiceClient(this.env.SUPABASE_URL, this.env.SUPABASE_SERVICE_KEY);

    const batchResults = await runStep(
      step,
      "classify-batch",
      async () => {
        return classifyThreads(this.env.AI, supabase, threadChunk);
      },
      { retries: { limit: 0, delay: "1 second" } },
    );

    await runStep(step, "store-results", async () => {
      if (batchResults.length === 0) return { stored: 0 };
      const { error } = await supabase
        .from("thread_classifications")
        .upsert(batchResults, { onConflict: "thread_root_comment_id" });
      if (error) throw error;
      return { stored: batchResults.length };
    });
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
