import type { Octokit } from "@octokit/rest";
import type { createClient } from "@/lib/supabase";
import { createGitHubClient } from "@/lib/github";
import { logger } from "@/lib/logger";

// Default cap protecting the in-request API route from Worker timeouts. The
// classification-batch Workflow lifts this via `maxPrsPerRepo: Number.POSITIVE_INFINITY`
// since durable steps have no such timeout constraint.
const MAX_PRS_PER_REPO = 200;

// PRs batched per GraphQL query via field aliases. GitHub's node ceiling is 500,000 per query;
// 25 PRs × 100 review nodes = 2,500 nodes — well within the limit. Kept small so the GitHub
// server can respond within the 60s per-request timeout even for PRs with many reviews.
// Exported so worker.ts can chunk prs[] into one-batch-per-step slices of this size.
export const GQL_PRS_PER_QUERY = 25;

// Maximum extra GQL calls per GQL batch for paginating beyond the first 100 review nodes.
// Free-plan budget is 50 subrequests per invocation, shared across ALL steps in one invocation.
// After a step.sleep checkpoint, the chunk phase starts with a fresh ~49 budget (50 minus
// createGitHubClient). Each chunk uses 1 (rate-limit) + 1 (GQL) + overflow + 1 (RPC) + 1 (upsert).
// With MAX_OVERFLOW_ROUNDS=2: worst case 6 per chunk, fitting ~8 chunks before re-throw → retry.
const MAX_OVERFLOW_ROUNDS = 2;

type SupabaseClient = NonNullable<ReturnType<typeof createClient>>;

// Supabase PostgrestError objects are not Error instances (different prototype) — duck-type
// for .message before falling back to JSON or String().
function describeError(err: unknown): string {
  if (typeof err === "object" && err !== null) {
    const obj = err as Record<string, unknown>;
    if (typeof obj.message === "string") return obj.message;
    try {
      return JSON.stringify(obj, Object.getOwnPropertyNames(obj));
    } catch {
      // fall through
    }
  }
  return String(err);
}

// Retry a GQL call on transient 502s (Bad Gateway from GitHub).
// Re-throws immediately on subrequest budget errors and non-502 failures.
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  const delays = [500, 1000];
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const desc = describeError(err);
      if (desc.includes("Too many subrequests")) throw err;
      if (attempt >= delays.length || !desc.includes("502")) throw err;
      await new Promise<void>((resolve) => setTimeout(resolve, delays[attempt]));
    }
  }
}

export interface SyncResult {
  repos: number;
  pullRequests: number;
  reviews: number;
  comments: number;
  errors: string[];
}

export interface SyncOptions {
  since?: Date;
  /** Pre-built Octokit instance — skips internal `createGitHubClient` (used by the Workflow, which already decrypted the PAT). */
  octokit?: Octokit;
  /** Overrides MAX_PRS_PER_REPO. Pass `Number.POSITIVE_INFINITY` to lift the cap entirely. */
  maxPrsPerRepo?: number;
  /** Forwarded to `createGitHubClient` when no `octokit` is provided. */
  encryptionKey?: string;
}

export type PrItem = Awaited<ReturnType<Octokit["rest"]["pulls"]["list"]>>["data"][number];
type RepoCommentItem = Awaited<ReturnType<Octokit["rest"]["pulls"]["listReviewCommentsForRepo"]>>["data"][number];

export interface RepoRow {
  id: string;
  repo_owner: string;
  repo_name: string;
  last_synced_at: string | null;
}

