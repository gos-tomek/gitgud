import { test as setup } from "@playwright/test";

// Authenticates the viewer (non-owner) user and saves their session to
// playwright/.auth/viewer.json for use in the non-owner-denied spec.
//
// The viewer does NOT need a GitHub PAT — they don't create boards.
// Their github_login (E2E_VIEWER_GITHUB_LOGIN) must match a mock collaborator
// login in fixtures.ts so the identity bridge auto-matches when an owner adds them.
setup("authenticate viewer", async ({ page }) => {
  const email = process.env.E2E_VIEWER_EMAIL;
  const password = process.env.E2E_VIEWER_PASSWORD;

  if (!email || !password) {
    throw new Error("E2E_VIEWER_EMAIL and E2E_VIEWER_PASSWORD must be set to run the viewer auth setup");
  }

  await page.goto("/auth/signin");
  await page.waitForLoadState("networkidle");

  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByRole("textbox", { name: "Password" }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.waitForURL(/\/(dashboard|board\/)/);

  await page.context().storageState({ path: "playwright/.auth/viewer.json" });
});
