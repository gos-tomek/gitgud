# E2E Workflow Chain Implementation Plan

## Overview

Write a Playwright E2E test that proves the full manual sync trigger → data appears flow, covering Risk R1 (workflow chain breaks silently). The test runs against a local `wrangler dev` instance with mocked GitHub API and AI binding, verifying that triggering a sync from the impact dashboard produces non-zero KPI metrics.

## Current State Analysis

The project has Playwright installed (`@playwright/test@^1.61.1`) with one seed spec (`tests/e2e/seed.spec.ts`) and an auth setup (`tests/e2e/auth.setup.ts`). The existing config (`playwright.config.ts`) targets `localhost:4321` via `npm run dev` (Astro dev server), which does not support Cloudflare Workflows.

The sync chain is a multi-phase Cloudflare Workflow (`ClassificationBatchWorkflow` in `src/worker.ts`): dispatch → sync-repo → orchestrate → prdetails + reviews → classify → classify-chunk. All child phases use fire-and-forget spawning (`Workflow.create()` with no completion polling). The UI trigger lives in `SyncIndicator.tsx` — it POSTs to `/api/github/sync`, polls status every 2s, and refreshes the dashboard on completion.

Existing hermetic tests cover individual sync functions (`sync-pr-batch.test.ts`, `sync-review-comments.test.ts`, `list-and-upsert-prs.test.ts`, `classification-voting.test.ts`) but explicitly not chain-level orchestration — which is exactly the gap R1 identifies.

### Key Discoveries:

- `src/lib/github.ts:63-93` — `makeOctokit()` creates Octokit without a `baseUrl` property; defaults to `api.github.com`. No `GITHUB_API_BASE_URL` env var exists anywhere.
- `wrangler.jsonc:25-31` — `CLASSIFICATION_BATCH` Workflow binding and `AI` binding are declared. No D1 bindings. KV is used only for `HOMEPAGE_CACHE`.
- `src/lib/services/classification.ts:226-228` — `AiBinding` is a structural interface (`{ run(model, inputs, options?) }`), making it mockable without Workers AI runtime.
- `src/env.d.ts:9-21` — The `Cloudflare.Env` namespace declares all bindings. A new `GITHUB_API_BASE_URL` env var would need to be added here.
- `src/components/impact/SyncIndicator.tsx:87-96` — sync button: `<Button title="Refresh data">`. Locator: `getByRole('button', { name: 'Refresh data' })`.
- `src/components/impact/KpiCards.tsx` — 6 KPI cards with text labels: "PRs authored", "Reviews given", "Threads started", "Time to merge", "Pickup time", "Discussion ratio". Values are plain `<p>` elements — no ARIA roles or test IDs.
- Minimum Supabase seed for sync: `auth.users` (with github metadata → auto-creates `user_profiles`), `boards`, `github_repos`. The `board_members` table was dropped; access is derived from ownership.

## Desired End State

A single Playwright spec (`tests/e2e/sync-chain.spec.ts`) that:

1. Pre-seeds a board with one repo via the Supabase admin client
2. Navigates to the contributor's impact page
3. Clicks the sync button
4. Waits for the SyncIndicator to show completion (60s timeout)
5. Asserts that KPI cards ("PRs authored", "Reviews given") display non-zero values

The test runs against `wrangler dev` (build + preview) with a local HTTP mock server for GitHub API and a mocked AI binding. A new CI job runs this E2E suite automatically.

## What We're NOT Doing

- Testing mid-chain failure recovery (Phase 6 hermetic tests own that)
- Testing the daily cron trigger (manual sync only)
- Visual regression or screenshot comparison
- Testing the board creation wizard (seed.spec.ts owns that)
- Testing classification accuracy (hermetic tests own that)
- Deploying to a Cloudflare preview for testing
- Adding `data-testid` attributes to KPI cards

## Implementation Approach

Three phases: (1) add the mock infrastructure needed for the Workflow to run locally against fake data — a `GITHUB_API_BASE_URL` override in Octokit, a local HTTP mock server returning fixture GitHub data, and AI binding mock config; (2) update Playwright config for `wrangler dev` and write the E2E spec with Supabase admin seeding; (3) wire into CI as a dedicated job.

## Critical Implementation Details

### Timing & lifecycle

The Workflow chain spawns child phases fire-and-forget. With mocked GitHub API (fast responses, no real network), the chain should complete in under 10s locally. However, `wrangler dev` Workflow scheduling may add latency on first run. The test polls `/api/github/sync/status` every 2s with a 60s timeout — matching the SyncIndicator pattern but tighter than production's 120s.

