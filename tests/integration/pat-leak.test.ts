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
  // Set once the Vectors #1/#2 dispatch resolves — terminated in afterAll so the Workflow
  // instance doesn't keep retrying against a bad PAT (and, soon, a deleted board) in the
  // background after the test process exits.
  let dispatchedInstanceId: string | null = null;

  beforeAll(async () => {
    const ts = Date.now();

    // 1. Create owner and contributor users. The contributor's github_id must match a
    //    board_contributors row (added in step 3) — under the derived access model,
    //    that join is what makes them a board member at all.
    const contributorGithubId = ts + 1;
    const [ownerResult, contributorResult] = await Promise.all([
      createTestUser(`pat-leak-owner-${ts}@test.local`),
      createTestUser(`pat-leak-contrib-${ts}@test.local`, undefined, {
        id: contributorGithubId,
        login: `pat-leak-contrib-${ts}`,
      }),
    ]);
    ownerUserId = ownerResult.userId;
    ownerClient = ownerResult.client;
    contributorUserId = contributorResult.userId;
    contributorClient = contributorResult.client;

    // 2. Store the sentinel PAT on the owner's profile (per-user PAT model), then create the
    //    board and link a repo. Both calls are SECURITY DEFINER functions that validate
    //    p_user_id = auth.uid() — they must run as the owner, not the admin service role
    //    (which has auth.uid() = null). The boards_insert_owner_as_member trigger auto-enrolls
    //    the owner. A repo is required so the dispatched Workflow's list-and-upsert-prs step actually
    //    has something to sync — with zero repos, `listBoardRepos` returns empty and the
    //    Workflow never decrypts the PAT or calls GitHub, so the auth-error log line we poll
    //    for below would never appear.
    const setPatResult = await ownerClient.rpc("set_user_github_pat", {
      p_user_id: ownerUserId,
      p_raw_token: TEST_PAT,
      p_encryption_key: ENCRYPTION_KEY,
      p_expires_at: null,
      p_github_login: `pat-leak-owner-${ts}`,
    });
    if (setPatResult.error) throw new Error(`Failed to set PAT: ${setPatResult.error.message}`);

    const createResult = await ownerClient.rpc("create_board_atomic", {
      p_user_id: ownerUserId,
      p_name: `PAT Leak Test ${ts}`,
      p_repos: [{ owner: "test-org", name: "test-repo-pat-leak" }],
      p_contributors: [],
    });
    if (createResult.error) throw new Error(`Failed to create board: ${createResult.error.message}`);
    ownerBoardId = createResult.data as string;

    // 3. Add contributor via board_contributors (requires admin — owner-only by RLS;
    //    contributors aren't added via create_board_atomic). Board access is derived from
    //    this row joined against the contributor's user_profiles.github_id.
    const { error: memberError } = await adminClient
      .from("board_contributors")
      .insert({ board_id: ownerBoardId, github_id: contributorGithubId, github_login: `pat-leak-contrib-${ts}` });
    if (memberError) throw new Error(`Failed to add contributor: ${memberError.message}`);

    // 4. Start the Astro dev server (reads GITHUB_TOKEN_ENCRYPTION_KEY from
    //    .dev.vars, which must match ENCRYPTION_KEY used in step 2 above).
    server = await startAstroServer(DEV_SERVER_PORT);

    ownerFetch = createAuthenticatedFetch(ownerClient, server.baseUrl);
    contributorFetch = createAuthenticatedFetch(contributorClient, server.baseUrl);
  }, 150_000);

  afterAll(async () => {
    // Best-effort: terminate while the server (and the board it needs to authorize the call)
    // still exist. Swallow failures — an instance that already errored out on its own is fine too.
    // The Content-Type header isn't meaningful here (no body) but is required to pass Astro's
    // origin-check middleware: an unsafe method with no Content-Type and no matching `Origin`
    // header (Node's fetch sends neither) is rejected outright. A real browser fetch wouldn't
    // need this — it always sends a same-origin `Origin` header automatically.
    if (dispatchedInstanceId) {
      await ownerFetch(`/api/github/sync/status?boardId=${ownerBoardId}&instanceId=${dispatchedInstanceId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
      }).catch(() => undefined);
    }
    try {
      await server.stop();
    } finally {
      await cleanupBoard(ownerBoardId);
      await Promise.all([cleanupUser(ownerUserId), cleanupUser(contributorUserId)]);
    }
  });

  // ─── Vector #1/#2: response body ────────────────────────────────────────────
  // Since classification-batch (p5), POST /api/github/sync dispatches a
  // ClassificationBatchWorkflow instance and returns immediately — it no longer runs the
  // GitHub sync in-request, so the response can no longer carry a sync error (sanitised or
  // not). These assertions now guard the dispatch path itself: the instanceId/status body
  // must never echo a secret, regardless of what happens later inside the Workflow.

  describe("sync dispatch response does not contain PAT (Vectors #1/#2)", () => {
    let responseBody: string;

    beforeAll(async () => {
      const res = await ownerFetch("/api/github/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ boardId: ownerBoardId }),
      });
      responseBody = await res.text();
      // Dispatch succeeds even though the PAT is invalid — the bad PAT only surfaces once the
      // Workflow's sync step actually calls GitHub, which now happens after this response.
      expect(res.status).toBe(200);
      dispatchedInstanceId = (JSON.parse(responseBody) as { instanceId: string }).instanceId;
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
  // The dispatched Workflow instance hits GitHub with the sentinel PAT asynchronously; its
  // list-and-upsert-prs step fails (GitHubAuthError) and the failure is logged by `runStep` in
  // src/worker.ts. Poll for that log line before asserting — checking immediately after
  // dispatch would race the Workflow's background execution and pass vacuously.

  describe("server output does not contain PAT (Vectors #3/#4)", () => {
    beforeAll(async () => {
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        if (server.output().some((line) => line.includes('Step "list-and-upsert-prs" failed'))) return;
        await new Promise((r) => setTimeout(r, 500));
      }
      throw new Error(
        `Timed out waiting for the Workflow's list-and-upsert-prs step failure to appear in server output.\nLast output:\n${server.output().slice(-30).join("\n")}`,
      );
    }, 35_000);

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
