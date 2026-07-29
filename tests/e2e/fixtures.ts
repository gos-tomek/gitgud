import { expect, type Page } from "@playwright/test";

// Shared GitHub API mock data for E2E specs.
// All specs mock the same external APIs — centralizing here ensures consistency.
//
// bob-viewer's login matches the viewer user's github_login (from E2E_VIEWER_GITHUB_LOGIN)
// so the identity bridge auto-matches when the owner adds bob-viewer as a contributor.

export const MOCK_REPOS = [
  { owner: "acme-org", name: "backend", fullName: "acme-org/backend", private: false, pushAccess: true },
];

export const MOCK_COLLABORATORS = [
  {
    id: 99001,
    login: "alice-dev",
    avatarUrl: "https://avatars.githubusercontent.com/u/99001",
    type: "Collaborator",
  },
  {
    id: 99002,
    login: "bob-viewer",
    avatarUrl: "https://avatars.githubusercontent.com/u/99002",
    type: "Collaborator",
  },
];

/** Register page.route() handlers for the two GitHub API proxies before navigation. */
export async function mockGitHubApis(page: Page): Promise<void> {
  await page.route("**/api/github/repos", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ repos: MOCK_REPOS }),
    }),
  );

  await page.route("**/api/github/collaborators", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ collaborators: MOCK_COLLABORATORS }),
    }),
  );
}

/**
 * Complete the 3-step board creation wizard.
 * Selects acme-org/backend (step 2) and alice-dev (step 3).
 * Returns the new board's UUID extracted from the redirect URL.
 */
export async function createBoardViaWizard(page: Page, boardName: string): Promise<string> {
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
  return boardId;
}

/**
 * Submit the delete-board confirmation dialog.
 * Assumes the page is already on the board's settings page with "Delete board" visible.
 * Waits until the board's ID disappears from the URL.
 */
export async function deleteBoardViaUI(page: Page, boardId: string, boardName: string): Promise<void> {
  await page.getByRole("button", { name: "Delete board" }).click();
  await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
  await page.getByRole("textbox", { name: /Type .* to confirm/i }).fill(boardName);
  await expect(page.getByRole("button", { name: "Permanently delete board" })).toBeEnabled();
  await page.getByRole("button", { name: "Permanently delete board" }).click();
  await page.waitForURL((url) => !url.href.includes(boardId));
}
