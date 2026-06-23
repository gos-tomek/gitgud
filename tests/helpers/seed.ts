import { type SupabaseClient } from "@supabase/supabase-js";
import { adminClient, cleanupBoard, cleanupUser, createTestUser } from "./supabase.js";

export interface TwoBoardFixture {
  ownerA: { client: SupabaseClient; userId: string; boardId: string; githubId: number };
  ownerB: { client: SupabaseClient; userId: string; boardId: string; githubId: number };
  contributor: { client: SupabaseClient; userId: string; githubId: number };
  repoId: string;
  prId: number;
  reviewId: number;
  commentId: number;
  contributorGithubId: number;
  cleanup: () => Promise<void>;
}

export async function seedTwoBoards(): Promise<TwoBoardFixture> {
  const ts = Date.now();
  const email = (label: string) => `seed-${label}-${ts}@test.local`;

  // user_profiles rows are created by the handle_new_user trigger from this metadata.
  const githubIdA = ts + 10;
  const githubIdB = ts + 11;
  const contributorGithubId = ts + 12;
  const [ownerAResult, ownerBResult, contributorResult] = await Promise.all([
    createTestUser(email("owner-a"), undefined, { id: githubIdA, login: `owner-a-${ts}` }),
    createTestUser(email("owner-b"), undefined, { id: githubIdB, login: `owner-b-${ts}` }),
    createTestUser(email("contributor"), undefined, { id: contributorGithubId, login: `test-contributor-${ts}` }),
  ]);
  const { client: clientA, userId: userIdA } = ownerAResult;
  const { client: clientB, userId: userIdB } = ownerBResult;
  const { client: contributorClient, userId: contributorUserId } = contributorResult;

  // Create both boards via admin — trigger auto-enrolls owner as board_member
  const { data: boardAData, error: boardAError } = await adminClient
    .from("boards")
    .insert({ name: `Board A ${ts}`, owner_user_id: userIdA })
    .select("id")
    .single();
  if (boardAError) throw new Error(`Failed to create Board A: ${boardAError.message}`);
  const boardIdA = boardAData.id as string;

  const { data: boardBData, error: boardBError } = await adminClient
    .from("boards")
    .insert({ name: `Board B ${ts}`, owner_user_id: userIdB })
    .select("id")
    .single();
  if (boardBError) throw new Error(`Failed to create Board B: ${boardBError.message}`);
  const boardIdB = boardBData.id as string;

  // Seed Board A: github_repo
  const { data: repoData, error: repoError } = await adminClient
    .from("github_repos")
    .insert({ board_id: boardIdA, repo_owner: "test-org", repo_name: "test-repo", connected_by: userIdA })
    .select("id")
    .single();
  if (repoError) throw new Error(`Failed to create repo: ${repoError.message}`);
  const repoId = repoData.id as string;

  // Seed Board A: github_pull_request (bigint id derived from timestamp)
  const prId = ts;
  const { error: prError } = await adminClient.from("github_pull_requests").insert({
    id: prId,
    repo_id: repoId,
    number: 1,
    title: "Test PR",
    state: "open",
    author_login: "test-author",
    author_github_id: 12345,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  if (prError) throw new Error(`Failed to create PR: ${prError.message}`);

  // Seed Board A: github_review
  const reviewId = ts + 1;
  const { error: reviewError } = await adminClient.from("github_reviews").insert({
    id: reviewId,
    pull_request_id: prId,
    reviewer_login: "test-reviewer",
    reviewer_github_id: 99999,
    state: "APPROVED",
    submitted_at: new Date().toISOString(),
  });
  if (reviewError) throw new Error(`Failed to create review: ${reviewError.message}`);

  // Seed Board A: github_review_comment
  const commentId = ts + 2;
  const { error: commentError } = await adminClient.from("github_review_comments").insert({
    id: commentId,
    pull_request_id: prId,
    review_id: reviewId,
    commenter_login: "test-commenter",
    commenter_github_id: 88888,
    body: "Test comment body",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  if (commentError) throw new Error(`Failed to create review comment: ${commentError.message}`);

  // Seed Board A: board_contributor — linked to the contributor user via matching github_id
  const { error: contributorError } = await adminClient.from("board_contributors").insert({
    board_id: boardIdA,
    github_id: contributorGithubId,
    github_login: `test-contributor-${ts}`,
  });
  if (contributorError) throw new Error(`Failed to create contributor: ${contributorError.message}`);

  async function cleanup() {
    // CASCADE from boards handles all child rows; users are deleted last
    await Promise.all([cleanupBoard(boardIdA), cleanupBoard(boardIdB)]);
    await Promise.all([cleanupUser(userIdA), cleanupUser(userIdB), cleanupUser(contributorUserId)]);
  }

  return {
    ownerA: { client: clientA, userId: userIdA, boardId: boardIdA, githubId: githubIdA },
    ownerB: { client: clientB, userId: userIdB, boardId: boardIdB, githubId: githubIdB },
    contributor: { client: contributorClient, userId: contributorUserId, githubId: contributorGithubId },
    repoId,
    prId,
    reviewId,
    commentId,
    contributorGithubId,
    cleanup,
  };
}
