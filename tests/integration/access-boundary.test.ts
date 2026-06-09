import { adminClient } from "../helpers/supabase.js";
import { checkSupabase } from "../helpers/setup.js";
import { seedTwoBoards, type TwoBoardFixture } from "../helpers/seed.js";
import { getBoardWithRole, getBoardRepos, getBoardContributors } from "@/lib/services/boards";

const supabaseAvailable = await checkSupabase();

describe.skipIf(!supabaseAvailable)("Cross-board access boundary (Risk #1 + #5)", () => {
  let fixture: TwoBoardFixture;

  beforeAll(async () => {
    fixture = await seedTwoBoards();
  });

  afterAll(async () => {
    await fixture.cleanup();
  });

  // ─── cross-board SELECT denial ────────────────────────────────────────────
  // RLS USING clause filters silently — denied reads return [] not an error.

  describe("cross-board SELECT denial", () => {
    it("boards: User B cannot read Board A", async () => {
      const { data, error } = await fixture.ownerB.client.from("boards").select("*").eq("id", fixture.ownerA.boardId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("board_members: User B cannot read Board A members", async () => {
      const { data, error } = await fixture.ownerB.client
        .from("board_members")
        .select("*")
        .eq("board_id", fixture.ownerA.boardId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("github_repos: User B cannot read Board A repos", async () => {
      const { data, error } = await fixture.ownerB.client
        .from("github_repos")
        .select("*")
        .eq("board_id", fixture.ownerA.boardId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("github_pull_requests: User B cannot read Board A PRs", async () => {
      const { data, error } = await fixture.ownerB.client
        .from("github_pull_requests")
        .select("*")
        .eq("id", fixture.prId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("github_reviews: User B cannot read Board A reviews", async () => {
      const { data, error } = await fixture.ownerB.client.from("github_reviews").select("*").eq("id", fixture.reviewId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("github_review_comments: User B cannot read Board A comments", async () => {
      const { data, error } = await fixture.ownerB.client
        .from("github_review_comments")
        .select("*")
        .eq("id", fixture.commentId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("board_contributors: User B cannot read Board A contributors", async () => {
      const { data, error } = await fixture.ownerB.client
        .from("board_contributors")
        .select("*")
        .eq("board_id", fixture.ownerA.boardId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });
  });

  // ─── cross-board write denial ─────────────────────────────────────────────
  // INSERT WITH CHECK failure → PostgreSQL error code 42501.
  // UPDATE/DELETE USING clause failure → silently affects 0 rows.

  describe("cross-board write denial", () => {
    describe("INSERT denial (42501)", () => {
      it("boards: User B cannot insert a board owned by User A", async () => {
        const { error } = await fixture.ownerB.client
          .from("boards")
          .insert({ name: "hijacked board", owner_user_id: fixture.ownerA.userId });
        expect(error?.code).toBe("42501");
      });

      it("board_members: User B cannot insert a member into Board A", async () => {
        const { error } = await fixture.ownerB.client
          .from("board_members")
          .insert({ board_id: fixture.ownerA.boardId, user_id: fixture.ownerB.userId });
        expect(error?.code).toBe("42501");
      });

      it("github_repos: User B cannot insert a repo into Board A", async () => {
        const { error } = await fixture.ownerB.client.from("github_repos").insert({
          board_id: fixture.ownerA.boardId,
          repo_owner: "evil-org",
          repo_name: "evil-repo",
          connected_by: fixture.ownerB.userId,
        });
        expect(error?.code).toBe("42501");
      });

      it("github_pull_requests: User B cannot insert a PR into Board A's repo", async () => {
        const { error } = await fixture.ownerB.client.from("github_pull_requests").insert({
          id: 999999999901,
          repo_id: fixture.repoId,
          number: 999,
          title: "Injected PR",
          state: "open",
          author_login: "attacker",
          author_github_id: 77777,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        expect(error?.code).toBe("42501");
      });

      it("github_reviews: User B cannot insert a review for Board A's PR", async () => {
        const { error } = await fixture.ownerB.client.from("github_reviews").insert({
          id: 999999999902,
          pull_request_id: fixture.prId,
          reviewer_login: "attacker",
          reviewer_github_id: 77777,
          state: "CHANGES_REQUESTED",
          submitted_at: new Date().toISOString(),
        });
        expect(error?.code).toBe("42501");
      });

      it("github_review_comments: User B cannot insert a comment for Board A's PR", async () => {
        const { error } = await fixture.ownerB.client.from("github_review_comments").insert({
          id: 999999999903,
          pull_request_id: fixture.prId,
          commenter_login: "attacker",
          commenter_github_id: 77777,
          body: "Injected comment",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        expect(error?.code).toBe("42501");
      });

      it("board_contributors: User B cannot insert a contributor into Board A", async () => {
        const { error } = await fixture.ownerB.client.from("board_contributors").insert({
          board_id: fixture.ownerA.boardId,
          github_id: 66666,
          github_login: "injected-contributor",
        });
        expect(error?.code).toBe("42501");
      });
    });

    describe("UPDATE denial (0 rows affected, verified via admin)", () => {
      it("boards: User B cannot update Board A's name", async () => {
        const original = `Board A ${fixture.ownerA.boardId.slice(0, 8)}`;
        // Fetch original name
        const { data: before } = await adminClient
          .from("boards")
          .select("name")
          .eq("id", fixture.ownerA.boardId)
          .single();

        await fixture.ownerB.client.from("boards").update({ name: "HIJACKED" }).eq("id", fixture.ownerA.boardId);

        const { data: after } = await adminClient
          .from("boards")
          .select("name")
          .eq("id", fixture.ownerA.boardId)
          .single();

        void original;
        expect(after?.name).toBe(before?.name);
      });

      it("github_repos: User B cannot update Board A's repo", async () => {
        const { data: before } = await adminClient
          .from("github_repos")
          .select("repo_name")
          .eq("id", fixture.repoId)
          .single();

        await fixture.ownerB.client
          .from("github_repos")
          .update({ repo_name: "hijacked-repo" })
          .eq("id", fixture.repoId);

        const { data: after } = await adminClient
          .from("github_repos")
          .select("repo_name")
          .eq("id", fixture.repoId)
          .single();

        expect(after?.repo_name).toBe(before?.repo_name);
      });

      it("github_pull_requests: User B cannot update Board A's PR", async () => {
        const { data: before } = await adminClient
          .from("github_pull_requests")
          .select("title")
          .eq("id", fixture.prId)
          .single();

        await fixture.ownerB.client
          .from("github_pull_requests")
          .update({ title: "HIJACKED PR" })
          .eq("id", fixture.prId);

        const { data: after } = await adminClient
          .from("github_pull_requests")
          .select("title")
          .eq("id", fixture.prId)
          .single();

        expect(after?.title).toBe(before?.title);
      });

      it("github_reviews: User B cannot update Board A's review state", async () => {
        const { data: before } = await adminClient
          .from("github_reviews")
          .select("state")
          .eq("id", fixture.reviewId)
          .single();

        await fixture.ownerB.client
          .from("github_reviews")
          .update({ state: "CHANGES_REQUESTED" })
          .eq("id", fixture.reviewId);

        const { data: after } = await adminClient
          .from("github_reviews")
          .select("state")
          .eq("id", fixture.reviewId)
          .single();

        expect(after?.state).toBe(before?.state);
      });

      it("github_review_comments: User B cannot update Board A's comment body", async () => {
        const { data: before } = await adminClient
          .from("github_review_comments")
          .select("body")
          .eq("id", fixture.commentId)
          .single();

        await fixture.ownerB.client
          .from("github_review_comments")
          .update({ body: "HIJACKED COMMENT" })
          .eq("id", fixture.commentId);

        const { data: after } = await adminClient
          .from("github_review_comments")
          .select("body")
          .eq("id", fixture.commentId)
          .single();

        expect(after?.body).toBe(before?.body);
      });
    });

    describe("DELETE denial (row still exists, verified via admin)", () => {
      it("boards: User B cannot delete Board A", async () => {
        await fixture.ownerB.client.from("boards").delete().eq("id", fixture.ownerA.boardId);

        const { data } = await adminClient.from("boards").select("id").eq("id", fixture.ownerA.boardId);
        expect(data).toHaveLength(1);
      });

      it("board_members: User B cannot delete Board A's owner membership", async () => {
        await fixture.ownerB.client
          .from("board_members")
          .delete()
          .eq("board_id", fixture.ownerA.boardId)
          .eq("user_id", fixture.ownerA.userId);

        const { data } = await adminClient
          .from("board_members")
          .select("user_id")
          .eq("board_id", fixture.ownerA.boardId);
        expect(data).toHaveLength(1);
      });

      it("github_repos: User B cannot delete Board A's repo", async () => {
        await fixture.ownerB.client.from("github_repos").delete().eq("id", fixture.repoId);

        const { data } = await adminClient.from("github_repos").select("id").eq("id", fixture.repoId);
        expect(data).toHaveLength(1);
      });

      it("github_pull_requests: User B cannot delete Board A's PR", async () => {
        await fixture.ownerB.client.from("github_pull_requests").delete().eq("id", fixture.prId);

        const { data } = await adminClient.from("github_pull_requests").select("id").eq("id", fixture.prId);
        expect(data).toHaveLength(1);
      });

      it("github_reviews: User B cannot delete Board A's review", async () => {
        await fixture.ownerB.client.from("github_reviews").delete().eq("id", fixture.reviewId);

        const { data } = await adminClient.from("github_reviews").select("id").eq("id", fixture.reviewId);
        expect(data).toHaveLength(1);
      });

      it("github_review_comments: User B cannot delete Board A's comment", async () => {
        await fixture.ownerB.client.from("github_review_comments").delete().eq("id", fixture.commentId);

        const { data } = await adminClient.from("github_review_comments").select("id").eq("id", fixture.commentId);
        expect(data).toHaveLength(1);
      });

      it("board_contributors: User B cannot delete Board A's contributor", async () => {
        await fixture.ownerB.client
          .from("board_contributors")
          .delete()
          .eq("board_id", fixture.ownerA.boardId)
          .eq("github_id", fixture.contributorGithubId);

        const { data } = await adminClient
          .from("board_contributors")
          .select("github_id")
          .eq("board_id", fixture.ownerA.boardId);
        expect(data).toHaveLength(1);
      });
    });
  });

  // ─── service function isolation ───────────────────────────────────────────
  // Service functions pass User B's client — RLS enforced identically.

  describe("service function isolation", () => {
    it("getBoardWithRole: returns null for non-member", async () => {
      const result = await getBoardWithRole(fixture.ownerB.client, fixture.ownerA.boardId, fixture.ownerB.userId);
      expect(result).toBeNull();
    });

    it("getBoardRepos: returns [] for non-member", async () => {
      const result = await getBoardRepos(fixture.ownerB.client, fixture.ownerA.boardId);
      expect(result).toEqual([]);
    });

    it("getBoardContributors: returns [] for non-member", async () => {
      const result = await getBoardContributors(fixture.ownerB.client, fixture.ownerA.boardId);
      expect(result).toEqual([]);
    });
  });

  // ─── indirect join denial ─────────────────────────────────────────────────
  // Tests the get_board_id_for_pr() → is_board_member() chain in RLS policies
  // for github_reviews and github_review_comments.

  describe("indirect join denial", () => {
    it("github_reviews: User B cannot read reviews via Board A's PR ID", async () => {
      const { data, error } = await fixture.ownerB.client
        .from("github_reviews")
        .select("*")
        .eq("pull_request_id", fixture.prId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("github_review_comments: User B cannot read comments via Board A's PR ID", async () => {
      const { data, error } = await fixture.ownerB.client
        .from("github_review_comments")
        .select("*")
        .eq("pull_request_id", fixture.prId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("github_reviews: non-existent PR ID returns [] (NULL board_id path)", async () => {
      // get_board_id_for_pr(non_existent) returns NULL → is_board_member(NULL) → false
      const { data, error } = await fixture.ownerB.client
        .from("github_reviews")
        .select("*")
        .eq("pull_request_id", 9999999999999);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("github_review_comments: non-existent PR ID returns [] (NULL board_id path)", async () => {
      const { data, error } = await fixture.ownerB.client
        .from("github_review_comments")
        .select("*")
        .eq("pull_request_id", 9999999999999);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });
  });

  // ─── REVOKE ALL gap verification ──────────────────────────────────────────
  // All 7 tables are missing `REVOKE ALL FROM authenticated` (known gap).
  // These tests document that RLS still denies cross-board access despite this
  // gap — a future `REVOKE ALL FROM authenticated` migration should reference
  // these tests to confirm the security posture before and after the fix.

  describe("REVOKE ALL gap verification (RLS denies despite missing REVOKE ALL FROM authenticated)", () => {
    it("boards: RLS denies cross-board SELECT even without REVOKE ALL FROM authenticated", async () => {
      const { data, error } = await fixture.ownerB.client.from("boards").select("*").eq("id", fixture.ownerA.boardId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("board_members: RLS denies cross-board SELECT even without REVOKE ALL FROM authenticated", async () => {
      const { data, error } = await fixture.ownerB.client
        .from("board_members")
        .select("*")
        .eq("board_id", fixture.ownerA.boardId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("github_repos: RLS denies cross-board SELECT even without REVOKE ALL FROM authenticated", async () => {
      const { data, error } = await fixture.ownerB.client
        .from("github_repos")
        .select("*")
        .eq("board_id", fixture.ownerA.boardId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("github_pull_requests: RLS denies cross-board SELECT even without REVOKE ALL FROM authenticated", async () => {
      const { data, error } = await fixture.ownerB.client
        .from("github_pull_requests")
        .select("*")
        .eq("id", fixture.prId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("github_reviews: RLS denies cross-board SELECT even without REVOKE ALL FROM authenticated", async () => {
      const { data, error } = await fixture.ownerB.client.from("github_reviews").select("*").eq("id", fixture.reviewId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("github_review_comments: RLS denies cross-board SELECT even without REVOKE ALL FROM authenticated", async () => {
      const { data, error } = await fixture.ownerB.client
        .from("github_review_comments")
        .select("*")
        .eq("id", fixture.commentId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("board_contributors: RLS denies cross-board SELECT even without REVOKE ALL FROM authenticated", async () => {
      const { data, error } = await fixture.ownerB.client
        .from("board_contributors")
        .select("*")
        .eq("board_id", fixture.ownerA.boardId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });
  });
});
