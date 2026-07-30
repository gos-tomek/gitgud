import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createBoardViaWizard, deleteBoardViaUI, mockGitHubApis } from "./fixtures.js";

// Risk coverage (test-plan.md §2):
//   R5 — settings API unauthorized mutation
//   #1 — cross-board isolation: UI hides controls + API returns 403 for non-owners
//
// Two browser contexts are used:
//   owner  — creates the board and deletes it in afterAll
//   viewer — navigates to the board's settings and attempts API mutations
//
// What is real vs mocked:
//   Real  — auth sessions (both users), routing, RLS, getBoardWithRole 403 check
//   Mocked — /api/github/repos and /api/github/collaborators (owner board creation only)
//
// The viewer is seeded as a board contributor via the owner's POST /api/board/{id}/contributors
// using the viewer's actual github_id (read from auth admin user_metadata). This avoids the mock
// ID mismatch that would break the identity bridge (board_contributors.github_id =
// user_profiles.github_id). Phase 3 already covers the add-contributor dialog flow.
//
test.describe.configure({ mode: "serial" });

let boardId = "";
const boardName = `Non-Owner Test ${Date.now()}`;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);

  const viewerEmail = process.env.E2E_VIEWER_EMAIL;
  if (!viewerEmail) throw new Error("E2E_VIEWER_EMAIL must be set");

  // ── Resolve viewer's github profile via auth admin API ─────────────────────
  // The identity bridge (board_contributors.github_id ⟕ user_profiles.github_id)
  // requires the contributor row to carry the viewer's actual github_id from their
  // OAuth signup. The auth admin API (separate from PostgREST) accepts the service key.
  const serviceKey = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) throw new Error("SUPABASE_SERVICE_KEY must be set in .dev.vars");
  const adminSb = createClient(process.env.SUPABASE_URL ?? "http://127.0.0.1:54321", serviceKey, {
    auth: { persistSession: false },
  });

  const { data: usersData, error: listErr } = await adminSb.auth.admin.listUsers();
  if (listErr) throw new Error(`listUsers failed: ${listErr.message}`);
  const viewerUser = usersData.users.find((u) => u.email === viewerEmail);
  if (!viewerUser) throw new Error(`Viewer user ${viewerEmail} not found in auth.users`);

  const viewerGithubId = viewerUser.user_metadata.github_id as number | undefined;
  const viewerGithubLogin = viewerUser.user_metadata.github_login as string | undefined;
  const viewerAvatarUrl = (viewerUser.user_metadata.avatar_url as string | undefined) ?? null;
  if (!viewerGithubId || !viewerGithubLogin) {
    throw new Error(
      `Viewer ${viewerEmail} is missing github_id/github_login in user_metadata. ` +
        `Ensure the viewer account was created with these fields in the signup metadata.`,
    );
  }

  // ── Create board via wizard ─────────────────────────────────────────────────
  const ctx = await browser.newContext({ storageState: "playwright/.auth/user.json" });
  const page = await ctx.newPage();
  await mockGitHubApis(page);

  boardId = await createBoardViaWizard(page, boardName);

  // ── Seed viewer as contributor via owner's authenticated session ────────────
  // Using the owner's page.request avoids the need for service_role table access
  // (which the local Supabase doesn't grant to service_role by default on these tables).
  // The contributor API endpoint enforces supervisor-only writes, so only the owner can add.
  const addRes = await page.request.fetch(`/api/board/${boardId}/contributors`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    data: JSON.stringify({
      contributors: [{ githubId: viewerGithubId, githubLogin: viewerGithubLogin, avatarUrl: viewerAvatarUrl }],
    }),
  });
  if (addRes.status() !== 201) {
    throw new Error(`Failed to seed viewer as contributor: HTTP ${addRes.status()}`);
  }

  await ctx.close();
});

test.afterAll(async ({ browser }) => {
  if (!boardId) return;
  const ctx = await browser.newContext({ storageState: "playwright/.auth/user.json" });
  const page = await ctx.newPage();
  await mockGitHubApis(page);

  await page.goto(`/board/${boardId}/settings`);
  await page.waitForLoadState("networkidle");

  const deleteBtn = page.getByRole("button", { name: "Delete board" });
  if (!(await deleteBtn.isVisible())) {
    await ctx.close();
    return;
  }

  await deleteBoardViaUI(page, boardId, boardName);
  await ctx.close();
});

test("viewer settings page: read-only content, no mutation controls", async ({ browser }) => {
  test.setTimeout(60_000);
  const viewerCtx = await browser.newContext({ storageState: "playwright/.auth/viewer.json" });
  const page = await viewerCtx.newPage();

  await page.goto(`/board/${boardId}/settings`);
  await page.waitForLoadState("networkidle");

  // Board name rendered as static text in the settings content section.
  // getByText(boardName) matches multiple elements (topbar, nav, content) — scope
  // to the last occurrence which is the <span> in the "Board name" card.
  await expect(page.getByText(boardName).last()).toBeVisible();
  await expect(page.getByRole("button", { name: /edit/i })).not.toBeVisible();

  // Repositories section: no "Add repository" button, no per-item remove buttons
  await expect(page.getByRole("button", { name: "Add repository" })).not.toBeVisible();
  await expect(page.getByRole("button", { name: /^Remove .+\/.+/ })).not.toBeVisible();

  // Contributors section: no "Add contributors" button, no per-item remove buttons; alice-dev listed as static link
  await expect(page.getByRole("button", { name: "Add contributors" })).not.toBeVisible();
  await expect(page.getByRole("button", { name: /^Remove @/ })).not.toBeVisible();
  await expect(page.getByText("@alice-dev")).toBeVisible();

  // Danger zone absent (no "Delete board" button)
  await expect(page.getByRole("button", { name: "Delete board" })).not.toBeVisible();

  await viewerCtx.close();
});

test("viewer API mutations return 403", async ({ browser }) => {
  test.setTimeout(30_000);
  const viewerCtx = await browser.newContext({ storageState: "playwright/.auth/viewer.json" });
  const page = await viewerCtx.newPage();

  // Navigate once to activate session cookies in the context before making API calls
  await page.goto(`/board/${boardId}/settings`);
  await page.waitForLoadState("networkidle");

  // PATCH /settings — getBoardWithRole returns role "contributor" → 403
  const settingsRes = await page.request.fetch(`/api/board/${boardId}/settings`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    data: JSON.stringify({ name: "hacked" }),
  });
  expect(settingsRes.status()).toBe(403);

  // POST /contributors — same getBoardWithRole check → 403
  const addRes = await page.request.fetch(`/api/board/${boardId}/contributors`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    data: JSON.stringify({ contributors: [{ githubId: 99999, githubLogin: "hacker" }] }),
  });
  expect(addRes.status()).toBe(403);

  // DELETE /contributors — same getBoardWithRole check → 403
  const removeRes = await page.request.fetch(`/api/board/${boardId}/contributors`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    data: JSON.stringify({ githubId: 99001 }),
  });
  expect(removeRes.status()).toBe(403);

  // DELETE /api/board/{id} — also returns 403 for non-owners
  const deleteRes = await page.request.fetch(`/api/board/${boardId}`, { method: "DELETE" });
  expect(deleteRes.status()).toBe(403);

  await viewerCtx.close();
});
