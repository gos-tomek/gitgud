import { createClient } from "@supabase/supabase-js";
import { test, expect } from "@playwright/test";
import { mockGitHubApis } from "./fixtures.js";

// Risk coverage (test-plan.md §2):
//   Risk #8  — board DELETE cascades cleanly; board URL unreachable after deletion
//   Dashboard — /dashboard redirects to the active board after creation
//
// Template: tests/e2e/seed.spec.ts
// Rules:    tests/e2e/e2e-rules.md
//
// What is real vs mocked:
//   Real  — auth session, routing, board POST/DELETE, Supabase cascade
//   Mocked — /api/github/repos and /api/github/collaborators
//
// beforeAll deletes stale boards left by previous failed runs so the initial
// empty-state assertion starts from a known clean slate.

async function deleteOwnerBoards(): Promise<void> {
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;
  const supabaseUrl = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
  // SUPABASE_KEY is the anon key — sign in as the owner user so RLS allows the delete.
  const supabaseKey =
    process.env.SUPABASE_KEY ??
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
  if (!email || !password) return;
  const userClient = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
  const { error } = await userClient.auth.signInWithPassword({ email, password });
  if (error) return;
  await userClient.from("boards").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  // No signOut — avoids any risk of revoking the browser session's refresh token.
}

test.beforeAll(async () => {
  await deleteOwnerBoards();
});

test.beforeEach(async ({ page }) => {
  await mockGitHubApis(page);
});

test("board lifecycle: dashboard redirects to created board, board URL unreachable after delete", async ({ page }) => {
  test.setTimeout(120_000);
  const boardName = `Board Lifecycle ${Date.now()}`;

  // ── Step 1: Dashboard shows empty state (no boards for this user) ─────────
  await page.goto("/dashboard");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { name: "Welcome to GitGud" })).toBeVisible();
  await expect(page.getByRole("link", { name: "+ Create your first board" })).toBeVisible();

  // ── Step 2: Create board via wizard (same pattern as seed test) ───────────
  await page.goto("/board/new");
  await page.waitForLoadState("networkidle");
  await expect(page.getByText(/Connected as/)).toBeVisible();

  await page.getByRole("textbox", { name: "Board name" }).pressSequentially(boardName);
  await expect(page.getByRole("button", { name: "Next" })).toBeEnabled();
  await page.getByRole("button", { name: "Next" }).click();

  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Step 2 of 3")).toBeVisible();
  await page.getByRole("checkbox", { name: /acme-org\/backend/ }).click();
  await expect(page.getByRole("button", { name: "Next" })).toBeEnabled();
  await page.getByRole("button", { name: "Next" }).click();

  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Step 3 of 3")).toBeVisible();
  await page.getByText("@alice-dev").click();
  await expect(page.getByRole("button", { name: "Create Board" })).toBeEnabled();
  await page.getByRole("button", { name: "Create Board" }).click();

  await page.waitForURL(/\/board\/[^/]+\//);
  const boardId = /\/board\/([^/]+)\//.exec(page.url())?.[1] ?? "";
  expect(boardId).toBeTruthy();

  // ── Step 3: /dashboard redirects to a board after creation ────────────────
  // getUserBoards sorts by created_at DESC; in parallel mode another spec may
  // create a newer board, so we only verify redirect behavior (not exact ID).
  await page.goto("/dashboard");
  await page.waitForURL(/\/board\//);
  // Confirm our specific board is directly accessible (creation was persisted).
  await page.goto(`/board/${boardId}/settings`);
  await page.waitForLoadState("networkidle");
  await expect(page.getByText(boardName).first()).toBeVisible();

  // ── Step 4: Delete board from settings ───────────────────────────────────
  // Already on the settings page from Step 3 — no second goto needed.
  await page.getByRole("button", { name: "Delete board" }).click();
  await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();

  await page.getByRole("textbox", { name: /Type .* to confirm/i }).fill(boardName);
  await expect(page.getByRole("button", { name: "Permanently delete board" })).toBeEnabled();
  await page.getByRole("button", { name: "Permanently delete board" }).click();

  await page.waitForURL((url) => !url.href.includes(boardId));
  await expect(page).not.toHaveURL(new RegExp(boardId));

  // ── Step 5: Deleted board URL is unreachable (Risk #8 cascade) ───────────
  await page.goto(`/board/${boardId}/settings`);
  await page.waitForURL((url) => !url.pathname.startsWith(`/board/${boardId}`));
  await expect(page).not.toHaveURL(new RegExp(boardId));

  // ── Step 6: Dashboard returns to empty state after deletion ──────────────
  await page.goto("/dashboard");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { name: "Welcome to GitGud" })).toBeVisible();
});