### State sequencing

The test must seed Supabase data (board + repo) _before_ `wrangler dev` starts serving requests, because the sync endpoint reads from `github_repos` immediately. The Playwright `webServer` config handles startup ordering, but the Supabase seed must run in a `beforeAll` or a setup project that executes before the spec.

---

## Phase 1: Mock Infrastructure

### Overview

Add the plumbing needed for the Workflow chain to run locally against deterministic fake data: a GitHub API base URL override in Octokit, a local HTTP mock server returning fixture PRs/reviews/comments, and wrangler dev configuration for the AI binding mock.

### Changes Required:

#### 1. GitHub API base URL override

**File**: `src/lib/github.ts`

**Intent**: Allow Octokit's base URL to be overridden via environment variable so the Workflow can call a local mock server instead of `api.github.com` during E2E tests.

**Contract**: `makeOctokit(token, baseUrl?)` gains an optional `baseUrl` parameter. When provided, it is passed as `baseUrl` in the `OctokitWithPlugins()` constructor. The caller in `src/worker.ts` passes `this.env.GITHUB_API_BASE_URL` (when set) through to `makeOctokit`.

#### 2. GITHUB_API_BASE_URL env var declaration

**File**: `src/env.d.ts`

**Intent**: Declare the new env var in the Cloudflare.Env type so TypeScript knows about it.

**Contract**: Add `GITHUB_API_BASE_URL?: string;` to `Cloudflare.Env`. Optional — only set during E2E tests.

#### 3. Wire base URL through Workflow phases

**File**: `src/worker.ts`

**Intent**: Pass the `GITHUB_API_BASE_URL` env var from the Workflow's `this.env` through to every call site that creates an Octokit instance.

**Contract**: Each phase that calls `makeOctokit(token)` changes to `makeOctokit(token, this.env.GITHUB_API_BASE_URL)`. The sync service functions (`listAndUpsertPrsForRepo`, `syncPrBatch`, `syncReviewCommentsForRepo`) gain an optional `baseUrl` parameter that is forwarded to `makeOctokit`.

#### 4. Wire base URL through API route

**File**: `src/pages/api/github/sync.ts`

**Intent**: The sync API route also calls GitHub (for PAT validation or direct operations). Pass the base URL override if set.

**Contract**: If the route creates an Octokit instance, pass the env var through. Check whether the route accesses `GITHUB_API_BASE_URL` from the Cloudflare env binding.

#### 5. GitHub mock server

**File**: `tests/e2e/github-mock-server.ts`

**Intent**: A lightweight HTTP server that returns fixture GitHub API responses for the sync chain's REST and GraphQL calls.

**Contract**: Exports `startGitHubMockServer(port: number): Promise<{ url: string; stop: () => Promise<void> }>`. Handles these routes:

- `GET /repos/:owner/:repo/pulls` → fixture PR list (2–3 PRs with known numbers, authors, dates)
- `POST /graphql` → fixture PR details response (additions, deletions, changedFiles, reviews)
- `GET /repos/:owner/:repo/pulls/comments` → fixture review comments (2–3 comments with known content)
- All other routes → 404

Uses Node's built-in `http.createServer` — no external dependencies.

#### 6. AI binding mock configuration

**File**: `wrangler.e2e.jsonc`

**Intent**: A wrangler config overlay for E2E tests that mocks the AI binding. Since `wrangler dev` supports `--config`, we can use a separate config file that overrides the AI binding to return deterministic classification results.

**Contract**: Extends `wrangler.jsonc` but overrides the AI binding with a service binding pointing to a local mock worker, or uses wrangler's `--test-scheduled` / miniflare options. Alternative: the classification service already uses the structural `AiBinding` interface — if wrangler dev allows binding overrides via `--var`, we can point `GITHUB_API_BASE_URL` there too. The exact wrangler dev configuration for AI mocking will be determined during implementation based on current wrangler capabilities.

#### 7. E2E-specific wrangler config

**File**: `wrangler.e2e.jsonc`

**Intent**: Wrangler configuration for E2E test runs — sets `GITHUB_API_BASE_URL` to the mock server and configures the AI binding mock.

**Contract**: Inherits from `wrangler.jsonc` via `inherits` field (if supported) or is a full copy with overrides. Sets `[vars]` with `GITHUB_API_BASE_URL = "http://localhost:<mock-port>"`. Configures the AI binding to use a mock.

### Success Criteria:

#### Automated Verification:

