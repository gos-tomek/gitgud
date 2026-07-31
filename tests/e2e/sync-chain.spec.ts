import { test, expect, type Page, type Locator } from "@playwright/test";
import { seedSyncBoard, type SyncBoardFixture } from "./helpers/seed-sync-board.js";
import { startGitHubMockServer, type MockServer } from "./github-mock-server.js";

// Provenance: context/foundation/test-plan.md §2 Risk R1 — workflow chain breaks silently.
// Seed: tests/e2e/seed.spec.ts. Rules: tests/e2e/e2e-rules.md.
//
// What is real vs mocked:
//   Real   — auth session, routing, /api/github/sync dispatch, the full Cloudflare Workflow
//            chain (dispatch → sync-repo → orchestrate → prdetails/reviews → classify →
//            classify-chunk), Supabase reads/writes.
//   Mocked — GitHub REST/GraphQL calls the Workflow makes server-side (tests/e2e/github-mock-server.ts,
//            routed via GITHUB_API_BASE_URL in wrangler.e2e.jsonc — page.route() can't intercept
//            these since they never go through the browser) and the AI binding (AI_MOCK).
//
// KpiCards has no ARIA roles or test IDs linking a label to its value (plain <p> siblings) — the
// browser's accessibility tree does expose an implicit "paragraph" role for <p>, so each card is
// scoped from its label via two parent hops, then disambiguated by role within that scope.
function kpiValue(page: Page, label: string): Locator {
  const card = page.getByText(label, { exact: true }).locator("..").locator("..");
  return card.getByRole("paragraph").nth(1);
}

let mockServer: MockServer;
let fixture: SyncBoardFixture;

test.beforeAll(async () => {
  mockServer = await startGitHubMockServer(9999);
  fixture = await seedSyncBoard();
});

test.afterAll(async () => {
  await fixture.cleanup();
  await mockServer.stop();
});

test("manual sync trigger produces non-zero KPI metrics for the contributor (Risk R1)", async ({ page }) => {
  test.setTimeout(150_000);

  await page.goto(`/board/${fixture.boardId}/impact/${fixture.contributorLogin}/90d`);
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Never synced")).toBeVisible();

  await page.getByRole("button", { name: "Refresh data" }).click();

  // SyncIndicator polls the dispatch Workflow instance's status, which flips to "complete" as
  // soon as it finishes spawning the sync-repo child — every hop after that (sync-repo →
  // orchestrate → prdetails/reviews → classify) is fire-and-forget (`Workflow.create()`, never
  // awaited), so "Synced" appearing here proves only that the dispatch hop didn't error. It does
  // NOT prove the data landed — that gap is exactly Risk R1: a downstream phase can still be
  // failing silently after this text flips.
  await expect(page.getByText(/^Synced/)).toBeVisible({ timeout: 60_000 });

  const prsAuthored = kpiValue(page, "PRs authored");
  const reviewsGiven = kpiValue(page, "Reviews given");

  // The dashboard only refetches once, on the sync-complete signal above — proving the full
  // chain actually finished requires re-checking the persisted data over time, not just
  // re-reading the already-fetched DOM. Poll by reloading until the real values land.
  await expect(async () => {
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(prsAuthored).not.toHaveText("—");
    await expect(prsAuthored).not.toHaveText("0");
    await expect(reviewsGiven).not.toHaveText("—");
    await expect(reviewsGiven).not.toHaveText("0");
  }).toPass({ timeout: 60_000, intervals: [2_000] });
});
