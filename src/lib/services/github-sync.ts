import type { Octokit } from "@octokit/rest";
import type { createClient } from "@/lib/supabase";
import { createGitHubClient } from "@/lib/github";
import { logger } from "@/lib/logger";

// F-03 (Workflows) will lift this cap via durable execution; until then, protect against Worker timeout
const MAX_PRS_PER_REPO = 200;

type SupabaseClient = NonNullable<ReturnType<typeof createClient>>;

export interface SyncResult {
  repos: number;
  pullRequests: number;
  reviews: number;
  comments: number;
  errors: string[];
}

type PrItem = Awaited<ReturnType<Octokit["rest"]["pulls"]["list"]>>["data"][number];
type ReviewItem = Awaited<ReturnType<Octokit["rest"]["pulls"]["listReviews"]>>["data"][number];
type CommentItem = Awaited<ReturnType<Octokit["rest"]["pulls"]["listReviewComments"]>>["data"][number];

interface RepoRow {
  id: string;
  repo_owner: string;
  repo_name: string;
}

async function upsertPullRequests(supabase: SupabaseClient, repoId: string, prs: PrItem[]): Promise<void> {
  if (prs.length === 0) return;
  const now = new Date().toISOString();
  const rows = prs.map((pr) => ({
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
  const rows = reviews
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

async function upsertComments(supabase: SupabaseClient, prId: number, comments: CommentItem[]): Promise<void> {
  if (comments.length === 0) return;
  const now = new Date().toISOString();
  const rows = comments.map((c) => ({
    id: c.id,
    pull_request_id: prId,
    review_id: c.pull_request_review_id,
    commenter_login: c.user.login,
    commenter_github_id: c.user.id,
    body: c.body,
    path: c.path,
    position_line: (c.line as number | null) ?? null,
    position_side: (c.side as string | null) ?? null,
    created_at: c.created_at,
    updated_at: c.updated_at,
    fetched_at: now,
  }));
  const { error } = await supabase.from("github_review_comments").upsert(rows, { onConflict: "id" });
  if (error) throw error;
}

export async function syncBoardGitHubData(
  supabase: SupabaseClient,
  boardId: string,
  since?: Date,
): Promise<SyncResult> {
  const { data: repos, error: reposError } = await supabase
    .from("github_repos")
    .select("id,repo_owner,repo_name")
    .eq("board_id", boardId);

  if (reposError) throw reposError;
  if (repos.length === 0) return { repos: 0, pullRequests: 0, reviews: 0, comments: 0 };

  const octokit = await createGitHubClient(supabase, boardId);

  const result: SyncResult = { repos: repos.length, pullRequests: 0, reviews: 0, comments: 0, errors: [] };

  for (const repo of repos as RepoRow[]) {
    const { repo_owner: owner, repo_name: repoName, id: repoId } = repo;

    const prs = await octokit.paginate(
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

    if (prs.length > MAX_PRS_PER_REPO) {
      logger.warn(
        `[github-sync] ${owner}/${repoName}: ${prs.length} PRs found, capping at ${MAX_PRS_PER_REPO}. Full sync deferred to F-03.`,
      );
    }
    const cappedPrs = prs.slice(0, MAX_PRS_PER_REPO);

    await upsertPullRequests(supabase, repoId, cappedPrs);
    result.pullRequests += cappedPrs.length;

    for (const pr of cappedPrs) {
      try {
        const [reviews, comments] = await Promise.all([
          octokit.paginate(octokit.rest.pulls.listReviews, {
            owner,
            repo: repoName,
            pull_number: pr.number,
            per_page: 100,
          }),
          octokit.paginate(octokit.rest.pulls.listReviewComments, {
            owner,
            repo: repoName,
            pull_number: pr.number,
            per_page: 100,
          }),
        ]);

        await upsertReviews(supabase, pr.id, reviews);
        await upsertComments(supabase, pr.id, comments);

        result.reviews += reviews.length;
        result.comments += comments.length;
      } catch (err) {
        const msg = `PR #${pr.number} (${owner}/${repoName}): ${err instanceof Error ? err.message : String(err)}`;
        result.errors.push(msg);
        logger.warn(`[github-sync] Skipping ${msg}`);
      }
    }
  }

  return result;
}
