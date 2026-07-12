import type { Page } from "@playwright/test";

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