- `makeOctokit("token", "http://localhost:9999")` creates an Octokit instance with `baseUrl` set to the override
- Type checking passes: `npx tsc --noEmit` and `npm run test:typecheck`
- Existing tests pass: `npm test` (no regressions from the optional parameter)
- GitHub mock server starts and responds to fixture routes: `node -e "import('./tests/e2e/github-mock-server.ts')..."`
- Linting passes: `npm run lint`

#### Manual Verification:

- `wrangler dev --config wrangler.e2e.jsonc` starts successfully with the mock bindings
- Visiting the app served by wrangler dev shows the same UI as `npm run dev`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: E2E Test + Playwright Config

### Overview

Update Playwright to run against `wrangler dev` (build + preview mode), create a Supabase admin seeding helper for E2E sync tests, and write the sync chain E2E spec.

### Changes Required:

#### 1. Playwright config for wrangler dev

**File**: `playwright.config.ts`

**Intent**: Change the `webServer` configuration so Playwright starts `wrangler dev` (with the E2E config) instead of `npm run dev`, since Workflows only run in the Workers runtime.

**Contract**: The `webServer` block changes to run `astro build && wrangler dev --config wrangler.e2e.jsonc --port 4321` (or a script that orchestrates both). The `reuseExistingServer` behavior stays the same. Consider whether the build step should be a separate `webServer` entry or a pre-test script.

#### 2. E2E Supabase seed helper

**File**: `tests/e2e/helpers/seed-sync-board.ts`

**Intent**: Create and clean up a sync-ready board with one repo via the Supabase admin client, for use in the sync chain E2E test.

**Contract**: Exports `seedSyncBoard(): Promise<{ boardId: string; repoOwner: string; repoName: string; contributorLogin: string; cleanup: () => Promise<void> }>`. Uses the admin client (service-role key from env) to:

1. Create/reuse the E2E test user (from `E2E_EMAIL` env var)
2. Insert a `boards` row owned by that user
3. Insert a `github_repos` row with a fixture repo owner/name matching the mock server's data
4. Insert a `board_contributors` row so the contributor appears on the impact page
5. Return a `cleanup()` that deletes the board (CASCADE handles children)

#### 3. GitHub mock server lifecycle

**File**: `tests/e2e/helpers/mock-server-setup.ts`

**Intent**: Start the GitHub mock server before tests and stop it after, integrating with the Playwright test lifecycle.

**Contract**: A Playwright `globalSetup` function that starts the mock server, writes its URL to a file or env var, and returns a teardown function. Alternatively, a `beforeAll`/`afterAll` in the spec itself if simpler.

#### 4. Sync chain E2E spec

**File**: `tests/e2e/sync-chain.spec.ts`

**Intent**: The core E2E test proving manual sync trigger → data appears. Exercises the full Workflow chain from browser click to KPI metric display.

**Contract**: Single test with this flow:

1. `beforeAll`: seed a board via `seedSyncBoard()`, start mock server if not global
2. Navigate to `/board/{boardId}/impact/{contributorLogin}/90d`
3. Assert "Never synced" text is visible
4. Click `getByRole('button', { name: 'Refresh data' })`
5. Wait for sync completion: poll until "Synced" text appears (replaces "Never synced"), with 60s timeout via `expect().toBeVisible({ timeout: 60_000 })`
6. Assert KPI cards show non-zero values:
   - Locate "PRs authored" label, verify sibling value is not "—" and not "0"
   - Locate "Reviews given" label, verify sibling value is not "—" and not "0"
7. `afterAll`: call `cleanup()` to delete the board

