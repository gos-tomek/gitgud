import { adminClient, createTestUser, cleanupBoard, cleanupUser } from "../helpers/supabase.js";
import { checkSupabase } from "../helpers/setup.js";
import {
  renameBoard,
  addBoardRepo,
  removeBoardRepo,
  addBoardContributors,
  removeBoardContributor,
} from "@/lib/services/boards";

const supabaseAvailable = await checkSupabase();

describe.skipIf(!supabaseAvailable)("Board settings mutations (integration)", () => {
  // Random jitter avoids github_pull_requests_pkey collisions with other integration test files
  // that also derive bigint ids from Date.now() and can run in the same millisecond.
  const ts = Date.now() * 1000 + Math.floor(Math.random() * 1000);

  let ownerClient: Awaited<ReturnType<typeof createTestUser>>["client"];
  let ownerId: string;
  let nonOwnerClient: Awaited<ReturnType<typeof createTestUser>>["client"];
  let nonOwnerId: string;
  let boardId: string;

  beforeAll(async () => {
    const [ownerResult, nonOwnerResult] = await Promise.all([
      createTestUser(`settings-owner-${ts}@test.local`),
      createTestUser(`settings-nonowner-${ts}@test.local`),
    ]);
    ownerClient = ownerResult.client;
    ownerId = ownerResult.userId;
    nonOwnerClient = nonOwnerResult.client;
    nonOwnerId = nonOwnerResult.userId;

    const { data, error } = await adminClient
      .from("boards")
      .insert({ name: `Settings Board ${ts}`, owner_user_id: ownerId })
      .select("id")
      .single();
    if (error) throw new Error(`Failed to create board: ${error.message}`);
    boardId = data.id as string;
  }, 30_000);

  afterAll(async () => {
    if (boardId) await cleanupBoard(boardId);
    await Promise.all([cleanupUser(ownerId), cleanupUser(nonOwnerId)]);
  });

  // ─── renameBoard ──────────────────────────────────────────────────────────

  describe("renameBoard", () => {
    it("owner can rename board", async () => {
      await renameBoard(ownerClient, boardId, `Renamed Board ${ts}`);

      const { data } = await adminClient.from("boards").select("name").eq("id", boardId).single();
      expect(data?.name).toBe(`Renamed Board ${ts}`);
    });

    it("non-owner rename is silently denied (RLS UPDATE: 0 rows affected, name unchanged)", async () => {
      const { data: before } = await adminClient.from("boards").select("name").eq("id", boardId).single();

      // RLS USING clause filters UPDATE for non-owners — no error, but 0 rows affected
      await nonOwnerClient.from("boards").update({ name: "HIJACKED" }).eq("id", boardId);

      const { data: after } = await adminClient.from("boards").select("name").eq("id", boardId).single();
      expect(after?.name).toBe(before?.name);
    });

    it("rename to a name already used by another board raises 23505", async () => {
      const dupeName = `Dupe Board ${ts}`;
      const { data: board2, error: b2err } = await adminClient
        .from("boards")
        .insert({ name: dupeName, owner_user_id: ownerId })
        .select("id")
        .single();
      if (b2err) throw new Error(`Failed to create dupe board: ${b2err.message}`);

      try {
        await expect(renameBoard(ownerClient, boardId, dupeName)).rejects.toMatchObject({ code: "23505" });
      } finally {
        await cleanupBoard(board2.id as string);
      }
    });
  });

  // ─── addBoardRepo / removeBoardRepo ───────────────────────────────────────

  describe("addBoardRepo / removeBoardRepo", () => {
    const repoOwner = "test-org";
    const repoName = `settings-repo-${ts}`;
    let addedRepoId: string;

    afterAll(async () => {
      // Catch any repos left behind by individual tests
      await adminClient.from("github_repos").delete().eq("board_id", boardId);
    });

    it("owner can add a repo", async () => {
      const result = await addBoardRepo(ownerClient, boardId, repoOwner, repoName);
      expect(result.id).toBeTruthy();
      addedRepoId = result.id;

      const { data } = await adminClient.from("github_repos").select("id").eq("id", addedRepoId);
      expect(data).toHaveLength(1);
    });

    it("adding a duplicate repo raises 23505", async () => {
      await expect(addBoardRepo(ownerClient, boardId, repoOwner, repoName)).rejects.toMatchObject({ code: "23505" });
    });

    it("non-owner cannot add a repo (RLS INSERT → 42501)", async () => {
      const { error } = await nonOwnerClient.from("github_repos").insert({
        board_id: boardId,
        repo_owner: "evil-org",
        repo_name: `evil-repo-${ts}`,
      });
      expect(error?.code).toBe("42501");
    });

    it("non-owner cannot delete a repo (RLS DELETE: 0 rows affected, repo survives)", async () => {
      // RLS USING clause silently denies DELETE for non-owners — no error thrown
      await nonOwnerClient
        .from("github_repos")
        .delete()
        .match({ board_id: boardId, repo_owner: repoOwner, repo_name: repoName });

      const { data } = await adminClient.from("github_repos").select("id").eq("id", addedRepoId);
      expect(data).toHaveLength(1);
    });

    it("removing a repo cascades downstream PR, review, and review-comment data", async () => {
      // Seed a PR under the repo to verify cascade
      const prId = ts + 5_000;
      const reviewId = ts + 5_001;
      const commentId = ts + 5_002;

      const { error: prErr } = await adminClient.from("github_pull_requests").insert({
        id: prId,
        repo_id: addedRepoId,
        number: 42,
        title: "Cascade test PR",
        state: "open",
        author_login: "test-author",
        author_github_id: 12345,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      if (prErr) throw new Error(`Failed to seed PR: ${prErr.message}`);

      const { error: reviewErr } = await adminClient.from("github_reviews").insert({
        id: reviewId,
        pull_request_id: prId,
        reviewer_login: "test-reviewer",
        reviewer_github_id: 99999,
        state: "APPROVED",
        submitted_at: new Date().toISOString(),
      });
      if (reviewErr) throw new Error(`Failed to seed review: ${reviewErr.message}`);

      const { error: commentErr } = await adminClient.from("github_review_comments").insert({
        id: commentId,
        pull_request_id: prId,
        review_id: reviewId,
        commenter_login: "test-commenter",
        commenter_github_id: 88888,
        body: "Test comment body",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      if (commentErr) throw new Error(`Failed to seed comment: ${commentErr.message}`);

      // Verify seed data is in place
      const { data: prBefore } = await adminClient.from("github_pull_requests").select("id").eq("id", prId);
      expect(prBefore).toHaveLength(1);

      // Remove the repo — should cascade to all child rows
      await removeBoardRepo(ownerClient, boardId, repoOwner, repoName);

      const { data: repoAfter } = await adminClient.from("github_repos").select("id").eq("id", addedRepoId);
      expect(repoAfter).toHaveLength(0);

      const { data: prAfter } = await adminClient.from("github_pull_requests").select("id").eq("id", prId);
      expect(prAfter).toHaveLength(0);

      const { data: reviewAfter } = await adminClient.from("github_reviews").select("id").eq("id", reviewId);
      expect(reviewAfter).toHaveLength(0);

      const { data: commentAfter } = await adminClient.from("github_review_comments").select("id").eq("id", commentId);
      expect(commentAfter).toHaveLength(0);
    });
  });

  // ─── addBoardContributors / removeBoardContributor ────────────────────────

  describe("addBoardContributors / removeBoardContributor", () => {
    const contributorGithubId = ts + 100;
    const contributorLogin = `test-contrib-${ts}`;

    afterAll(async () => {
      // Clean up any contributors left behind
      await adminClient.from("board_contributors").delete().eq("board_id", boardId);
    });

    it("owner can add contributors", async () => {
      await addBoardContributors(ownerClient, boardId, [
        { githubId: contributorGithubId, githubLogin: contributorLogin, avatarUrl: null },
      ]);

      const { data } = await adminClient
        .from("board_contributors")
        .select("github_id")
        .eq("board_id", boardId)
        .eq("github_id", contributorGithubId);
      expect(data).toHaveLength(1);
    });

    it("adding the same contributor again is idempotent (upsert ignoreDuplicates: no error, still 1 row)", async () => {
      await expect(
        addBoardContributors(ownerClient, boardId, [
          { githubId: contributorGithubId, githubLogin: contributorLogin, avatarUrl: null },
        ]),
      ).resolves.not.toThrow();

      const { data } = await adminClient
        .from("board_contributors")
        .select("github_id")
        .eq("board_id", boardId)
        .eq("github_id", contributorGithubId);
      expect(data).toHaveLength(1);
    });

    it("non-owner cannot add contributors (RLS INSERT → 42501)", async () => {
      const { error } = await nonOwnerClient.from("board_contributors").insert({
        board_id: boardId,
        github_id: ts + 200,
        github_login: `evil-contrib-${ts}`,
      });
      expect(error?.code).toBe("42501");
    });

    it("non-owner cannot remove a contributor (RLS DELETE: 0 rows affected, contributor survives)", async () => {
      // RLS USING clause silently denies DELETE for non-owners — no error thrown
      await nonOwnerClient
        .from("board_contributors")
        .delete()
        .match({ board_id: boardId, github_id: contributorGithubId });

      const { data } = await adminClient
        .from("board_contributors")
        .select("github_id")
        .eq("board_id", boardId)
        .eq("github_id", contributorGithubId);
      expect(data).toHaveLength(1);
    });

    it("owner can remove a contributor", async () => {
      await removeBoardContributor(ownerClient, boardId, contributorGithubId);

      const { data } = await adminClient
        .from("board_contributors")
        .select("github_id")
        .eq("board_id", boardId)
        .eq("github_id", contributorGithubId);
      expect(data).toHaveLength(0);
    });

    it("removed contributor can be re-added and is visible again", async () => {
      await addBoardContributors(ownerClient, boardId, [
        { githubId: contributorGithubId, githubLogin: contributorLogin, avatarUrl: null },
      ]);

      const { data } = await adminClient
        .from("board_contributors")
        .select("github_id")
        .eq("board_id", boardId)
        .eq("github_id", contributorGithubId);
      expect(data).toHaveLength(1);
    });
  });
});
