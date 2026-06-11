import type { SupabaseClient } from "@supabase/supabase-js";
import { adminClient, createTestUser, cleanupBoard, cleanupUser } from "../helpers/supabase.js";
import { checkSupabase } from "../helpers/setup.js";
import { startAstroServer, readDevVarsKey, type AstroServerHandle } from "../helpers/astro-server.js";
import { createAuthenticatedFetch } from "../helpers/auth-fetch.js";

// ─── sentinel values ──────────────────────────────────────────────────────────
// The PAT is intentionally invalid — it causes GitHub API calls to fail so we
// can assert the raw token never surfaces in error responses or log output.
const TEST_PAT = "ghp_TestSentinelPAT_NEVER_LEAK_THIS_1234";
const DEV_SERVER_PORT = 4322;

// ─── availability guards ──────────────────────────────────────────────────────
const supabaseAvailable = await checkSupabase();

// The encryption key the server uses to decrypt the PAT on every sync request.
// We must use the same key in test setup when storing the sentinel PAT so that
// the server's `get_board_github_pat` RPC can decrypt it and trigger a GitHub
// auth failure (rather than a decrypt failure, which would not reach the PAT).
const ENCRYPTION_KEY = process.env.GITHUB_TOKEN_ENCRYPTION_KEY ?? readDevVarsKey("GITHUB_TOKEN_ENCRYPTION_KEY");

const canRun = supabaseAvailable && !!ENCRYPTION_KEY;

// ─── test suite ───────────────────────────────────────────────────────────────
describe.skipIf(!canRun)("PAT non-leakage (Risk #2)", () => {
  let ownerUserId: string;
  let ownerBoardId: string;
  let ownerClient: SupabaseClient;
  let contributorUserId: string;
  let contributorClient: SupabaseClient;
  let server: AstroServerHandle;
  let ownerFetch: ReturnType<typeof createAuthenticatedFetch>;
  let contributorFetch: ReturnType<typeof createAuthenticatedFetch>;

  beforeAll(async () => {
    const ts = Date.now();

    // 1. Create owner and contributor users
    const [ownerResult, contributorResult] = await Promise.all([
      createTestUser(`pat-leak-owner-${ts}@test.local`),
      createTestUser(`pat-leak-contrib-${ts}@test.local`),
    ]);
    ownerUserId = ownerResult.userId;
    ownerClient = ownerResult.client;
    contributorUserId = contributorResult.userId;
    contributorClient = contributorResult.client;

    // 2. Create the board, store the sentinel PAT, and link a repo in one
    //    atomic call. create_board_atomic is a SECURITY DEFINER function that
    //    validates p_user_id = auth.uid() — it must be called as the owner,
    //    not the admin service role (which has auth.uid() = null). The
    //    boards_insert_owner_as_member trigger auto-enrolls the owner.
    //    A repo is required so the sync endpoint gets past the early-exit guard
    //    (syncBoardGitHubData returns early when repos.length === 0 without
    //    ever decrypting the PAT, so we need at least one repo to reach the
    //    GitHub API call that fails with an auth error).
    const createResult = await ownerClient.rpc("create_board_atomic", {
      p_user_id: ownerUserId,
      p_name: `PAT Leak Test ${ts}`,
      p_raw_token: TEST_PAT,
      p_encryption_key: ENCRYPTION_KEY,
      p_repos: [{ owner: "test-org", name: "test-repo-pat-leak" }],
      p_contributors: [],
    });
    if (createResult.error) throw new Error(`Failed to create board: ${createResult.error.message}`);
    ownerBoardId = createResult.data as string;

    // 3. Add contributor as a board member (requires admin — owner-only by RLS;
    //    contributors aren't added via create_board_atomic)
    const { error: memberError } = await adminClient
      .from("board_members")
      .insert({ board_id: ownerBoardId, user_id: contributorUserId });
    if (memberError) throw new Error(`Failed to add contributor: ${memberError.message}`);

    // 4. Start the Astro dev server (reads GITHUB_TOKEN_ENCRYPTION_KEY from
    //    .dev.vars, which must match ENCRYPTION_KEY used in step 2 above).
    server = await startAstroServer(DEV_SERVER_PORT);

    ownerFetch = createAuthenticatedFetch(ownerClient, server.baseUrl);
    contributorFetch = createAuthenticatedFetch(contributorClient, server.baseUrl);
  }, 150_000);

  afterAll(async () => {
    try {
      await server.stop();
    } finally {
      await cleanupBoard(ownerBoardId);
      await Promise.all([cleanupUser(ownerUserId), cleanupUser(contributorUserId)]);
    }
  });

  // ─── Vector #1/#2: response body ────────────────────────────────────────────
  // sync.ts outer catch returns `err.message` verbatim (Vector #1).
  // github-sync.ts per-PR catch pushes `err.message` into SyncResult.errors[]
  // which is serialised into the response body (Vector #2).

  describe("sync error response does not contain PAT (Vectors #1/#2)", () => {
    let responseBody: string;

    beforeAll(async () => {
      const res = await ownerFetch("/api/github/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ boardId: ownerBoardId }),
      });
      responseBody = await res.text();
      // Sync must fail (PAT is invalid) — a 200 would mean we never hit GitHub.
      expect(res.status).not.toBe(200);
    }, 30_000);

    it("response body does not contain the test PAT", () => {
      expect(responseBody).not.toContain(TEST_PAT);
    });

    it("response body does not contain the encryption key", () => {
      expect(responseBody).not.toContain(ENCRYPTION_KEY);
    });
  });

  // ─── Vector #3/#4: server log output ─────────────────────────────────────────
  // src/lib/logger.ts is a bare consola re-export with zero sanitization.
  // Six catch blocks near PAT-handling code call logger.error(tag, err).
  // Cloudflare observability (wrangler.jsonc) persists all console output.

  describe("server output does not contain PAT (Vectors #3/#4)", () => {
    it("server stdout/stderr does not contain the test PAT", () => {
      const allOutput = server.output().join("\n");
      expect(allOutput).not.toContain(TEST_PAT);
    });

    it("server stdout/stderr does not contain the encryption key", () => {
      const allOutput = server.output().join("\n");
      expect(allOutput).not.toContain(ENCRYPTION_KEY);
    });
  });

  // ─── pre-PAT error paths ─────────────────────────────────────────────────────
  // These paths never decrypt the PAT — they fail before reaching createGitHubClient.
  // Exact hardcoded strings confirm no internal state leaks into early-exit responses.

  describe("pre-PAT-handling error paths return exact hardcoded messages", () => {
    it("no auth cookie → 401 Unauthorized", async () => {
      const res = await fetch(`${server.baseUrl}/api/github/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ boardId: ownerBoardId }),
      });
      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("Unauthorized");
    });

    it("contributor (non-owner member) → 403 Only the board owner can trigger a sync", async () => {
      const res = await contributorFetch("/api/github/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ boardId: ownerBoardId }),
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("Only the board owner can trigger a sync");
    });

    it("non-existent boardId → 404 Board not found", async () => {
      const res = await ownerFetch("/api/github/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ boardId: "00000000-0000-0000-0000-000000000000" }),
      });
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("Board not found");
    });
  });
});