Follows seed.spec.ts conventions: role-based locators, no `waitForTimeout`, no CSS selectors.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx tsc --noEmit` and `npm run test:typecheck`
- Linting passes: `npm run lint`
- `npx playwright test sync-chain` passes against local wrangler dev + mock server + local Supabase

#### Manual Verification:

- Watch the test run in headed mode (`--headed`) to confirm the sync flow visually matches the real user experience
- KPI values displayed match expectations given the fixture data

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: CI Integration

### Overview

Add a dedicated GitHub Actions job that runs the E2E sync chain test on every PR, using wrangler dev, local Supabase, and the GitHub mock server.

### Changes Required:

#### 1. E2E CI job

**File**: `.github/workflows/ci.yml`

**Intent**: Add a `test-e2e` job that runs Playwright E2E tests with the full wrangler dev + mock server + Supabase stack.

**Contract**: New job `test-e2e` that:

1. Checks out the code
2. Installs Node.js 22.14.0 and dependencies
3. Installs Playwright browsers (`npx playwright install --with-deps chromium`)
4. Starts local Supabase (`supabase start`)
5. Builds the Astro app (`npm run build`)
6. Runs `npx playwright test` (which starts wrangler dev + mock server via config)
7. Uploads test artifacts (traces, screenshots) on failure
8. Requires secrets: `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SERVICE_KEY`, `GITHUB_TOKEN_ENCRYPTION_KEY`, `E2E_EMAIL`, `E2E_PASSWORD`, `E2E_GITHUB_PAT`, `CLOUDFLARE_API_TOKEN` (for wrangler dev)

#### 2. npm script for E2E

**File**: `package.json`

**Intent**: Add a convenience script for running E2E tests locally.

**Contract**: Add `"test:e2e": "playwright test"` to the scripts section.

### Success Criteria:

#### Automated Verification:

- CI `test-e2e` job passes on a PR branch
- `npm run test:e2e` runs locally when wrangler dev + Supabase are available

#### Manual Verification:

- CI job completes in reasonable time (< 5 minutes)
- CI artifacts (traces) are downloadable on failure
- Existing `validate` and `test-integration` jobs are unaffected

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### E2E Tests:

- `tests/e2e/sync-chain.spec.ts` — full sync trigger → data appears flow
- Verifies KPI metrics ("PRs authored", "Reviews given") show non-zero values after sync
- 60s timeout for sync completion, 2s polling interval (mirrors SyncIndicator)

### What's NOT Tested Here:

- Mid-chain failure recovery (Phase 6 hermetic tests)
- Individual sync function correctness (existing hermetic tests)
- Classification accuracy (existing hermetic tests)
- Board creation wizard (seed.spec.ts)

### Manual Testing Steps:

1. Start local Supabase: `npx supabase start`
2. Start mock server + wrangler dev + Playwright: `npm run test:e2e -- --headed`
3. Watch the sync flow: button click → spinner → "Synced" status → KPI values appear
4. Verify KPI values match fixture data expectations

## Performance Considerations

- The GitHub mock server returns fixture data instantly — no network latency. Workflow phases should complete in under 10s.
- AI binding mock returns immediately — no inference latency.
- The 60s timeout is generous for mocked data; typical runs should complete in 10–20s.
- wrangler dev startup adds ~5s cold start. The Playwright `webServer` config waits for the URL to be available before running tests.

## Migration Notes

- The `makeOctokit(token)` signature gains an optional `baseUrl` parameter — fully backward compatible.
- No database migrations needed.
- Existing Playwright config changes affect `webServer` only — auth setup and seed spec remain unchanged.

## References

- Test plan Phase 7: `context/foundation/test-plan.md` §3 row 7
- Risk R1: `context/foundation/test-plan.md` §2 row R1
- Existing seed spec: `tests/e2e/seed.spec.ts`
- Workflow source: `src/worker.ts`
- SyncIndicator: `src/components/impact/SyncIndicator.tsx`
- KPI cards: `src/components/impact/KpiCards.tsx`
- Octokit setup: `src/lib/github.ts:63-93`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Mock Infrastructure

#### Automated

- [ ] 1.1 makeOctokit accepts optional baseUrl and passes to Octokit constructor
- [ ] 1.2 GITHUB_API_BASE_URL declared in Cloudflare.Env type
- [ ] 1.3 Workflow phases pass GITHUB_API_BASE_URL to makeOctokit
- [ ] 1.4 GitHub mock server starts and responds to fixture routes
- [ ] 1.5 Type checking passes (tsc --noEmit for src and tests)
- [ ] 1.6 Existing tests pass (npm test)
- [ ] 1.7 Linting passes (npm run lint)

#### Manual

- [ ] 1.8 wrangler dev starts with E2E config and mock bindings
- [ ] 1.9 App served by wrangler dev renders correctly

### Phase 2: E2E Test + Playwright Config

#### Automated

- [ ] 2.1 Playwright config uses wrangler dev as webServer
- [ ] 2.2 Supabase seed helper creates and cleans up sync-ready board
- [ ] 2.3 sync-chain.spec.ts passes against local wrangler dev + mock server + Supabase
- [ ] 2.4 Type checking passes
- [ ] 2.5 Linting passes

#### Manual

- [ ] 2.6 Sync flow visually correct in headed mode
- [ ] 2.7 KPI values match fixture data expectations

### Phase 3: CI Integration

#### Automated

- [ ] 3.1 CI test-e2e job passes on PR branch
- [ ] 3.2 npm run test:e2e runs locally

#### Manual

- [ ] 3.3 CI job completes in under 5 minutes
- [ ] 3.4 CI artifacts downloadable on failure
- [ ] 3.5 Existing CI jobs unaffected
