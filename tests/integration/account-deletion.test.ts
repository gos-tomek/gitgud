import { adminClient, createTestUser, cleanupUser } from "../helpers/supabase.js";
import { checkSupabase } from "../helpers/setup.js";

const supabaseAvailable = await checkSupabase();

describe.skipIf(!supabaseAvailable)("Account deletion cascade", () => {
  it("removes the user, owned board, repos, PRs, reviews, comments, and classifications", async () => {
    const ts = Date.now();
    const { userId } = await createTestUser(`delete-cascade-${ts}@test.local`, undefined, {
      id: ts,
      login: `delete-cascade-${ts}`,
    });

    const { data: boardData, error: boardError } = await adminClient
      .from("boards")
      .insert({ name: `Delete cascade board ${ts}`, owner_user_id: userId })
      .select("id")
      .single();
    if (boardError) throw new Error(`Failed to create board: ${boardError.message}`);
    const boardId = boardData.id as string;

    const { data: repoData, error: repoError } = await adminClient
      .from("github_repos")
      .insert({ board_id: boardId, repo_owner: "test-org", repo_name: "test-repo" })
      .select("id")
      .single();
    if (repoError) throw new Error(`Failed to create repo: ${repoError.message}`);
    const repoId = repoData.id as string;

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

    const { error: classificationError } = await adminClient.from("thread_classifications").insert({
      thread_root_comment_id: commentId,
      pull_request_id: prId,
      intent: "question",
      domain: "discussion",
      model_id: "test-model",
    });
    if (classificationError) throw new Error(`Failed to create classification: ${classificationError.message}`);

    // This is exactly what DELETE /api/profile does server-side (src/pages/api/profile/index.ts) —
    // the cascade behavior under test lives entirely in FK constraints, not the route handler.
    const { error: deleteError } = await adminClient.auth.admin.deleteUser(userId);
    expect(deleteError).toBeNull();

    const [profileResult, boardResult, repoResult, prResult, reviewResult, commentResult, classificationResult] =
      await Promise.all([
        adminClient.from("user_profiles").select("user_id").eq("user_id", userId),
        adminClient.from("boards").select("id").eq("id", boardId),
        adminClient.from("github_repos").select("id").eq("id", repoId),
        adminClient.from("github_pull_requests").select("id").eq("id", prId),
        adminClient.from("github_reviews").select("id").eq("id", reviewId),
        adminClient.from("github_review_comments").select("id").eq("id", commentId),
        adminClient
          .from("thread_classifications")
          .select("thread_root_comment_id")
          .eq("thread_root_comment_id", commentId),
      ]);

    expect(profileResult.data).toEqual([]);
    expect(boardResult.data).toEqual([]);
    expect(repoResult.data).toEqual([]);
    expect(prResult.data).toEqual([]);
    expect(reviewResult.data).toEqual([]);
    expect(commentResult.data).toEqual([]);
    expect(classificationResult.data).toEqual([]);

    // deleteUser already removed the auth record; calling cleanupUser again would just no-op.
    await cleanupUser(userId).catch(() => undefined);
  });
});