// Dedupe by id, keeping the last occurrence. A single multi-row `.upsert()` with two rows
// sharing a conflict key throws "ON CONFLICT DO UPDATE command cannot affect row a second
// time" — GitHub's `sort: updated, direction: desc` pagination has no stable cursor, so a PR
// updated mid-fetch can legitimately appear on two pages of a long (now uncapped) sync.
function dedupeById<T extends { id: number }>(items: T[]): T[] {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

async function upsertPullRequests(supabase: SupabaseClient, repoId: string, prs: PrItem[]): Promise<void> {
  if (prs.length === 0) return;
  const now = new Date().toISOString();
  const rows = dedupeById(prs).map((pr) => ({
    id: pr.id,
    repo_id: repoId,
    number: pr.number,
    title: pr.title,
    state: pr.merged_at ? "merged" : pr.state,
    author_login: pr.user?.login ?? "",
    author_github_id: pr.user?.id ?? 0,
    is_draft: pr.draft ?? false,
    created_at: pr.created_at,
    updated_at: pr.updated_at,
    merged_at: pr.merged_at ?? null,
    fetched_at: now,
  }));
  const { error } = await supabase.from("github_pull_requests").upsert(rows, { onConflict: "id" });
  if (error) throw error;
}

async function mapPrNumbersToIds(supabase: SupabaseClient, repoId: string): Promise<Map<number, number>> {
  // PostgREST caps single-request results at max-rows (typically 1000). Paginate to collect all
  // PRs so that review comments for repos with >1000 PRs aren't silently dropped.
  const PAGE = 1000;
  const all: { id: number; number: number }[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("github_pull_requests")
      .select("id,number")
      .eq("repo_id", repoId)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    all.push(...(data as { id: number; number: number }[]));
    if (data.length < PAGE) break;
  }
  return new Map(all.map((row) => [row.number, row.id]));
}

// `GET /repos/{owner}/{repo}/pulls/comments` lists review comments for the whole repo in one
// paginated, server-side `since`-filtered call — unlike per-PR `listReviewComments`, which costs
// one request per PR. Comments identify their PR via `pull_request_url` (a PR *number*, not the
// GitHub PR `id` our schema uses as FK), so we resolve numbers against already-synced PR rows.
export async function syncReviewCommentsForRepo(
  supabase: SupabaseClient,
  octokit: Octokit,
  repoId: string,
  owner: string,
  repoName: string,
  since?: Date,
  // Limits REST pages fetched per call so Workflow steps stay under the 50-subrequest budget
  // (1 mapPrNumbersToIds + maxPages REST pages + 1 upsert). When truncated, nextSince carries
  // the cursor — the caller re-invokes in a new step with since=nextSince to continue.
  maxPages?: number,
): Promise<{ comments: number; nextSince?: Date }> {
  const numberToId = await mapPrNumbersToIds(supabase, repoId);

  // `asc` ordering lets us use the last comment's updated_at as a resumable cursor: the next
  // call with since=cursor picks up exactly where this one stopped (GitHub's `since` is inclusive;
  // dedupeById below handles the one-comment overlap at the boundary).
  const allComments: RepoCommentItem[] = [];
  let lastUpdatedAt: string | undefined;
  let truncated = false;

  for (let page = 1; ; page++) {
    const response = await octokit.rest.pulls.listReviewCommentsForRepo({
      owner,
      repo: repoName,
      sort: "updated",
      direction: "asc",
      since: since?.toISOString(),
      per_page: 100,
      page,
    });

    allComments.push(...response.data);

    if (response.data.length > 0) {
      lastUpdatedAt = response.data[response.data.length - 1].updated_at;
    }

    if (response.data.length < 100) break;

    if (maxPages !== undefined && page >= maxPages) {
      truncated = true;
      break;
    }
  }

  const now = new Date().toISOString();
  const rows = dedupeById(allComments)
    .map((c) => {
      const prNumberMatch = /\/pulls\/(\d+)$/.exec(c.pull_request_url);
      const prId = prNumberMatch ? numberToId.get(Number(prNumberMatch[1])) : undefined;
      if (prId === undefined) return null;
      return {
        id: c.id,
        pull_request_id: prId,
        review_id: c.pull_request_review_id,
        commenter_login: c.user.login,
        commenter_github_id: c.user.id,
        body: c.body,
        path: c.path,
        position_line: (c.line as number | null) ?? null,
        position_side: (c.side as string | null) ?? null,
        in_reply_to_id: c.in_reply_to_id ?? null,
        created_at: c.created_at,
        updated_at: c.updated_at,
        fetched_at: now,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  if (rows.length > 0) {
    const { error } = await supabase.from("github_review_comments").upsert(rows, { onConflict: "id" });
    if (error) throw error;
  }

  return {
    comments: rows.length,
    nextSince: truncated && lastUpdatedAt !== undefined ? new Date(lastUpdatedAt) : undefined,
  };
}

export async function listBoardRepos(supabase: SupabaseClient, boardId: string): Promise<RepoRow[]> {
  const { data, error } = await supabase
    .from("github_repos")
    .select("id,repo_owner,repo_name,last_synced_at")
    .eq("board_id", boardId);
  if (error) throw error;
  return data;
}

async function listPrsForRepo(octokit: Octokit, owner: string, repoName: string, since?: Date): Promise<PrItem[]> {
  return octokit.paginate(
    octokit.rest.pulls.list,
    { owner, repo: repoName, state: "all", per_page: 100, sort: "updated", direction: "desc" },
    (response, done) => {
      if (since) {
        const sinceTime = since.getTime();
        if (response.data.some((pr) => new Date(pr.updated_at).getTime() < sinceTime)) {
          done();
        }
        return response.data.filter((pr) => new Date(pr.updated_at).getTime() >= sinceTime);
      }
      return response.data;
    },
  );
}

// Minimal handle for a PR — all `syncPrBatch` needs after the initial listing+upsert has already
// stored every other field. Returning full `PrItem[]` from a Workflow step is what blew through
// the 32MiB Workflows RPC serialization limit on a 90-day window of a very active repo: GitHub's
// PR list items are several KB each (nested user/labels/base/head/_links), so tens of thousands
// of them cross that ceiling fast even though the actual data we still need is two numbers.
export interface PrRef {
  id: number;
  number: number;
}

// Lists + upserts PR summary rows for one repo. Cheap relative to per-PR enrichment (one
// paginated call per ~100 PRs) — safe to run as a single durable step even when uncapped.
export async function listAndUpsertPrsForRepo(
  supabase: SupabaseClient,
  octokit: Octokit,
  repo: RepoRow,
  since?: Date,
  maxPrsPerRepo: number = MAX_PRS_PER_REPO,
): Promise<PrRef[]> {
  const { repo_owner: owner, repo_name: repoName, id: repoId } = repo;
  const prs = await listPrsForRepo(octokit, owner, repoName, since);

  if (prs.length > maxPrsPerRepo) {
    logger.warn(`[github-sync] ${owner}/${repoName}: ${prs.length} PRs found, capping at ${maxPrsPerRepo}.`);
  }
  const cappedPrs = prs.slice(0, maxPrsPerRepo);

  await upsertPullRequests(supabase, repoId, cappedPrs);
  return cappedPrs.map((pr) => ({ id: pr.id, number: pr.number }));
}

// GraphQL node shapes for the batched PR details query.
interface GqlReviewNode {
  databaseId: number;
  state: string;
  submittedAt: string | null;
  author: { login: string; databaseId?: number } | null;
}

interface GqlPrData {
  additions: number;
  deletions: number;
  changedFiles: number;
  reviews: {
    nodes: GqlReviewNode[];
    pageInfo: { hasNextPage: boolean; endCursor: string };
  };
}

// Builds a single GraphQL query that fetches size stats and reviews for up to GQL_PRS_PER_QUERY
// PRs in one round trip using field aliases. PR numbers are inlined (not variables) because
// GraphQL variables cannot be used inside alias positions.
function buildBatchPrDetailsQuery(prs: PrRef[]): string {
  const reviewFields = `nodes { databaseId state submittedAt author { login ... on User { databaseId } } } pageInfo { hasNextPage endCursor }`;
  const prFragment = `additions deletions changedFiles reviews(first: 100) { ${reviewFields} }`;
  const aliases = prs.map((pr, i) => `pr_${i}: pullRequest(number: ${pr.number}) { ${prFragment} }`).join(" ");
  return `query BatchPrDetails($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${aliases} } }`;
}

// Builds a query that fetches the next review page for multiple PRs in one round trip.
// PR numbers are inlined (alias positions); cursors use typed variables ($c0, $c1, …) since
// they appear as field arguments where variables are permitted.
function buildBatchReviewPageQuery(items: { number: number; cursor: string }[]): {
  query: string;
  variables: Record<string, string>;
} {
  const reviewFields = `nodes { databaseId state submittedAt author { login ... on User { databaseId } } } pageInfo { hasNextPage endCursor }`;
  const varDecls = items.map((_, i) => `$c${i}: String!`).join(", ");
  const aliases = items
    .map(
      (item, i) =>
        `pr_${i}: pullRequest(number: ${item.number}) { reviews(first: 100, after: $c${i}) { ${reviewFields} } }`,
    )
    .join(" ");
  const query = `query BatchReviewPage($owner: String!, $name: String!, ${varDecls}) { repository(owner: $owner, name: $name) { ${aliases} } }`;
  const variables: Record<string, string> = {};
  items.forEach((item, i) => {
    variables[`c${i}`] = item.cursor;
  });
  return { query, variables };
}

// Fetches per-PR detail (size stats) + reviews for a slice of PRs via GraphQL, batching
// GQL_PRS_PER_QUERY PRs per query instead of 2 REST calls per PR.
// ~150 PRs → 15 GraphQL queries (~15s) vs 300+ sequential REST calls (>10min).
export async function syncPrBatch(
  supabase: SupabaseClient,
  octokit: Octokit,
  owner: string,
  repoName: string,
  prs: PrRef[],
): Promise<{ reviews: number; errors: string[] }> {
  let reviewCount = 0;
  const errors: string[] = [];
  const now = new Date().toISOString();

  // Flush once per GQL batch (not per-PR and not deferred to end-of-loop).
  // Per-PR (original): 2×N Supabase calls per batch — hit the Worker subrequest limit.
  // Deferred to end: Supabase writes failed when the subrequest budget was already exhausted
  //   by preceding GQL calls, leaving github_reviews empty even though reviewCount > 0.
  // Per-GQL-batch: 3 subrequests per batch (1 GQL + 1 RPC + 1 upsert), data committed
  //   incrementally so a mid-loop subrequest failure can't wipe already-processed batches.
  const totalBatches = Math.ceil(prs.length / GQL_PRS_PER_QUERY);
  for (let i = 0; i < prs.length; i += GQL_PRS_PER_QUERY) {
    const batchIdx = Math.floor(i / GQL_PRS_PER_QUERY);
    const batchPrs = prs.slice(i, i + GQL_PRS_PER_QUERY);
    const firstPr = batchPrs[0].number;
    const lastPr = batchPrs[batchPrs.length - 1].number;
    logger.info(
      `[syncPrBatch] ${owner}/${repoName}: batch ${batchIdx + 1}/${totalBatches} — PRs #${firstPr}–#${lastPr} (${batchPrs.length} PRs)`,
    );

    let batchData: Partial<Record<string, GqlPrData>>;
    const t0 = Date.now();
    try {
      const response = await withRetry(() =>
        octokit.graphql<{ repository: Partial<Record<string, GqlPrData>> }>(buildBatchPrDetailsQuery(batchPrs), {
          owner,
          name: repoName,
        }),
      );
      logger.info(
        `[syncPrBatch] ${owner}/${repoName}: batch ${batchIdx + 1}/${totalBatches} GQL done in ${Date.now() - t0}ms`,
      );
      batchData = response.repository;
    } catch (err) {
      logger.warn(
        `[syncPrBatch] ${owner}/${repoName}: batch ${batchIdx + 1}/${totalBatches} GQL failed after ${Date.now() - t0}ms: ${describeError(err)}`,
      );
      if (describeError(err).includes("Too many subrequests")) throw err;
      for (const pr of batchPrs) {
        errors.push(`PR #${pr.number} (${owner}/${repoName}): GraphQL batch failed: ${describeError(err)}`);
      }
      continue;
    }

    const batchSizeUpdates: { id: number; additions: number; deletions: number; changed_files: number }[] = [];
    // Accumulated review nodes keyed by PR id, grown across overflow pages.
    const reviewNodesByPrId = new Map<number, GqlReviewNode[]>();
    // PRs still waiting for more review pages after the current round.
    let pendingReviewPages: { prId: number; prNumber: number; cursor: string }[] = [];

    for (let j = 0; j < batchPrs.length; j++) {
      const pr = batchPrs[j];
      const prData = batchData[`pr_${j}`];

      if (!prData) {
        errors.push(`PR #${pr.number} (${owner}/${repoName}): missing from GraphQL response`);
        continue;
      }

      batchSizeUpdates.push({
        id: pr.id,
        additions: prData.additions,
        deletions: prData.deletions,
        changed_files: prData.changedFiles,
      });

      reviewNodesByPrId.set(pr.id, [...prData.reviews.nodes]);
      if (prData.reviews.pageInfo.hasNextPage) {
        pendingReviewPages.push({ prId: pr.id, prNumber: pr.number, cursor: prData.reviews.pageInfo.endCursor });
      }
    }

    // Batch-paginate overflowing reviews: all PRs needing the same depth page share one GQL call.
    // N PRs × M overflow pages = M round trips instead of N×M.
    // Capped at MAX_OVERFLOW_ROUNDS to stay within the 50-subrequest free-plan limit per step
    // invocation (including budget headroom if Cloudflare retries the step).
    interface ReviewPageResp {
      repository: Partial<
        Record<string, { reviews: { nodes: GqlReviewNode[]; pageInfo: { hasNextPage: boolean; endCursor: string } } }>
      >;
    }
    let overflowRound = 0;
    while (pendingReviewPages.length > 0) {
      if (overflowRound >= MAX_OVERFLOW_ROUNDS) {
        logger.warn(
          `[github-sync] ${owner}/${repoName}: review overflow truncated at ${MAX_OVERFLOW_ROUNDS} rounds; ${pendingReviewPages.length} PR(s) may have incomplete reviews`,
        );
        break;
      }
      overflowRound++;
      logger.info(
        `[syncPrBatch] ${owner}/${repoName}: batch ${batchIdx + 1}/${totalBatches} overflow round ${overflowRound} — ${pendingReviewPages.length} PR(s) with >100 reviews`,
      );
      const items = pendingReviewPages.map((p) => ({ number: p.prNumber, cursor: p.cursor }));
      const { query, variables } = buildBatchReviewPageQuery(items);
      let pageRepo: ReviewPageResp["repository"];
      const tOverflow = Date.now();
      try {
        const resp = await withRetry(() =>
          octokit.graphql<ReviewPageResp>(query, { owner, name: repoName, ...variables }),
        );
        logger.info(
          `[syncPrBatch] ${owner}/${repoName}: batch ${batchIdx + 1}/${totalBatches} overflow round ${overflowRound} done in ${Date.now() - tOverflow}ms`,
        );
        pageRepo = resp.repository;
      } catch (err) {
        logger.warn(
          `[syncPrBatch] ${owner}/${repoName}: batch ${batchIdx + 1}/${totalBatches} overflow round ${overflowRound} failed after ${Date.now() - tOverflow}ms: ${describeError(err)}`,
        );
        if (describeError(err).includes("Too many subrequests")) throw err;
        for (const p of pendingReviewPages) {
          const msg = `PR #${p.prNumber} (${owner}/${repoName}): review overflow page failed: ${describeError(err)}`;
          errors.push(msg);
          logger.warn(`[github-sync] ${msg}`);
        }
        break;
      }
      const nextPending: typeof pendingReviewPages = [];
      for (let k = 0; k < pendingReviewPages.length; k++) {
        const { prId, prNumber } = pendingReviewPages[k];
        const page = pageRepo[`pr_${k}`];
        if (!page) continue;
        const existing = reviewNodesByPrId.get(prId) ?? [];
        reviewNodesByPrId.set(prId, [...existing, ...page.reviews.nodes]);
        if (page.reviews.pageInfo.hasNextPage) {
          nextPending.push({ prId, prNumber, cursor: page.reviews.pageInfo.endCursor });
        }
      }
      pendingReviewPages = nextPending;
    }

    const batchReviewRows: {
      id: number;
      pull_request_id: number;
      reviewer_login: string;
      reviewer_github_id: number;
      state: string;
      submitted_at: string;
      fetched_at: string;
    }[] = [];

    for (const pr of batchPrs) {
      const reviewNodes = reviewNodesByPrId.get(pr.id);
      if (!reviewNodes) continue;
      batchReviewRows.push(
        ...new Map(
          reviewNodes
            .filter((n): n is GqlReviewNode & { submittedAt: string } => n.submittedAt !== null)
            .map((n) => [
              n.databaseId,
              {
                id: n.databaseId,
                pull_request_id: pr.id,
                reviewer_login: n.author?.login ?? "",
                reviewer_github_id: n.author?.databaseId ?? 0,
                state: n.state,
                submitted_at: n.submittedAt,
                fetched_at: now,
              },
            ]),
        ).values(),
      );
      reviewCount += reviewNodes.length;
    }

    // Supabase writes wrapped in try-catch: Cloudflare throws "Too many subrequests"
    // as a thrown exception (not a PostgREST { error }). "Too many subrequests" is
    // re-thrown so the Workflow step fails and Cloudflare retries in a new invocation
    // with a fresh 50-subrequest budget. Other exceptions are caught gracefully.
    if (batchSizeUpdates.length > 0) {
      try {
        const { error } = await supabase.rpc("batch_update_pr_sizes", { updates: batchSizeUpdates });
        if (error) {
          const msg = `batch size update failed (PRs ${batchPrs[0].number}–${batchPrs[batchPrs.length - 1].number}): ${describeError(error)}`;
          errors.push(msg);
          logger.warn(`[github-sync] ${msg}`);
        }
      } catch (err) {
        if (describeError(err).includes("Too many subrequests")) throw err;
        const msg = `batch size update threw (PRs ${batchPrs[0].number}–${batchPrs[batchPrs.length - 1].number}): ${describeError(err)}`;
        errors.push(msg);
        logger.warn(`[github-sync] ${msg}`);
      }
    }
    if (batchReviewRows.length > 0) {
      try {
        const { error } = await supabase.from("github_reviews").upsert(batchReviewRows, { onConflict: "id" });
        if (error) {
          const msg = `review upsert failed (PRs ${batchPrs[0].number}–${batchPrs[batchPrs.length - 1].number}): ${describeError(error)}`;
          errors.push(msg);
          logger.warn(`[github-sync] ${msg}`);
        }
      } catch (err) {
        if (describeError(err).includes("Too many subrequests")) throw err;
        const msg = `review upsert threw (PRs ${batchPrs[0].number}–${batchPrs[batchPrs.length - 1].number}): ${describeError(err)}`;
        errors.push(msg);
        logger.warn(`[github-sync] ${msg}`);
      }
    }
  }

  return { reviews: reviewCount, errors };
}

export async function syncBoardGitHubData(
  supabase: SupabaseClient,
  boardId: string,
  options?: SyncOptions,
): Promise<SyncResult> {
  const { since, octokit: providedOctokit, maxPrsPerRepo = MAX_PRS_PER_REPO, encryptionKey } = options ?? {};

  const repos = await listBoardRepos(supabase, boardId);
  if (repos.length === 0) return { repos: 0, pullRequests: 0, reviews: 0, comments: 0, errors: [] };

  const octokit = providedOctokit ?? (await createGitHubClient(supabase, boardId, encryptionKey));

  const result: SyncResult = { repos: repos.length, pullRequests: 0, reviews: 0, comments: 0, errors: [] };

  for (const repo of repos) {
    const cappedPrs = await listAndUpsertPrsForRepo(supabase, octokit, repo, since, maxPrsPerRepo);
    result.pullRequests += cappedPrs.length;

    const { reviews, errors } = await syncPrBatch(supabase, octokit, repo.repo_owner, repo.repo_name, cappedPrs);
    result.reviews += reviews;
    result.errors.push(...errors);

    const { comments } = await syncReviewCommentsForRepo(
      supabase,
      octokit,
      repo.id,
      repo.repo_owner,
      repo.repo_name,
      since,
    );
    result.comments += comments;
  }

  return result;
}
