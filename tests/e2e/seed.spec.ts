import { test, expect } from "@playwright/test";

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
  await page.route("**/api/github/repos", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        repos: [{ owner: "acme-org", name: "backend", fullName: "acme-org/backend", private: false, pushAccess: true }],
      }),
    }),
  );

  await page.route("**/api/github/collaborators", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        collaborators: [
          {
            id: 99001,
            login: "alice-dev",
            avatarUrl: "https://avatars.githubusercontent.com/u/99001",
            type: "Collaborator",
          },
        ],
      }),
    }),
  );
});

test("board lifecycle: wizard completes and board survives until explicit delete", async ({ page }) => {
  const boardName = `Seed Board ${Date.now()}`;

  // ── Step 1: board name ────────────────────────────────────────────────────
  await page.goto("/board/new");
  await page.waitForLoadState("networkidle");
  await expect(page.getByText(/Connected as/)).toBeVisible();

  await page.getByRole("textbox", { name: "Board name" }).pressSequentially(boardName);
  await expect(page.getByRole("button", { name: "Next" })).toBeEnabled();

  await page.getByRole("button", { name: "Next" }).click();

  // ── Step 2: select repository ──────────────────────────────────────────────
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Step 2 of 3")).toBeVisible();
  await expect(page.getByText("acme-org/backend")).toBeVisible();

  await page.getByRole("checkbox", { name: /acme-org\/backend/ }).click();
  await expect(page.getByRole("button", { name: "Next" })).toBeEnabled();

  await page.getByRole("button", { name: "Next" }).click();

  // ── Step 3: select contributor ─────────────────────────────────────────────
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Step 3 of 3")).toBeVisible();
  await expect(page.getByText("@alice-dev")).toBeVisible();

  await page.getByText("@alice-dev").click();
  await expect(page.getByRole("button", { name: "Create Board" })).toBeEnabled();

  await page.getByRole("button", { name: "Create Board" }).click();

  // ── Create ─────────────────────────────────────────────────────────────────
  await page.waitForURL(/\/board\/[^/]+\//);
  const boardId = /\/board\/([^/]+)\//.exec(page.url())?.[1] ?? "";

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
  await page.getByRole("button", { name: "Delete board" }).click();
  await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();

  await page.getByRole("textbox", { name: /Type .* to confirm/i }).fill(boardName);
  await expect(page.getByRole("button", { name: "Permanently delete board" })).toBeEnabled();

  await page.getByRole("button", { name: "Permanently delete board" }).click();

  await page.waitForURL((url) => !url.href.includes(boardId));
  await expect(page).not.toHaveURL(new RegExp(boardId));
});
