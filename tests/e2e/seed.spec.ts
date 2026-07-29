import { test, expect } from "@playwright/test";
import { createBoardViaWizard, deleteBoardViaUI, mockGitHubApis } from "./fixtures.js";

// Seed test — demonstrates E2E patterns for this project.
// Playwright Test Agents (Planner/Generator) use this file as the template for
// all generated tests. Whatever patterns appear here get replicated.
//
// Session: playwright.config.ts injects playwright/.auth/user.json via storageState.
// Every test starts already logged in — no UI login step needed.
//
// What is real vs mocked:
//   Real  — auth session, routing, /api/board (POST + DELETE), Supabase RPC + cascade
//   Mocked — /api/github/repos and /api/github/collaborators (external, non-deterministic)
//
// Prerequisite: auth.setup.ts seeds the test user's GitHub PAT via the real profile/pat
// endpoint. The wizard starts in usingStoredPat: true — no new token entry needed.
//
// Risk coverage (test-plan.md §2):
//   Risk #3 — board wizard carries state through all 3 steps and submits complete data
//   Risk #8 — board DELETE cascades cleanly; board unreachable after deletion

// Fixed repo and collaborator so wizard steps 2 and 3 are deterministic.
// page.route() must be registered before the navigation that triggers the request.
// beforeEach runs before each test, so this guarantee holds automatically.
test.beforeEach(async ({ page }) => {
  await mockGitHubApis(page);
});

test("board lifecycle: wizard completes and board survives until explicit delete", async ({ page }) => {
  const boardName = `Seed Board ${Date.now()}`;

  // ── Create ─────────────────────────────────────────────────────────────────
  const boardId = await createBoardViaWizard(page, boardName);

  await page.waitForLoadState("networkidle");
  await expect(page.getByText(boardName).first()).toBeVisible();

  // ── Assert board data in settings ─────────────────────────────────────────
  await page.getByRole("link", { name: "Settings" }).click();
  await page.waitForURL(/\/settings$/);
  await page.waitForLoadState("networkidle");

  await expect(page.getByText(boardName).first()).toBeVisible();
  await expect(page.getByText("acme-org/backend")).toBeVisible();
  await expect(page.getByText("@alice-dev")).toBeVisible();

  // ── Delete ─────────────────────────────────────────────────────────────────
  await deleteBoardViaUI(page, boardId, boardName);
  await expect(page).not.toHaveURL(new RegExp(boardId));
});
