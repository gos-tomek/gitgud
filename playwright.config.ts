import { defineConfig, devices } from "@playwright/test";

// Playwright runs outside Vite, so .env is not loaded automatically.
process.loadEnvFile(".dev.vars");

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "list",
  expect: {
    timeout: 5000,
  },
  use: {
    baseURL: "http://localhost:4321",
    trace: "on-first-retry",
  },
  projects: [
    // auth.setup.ts logs in and writes playwright/.auth/user.json before any test runs.
    // Re-runs on every `playwright test` invocation so the session never expires mid-suite.
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // storageState is produced by the setup project above — injects a fresh session
        // into every test so no UI login step is needed.
        storageState: "playwright/.auth/user.json",
      },
      dependencies: ["setup"],
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:4321",
    reuseExistingServer: !process.env.CI,
  },
});
