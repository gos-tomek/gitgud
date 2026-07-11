import { test as setup } from "@playwright/test";

// Reads credentials from env vars so they never appear in the repo.
// Set E2E_EMAIL, E2E_PASSWORD, and E2E_GITHUB_PAT in .env (local) or CI secrets (CI).
setup("authenticate", async ({ page }) => {
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;
  const githubPat = process.env.E2E_GITHUB_PAT;

  if (!email || !password) {
    throw new Error("E2E_EMAIL and E2E_PASSWORD must be set to run the auth setup");
  }
  if (!githubPat) {
    throw new Error(
      "E2E_GITHUB_PAT must be set — it seeds the test user's GitHub profile so create_board_atomic can find a stored token",
    );
  }

  await page.goto("/auth/signin");
  await page.waitForLoadState("networkidle");

  // SignInForm is a React island (client:load) — wait for it to hydrate.
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByRole("textbox", { name: "Password" }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();

  // Successful login redirects to /dashboard (or further to the first board).
  await page.waitForURL(/\/(dashboard|board\/)/);

  // Seed the test user's GitHub PAT once per suite run.
  // profile/pat validates the token against GitHub and stores it in the DB.
  // Tests that create boards rely on this — create_board_atomic reads the stored PAT.
  const res = await page.request.post("/api/profile/pat", {
    data: { pat: githubPat },
  });
  if (!res.ok()) {
    const body = (await res.json()) as { error?: string };
    throw new Error(`Failed to save E2E_GITHUB_PAT: ${body.error ?? String(res.status())}`);
  }

  await page.context().storageState({ path: "playwright/.auth/user.json" });
});
