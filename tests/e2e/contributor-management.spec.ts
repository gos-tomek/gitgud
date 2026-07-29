import { test, expect } from "@playwright/test";
import { createBoardViaWizard, deleteBoardViaUI, mockGitHubApis } from "./fixtures.js";

// Risk coverage (test-plan.md §2):
//   Contributor CRUD — add via dialog → verify settings + impact nav → remove → verify gone
//
// Template: tests/e2e/seed.spec.ts
// Rules:    tests/e2e/e2e-rules.md
//
// What is real vs mocked:
//   Real  — auth session, routing, contributor POST/DELETE, Supabase RLS
//   Mocked — /api/github/repos and /api/github/collaborators
//
// Board is created once in beforeAll (alice-dev as sole initial contributor)
// and deleted in afterAll. The three tests are sequential steps of one workflow:
// add bob-viewer → verify in settings + impact nav → remove bob-viewer.
//
// Serial mode is required: tests share module-level boardId across beforeAll/afterAll.
// fullyParallel:true would otherwise give each test its own worker with its own boardId.
test.describe.configure({ mode: "serial" });

let boardId = "";
const boardName = `Contributor Mgmt ${Date.now()}`;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await browser.newContext({ storageState: "playwright/.auth/user.json" });
  const page = await ctx.newPage();
  await mockGitHubApis(page);

  // ── Create board via wizard (alice-dev only; bob-viewer is added in the tests) ──
  boardId = await createBoardViaWizard(page, boardName);

  await ctx.close();
});

test.afterAll(async ({ browser }) => {
  if (!boardId) return;
  const ctx = await browser.newContext({ storageState: "playwright/.auth/user.json" });
  const page = await ctx.newPage();
  await mockGitHubApis(page);

  await page.goto(`/board/${boardId}/settings`);
  await page.waitForLoadState("networkidle");

  // Only attempt delete if the board still exists (afterAll runs even on test failure)
  const deleteBtn = page.getByRole("button", { name: "Delete board" });
  if (!(await deleteBtn.isVisible())) {
    await ctx.close();
    return;
  }

  await deleteBoardViaUI(page, boardId, boardName);
  await ctx.close();
});

test.beforeEach(async ({ page }) => {
  await mockGitHubApis(page);
});

test("add contributor: bob-viewer added via dialog and appears in settings list", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto(`/board/${boardId}/settings`);
  await page.waitForLoadState("networkidle");

  // Open the add contributors dialog
  await page.getByRole("button", { name: "Add contributors" }).click();

  const dialog = page.getByRole("dialog", { name: "Add contributors" });
  await expect(dialog).toBeVisible();

  // Wait for collaborators to load — skeleton disappears, bob-viewer appears
  // (alice-dev is already a contributor so the dialog filters her out)
  await expect(dialog.getByText("@bob-viewer")).toBeVisible();

  // Select bob-viewer by clicking the label row
  await dialog.locator("label").filter({ hasText: "@bob-viewer" }).click();

  // Add button updates to "Add 1 contributor"
  const addBtn = dialog.getByRole("button", { name: /Add 1 contributor/ });
  await expect(addBtn).toBeEnabled();
  await addBtn.click();

  // Dialog closes and bob-viewer appears in the contributors list
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText("@bob-viewer")).toBeVisible();
});

test("impact nav dropdown: both contributors visible after add", async ({ page }) => {
  test.setTimeout(60_000);
  // Navigate to alice-dev's impact page — the dropdown trigger only renders
  // when contributors.length > 1, which is true after the previous test added bob-viewer.
  await page.goto(`/board/${boardId}/impact/alice-dev/90d`);
  await page.waitForLoadState("networkidle");

  // Trigger button is the contributor selector heading (rendered as a <button>
  // only when more than one contributor exists)
  const dropdownTrigger = page.getByRole("button", { name: /@alice-dev/ });
  await expect(dropdownTrigger).toBeVisible();

  // Open the dropdown
  await dropdownTrigger.click();

  // Both contributors are listed as options
  await expect(page.getByRole("button", { name: "@bob-viewer" })).toBeVisible();
});

test("remove contributor: bob-viewer removed and no longer in settings list", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto(`/board/${boardId}/settings`);
  await page.waitForLoadState("networkidle");

  // Find the list item for bob-viewer and click its trash button
  const bobItem = page.getByRole("listitem").filter({ hasText: "@bob-viewer" });
  await expect(bobItem).toBeVisible();
  await bobItem.getByRole("button").click();

  // AlertDialog asks for confirmation
  const alertDialog = page.getByRole("alertdialog");
  await expect(alertDialog).toBeVisible();
  await expect(alertDialog.getByText("Remove contributor?")).toBeVisible();

  await alertDialog.getByRole("button", { name: "Remove" }).click();

  // Wait for the alertdialog to close before checking the list —
  // the dialog shows @bob-viewer in its body and would cause a strict-mode
  // violation if getByText("@bob-viewer") resolves to 2 elements simultaneously.
  await expect(alertDialog).not.toBeVisible();

  // bob-viewer is gone from the contributors list
  await expect(page.getByText("@bob-viewer")).not.toBeVisible();
});
