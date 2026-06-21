import type { Octokit } from "@octokit/rest";
import type { createClient } from "@/lib/supabase";
import { createGitHubClient } from "@/lib/github";
import { logger } from "@/lib/logger";

// Default cap protecting the in-request API route from Worker timeouts. The
// classification-batch Workflow lifts this via `maxPrsPerRepo: Number.POSITIVE_INFINITY`
// since durable steps have no such timeout constraint.
const MAX_PRS_PER_REPO = 200;

type SupabaseClient = NonNullable<ReturnType<typeof createClient>>;

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
type PrDetailItem = Awaited<ReturnType<Octokit["rest"]["pulls"]["get"]>>["data"];
type ReviewItem = Awaited<ReturnType<Octokit["rest"]["pulls"]["listReviews"]>>["data"][number];
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

async function upsertReviews(supabase: SupabaseClient, prId: number, reviews: ReviewItem[]): Promise<void> {
  if (reviews.length === 0) return;
  const now = new Date().toISOString();
  const rows = dedupeById(reviews)
    .filter((r) => (r.submitted_at as string | null) !== null)
    .map((r) => ({
      id: r.id,
      pull_request_id: prId,
      reviewer_login: r.user?.login ?? "",
      reviewer_github_id: r.user?.id ?? 0,
      state: r.state,
      submitted_at: r.submitted_at,
      fetched_at: now,
    }));
  if (rows.length === 0) return;
  const { error } = await supabase.from("github_reviews").upsert(rows, { onConflict: "id" });
  if (error) throw error;
}

async function updatePullRequestSize(supabase: SupabaseClient, prId: number, detail: PrDetailItem): Promise<void> {
  const { error } = await supabase
    .from("github_pull_requests")
    .update({ additions: detail.additions, deletions: detail.deletions, changed_files: detail.changed_files })
    .eq("id", prId);
  if (error) throw error;
}

async function mapPrNumbersToIds(supabase: SupabaseClient, repoId: string): Promise<Map<number, number>> {
  const { data, error } = await supabase.from("github_pull_requests").select("id,number").eq("repo_id", repoId);
  if (error) throw error;
  return new Map((data as { id: number; number: number }[]).map((row) => [row.number, row.id]));
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
): Promise<{ comments: number }> {
  const numberToId = await mapPrNumbersToIds(supabase, repoId);

  const allComments: RepoCommentItem[] = await octokit.paginate(octokit.rest.pulls.listReviewCommentsForRepo, {
    owner,
    repo: repoName,
    sort: "updated",
    direction: "desc",
    since: since?.toISOString(),
    per_page: 100,
  });

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

  if (rows.length === 0) return { comments: 0 };
  const { error } = await supabase.from("github_review_comments").upsert(rows, { onConflict: "id" });
  if (error) throw error;
  return { comments: rows.length };
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

// Fetches per-PR detail (size stats) + reviews for a slice of PRs. This is the expensive part
// (2 GitHub requests/PR) — callers needing rate-limit checkpointing (e.g. the classification-batch
// Workflow) should chunk `prs` and call this once per chunk between durable step boundaries.
export async function syncPrBatch(
  supabase: SupabaseClient,
  octokit: Octokit,
  owner: string,
  repoName: string,
  prs: PrRef[],
): Promise<{ reviews: number; errors: string[] }> {
  let reviewCount = 0;
  const errors: string[] = [];

  for (const pr of prs) {
    try {
      const [prDetail, reviews] = await Promise.all([
        octokit.rest.pulls.get({ owner, repo: repoName, pull_number: pr.number }),
        octokit.paginate(octokit.rest.pulls.listReviews, {
          owner,
          repo: repoName,
          pull_number: pr.number,
          per_page: 100,
        }),
      ]);

      await updatePullRequestSize(supabase, pr.id, prDetail.data);
      await upsertReviews(supabase, pr.id, reviews);

      reviewCount += reviews.length;
    } catch (err) {
      const msg = `PR #${pr.number} (${owner}/${repoName}): ${err instanceof Error ? err.message : String(err)}`;
      errors.push(msg);
      logger.warn(`[github-sync] Skipping ${msg}`);
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
