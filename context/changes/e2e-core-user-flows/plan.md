# E2E Core User Flows — Implementation Plan

## Overview

Add Playwright E2E tests covering the Phase 8 risk surface from `context/foundation/test-plan.md §3`: board lifecycle (dashboard verification, create, delete), contributor management (add, verify on settings + impact nav, remove), and non-owner denial (UI hidden controls + API 403). The existing seed test (`tests/e2e/seed.spec.ts`) already covers Risk #3 (wizard state machine) and the basic create-delete happy path — this plan fills the remaining gaps.

## Current State Analysis

The E2E infrastructure is operational:

- Playwright `^1.61.1` installed, config at `playwright.config.ts` with `webServer` block starting `npm run dev`
- Auth setup project (`tests/e2e/auth.setup.ts`) logs in a single user, seeds their GitHub PAT, saves session to `playwright/.auth/user.json`
- Seed test (`tests/e2e/seed.spec.ts`) covers the full wizard → settings verification → delete flow with mocked GitHub API routes (`page.route()`)
- GitHub API calls (repos, collaborators) are mocked — the app uses real auth, routing, Supabase RPC, and cascade deletes
- No `data-testid` attributes — all locators use accessible queries (role, label, text)

### Key Discoveries:

- Dashboard (`src/pages/dashboard.astro`) auto-redirects to the first board's impact page (or settings if no contributors); shows "Welcome to GitGud" empty state when no boards exist — `dashboard.astro:18-30`
- ContributorManager (`src/components/ContributorManager.tsx`) uses a Dialog for adding (checkbox list from `/api/github/collaborators`), AlertDialog for removing (destructive "Remove" button) — `ContributorManager.tsx:207-374`
- Impact page contributor dropdown (`src/components/impact/ImpactView.tsx:120-175`) shows `@{githubLogin}` for each contributor — only visible when `contributors.length > 1`
- Settings page hides interactive components (BoardNameEditor, RepoManager, ContributorManager, DeleteBoardDialog) for non-supervisors, rendering static text instead — `settings.astro:46-133`
- Non-owner API denial returns 403 with `{ error: "Forbidden" }` via `getBoardWithRole()` check in each mutation endpoint
- `process.loadEnvFile(".dev.vars")` in playwright config means all E2E env vars go in `.dev.vars`

## Desired End State

Three new spec files pass locally and in CI:

1. `tests/e2e/board-lifecycle.spec.ts` — creates a board, verifies dashboard redirect targets the board, navigates settings, deletes board, verifies dashboard shows empty state
2. `tests/e2e/contributor-management.spec.ts` — creates a board with one contributor, adds a second contributor via the dialog, verifies they appear on settings page and in the impact nav dropdown, removes the second contributor, verifies they're gone
3. `tests/e2e/non-owner-denied.spec.ts` — a viewer user (not the board owner) navigates to a board's settings page and sees static text (no edit/delete controls); API calls to mutation endpoints return 403

Supporting infrastructure: shared fixture module, second Playwright auth project for the viewer user, `npm run e2e` script, and a `test-e2e` CI job with Playwright + Supabase.

Verification: `npx playwright test` passes all specs (seed + 3 new); CI `test-e2e` job passes on a PR branch.

## What We're NOT Doing

- **Wizard edge cases** — back-navigation, name uniqueness collision, PAT validation errors. The seed test covers the happy path; component tests (`tests/component/CreateBoardForm.test.tsx`) cover the state machine.
- **Impact data correctness** — no E2E tests for metric calculations, classification, or sync workflows. Those are covered by hermetic/integration tests and belong to Phases 5-7.
- **Signup E2E** — the auth setup uses a pre-existing user. Signup is tested by component tests (`tests/component/SignUpForm.test.tsx`). A signup E2E would need email confirmation flow handling.
- **Visual regression** — no screenshot comparisons or layout assertions. CLAUDE.md reserves vision for visual-only risks.
- **Repo management E2E** — adding/removing repos on the settings page. Similar pattern to contributor management but lower risk and not in Phase 8 scope.

## Implementation Approach

Leverage the seed test as the template. Each new spec follows the same pattern: `page.route()` to mock GitHub APIs, `Date.now()` suffix for unique board names, role-based locators, and UI-driven cleanup in `afterAll`. The non-owner spec introduces a second Playwright auth project (`setup-viewer`) that logs in a viewer user and saves a separate storage state. Shared fixtures are extracted from the seed test's inline mock data into `tests/e2e/fixtures.ts`.

## Critical Implementation Details

### Viewer user auth and board membership

The non-owner spec requires a second user who is a board **member** but not the **owner**. Board membership is managed via `board_contributors` — adding the viewer's GitHub login as a contributor grants them settings page access (read-only). The auth setup for the viewer user must: (1) log in to produce a storage state, and (2) NOT seed a GitHub PAT (the viewer doesn't create boards). The spec itself must add the viewer as a contributor to the owner's board before asserting the viewer's restricted view. This means the owner must create the board and add the viewer as a contributor first, then the viewer navigates to the board's settings page.

However, the contributor auto-match trigger (`user_profiles.github_login` → `board_contributors.github_login`) bridges the gap: when a user signs up with a GitHub username and that username is later added as a board contributor, the identity bridge links them. So the viewer user's `github_login` from signup must match one of the collaborator logins in the mocked GitHub API response.

### Impact nav dropdown visibility

The contributor dropdown in `ImpactView.tsx` only renders when `contributors.length > 1` (line 101). To verify a newly added contributor appears in the impact nav, the board must have at least 2 contributors after the add operation. The contributor management spec should start with one contributor (from board creation) and add a second, then verify the dropdown appears and contains both.

---

## Phase 1: Foundation — Fixtures, Viewer Auth, npm Script

### Overview

Extract shared mock fixtures, add a second Playwright auth project for the viewer user, and add an `npm run e2e` convenience script. This phase produces no new test specs but sets up the infrastructure the subsequent phases need.

### Changes Required:

#### 1. Shared fixture module

**File**: `tests/e2e/fixtures.ts`

**Intent**: Extract the hardcoded GitHub API mock responses from `seed.spec.ts` into a reusable module. All specs mock the same external APIs; centralizing the data ensures consistency and makes it easy to add mock collaborators (needed for the contributor management and non-owner specs).

**Contract**: Exports `MOCK_REPOS` (array with at least `acme-org/backend`), `MOCK_COLLABORATORS` (array with at least `alice-dev` id 99001 and `bob-viewer` id 99002), and a `mockGitHubApis(page)` helper function that registers `page.route()` handlers for `**/api/github/repos` and `**/api/github/collaborators`. The second collaborator (`bob-viewer`) is needed for the contributor management spec (add a second contributor) and the non-owner spec (viewer's GitHub login must match a collaborator).

#### 2. Update seed test to use shared fixtures

**File**: `tests/e2e/seed.spec.ts`

**Intent**: Replace inline mock data with imports from `fixtures.ts` to prove the shared module works and reduce duplication.

**Contract**: `beforeEach` calls `mockGitHubApis(page)` instead of inline `page.route()`. Test behavior is unchanged.

#### 3. Viewer auth setup

**File**: `tests/e2e/auth-viewer.setup.ts`

**Intent**: Create a second Playwright setup file that authenticates a viewer user (non-owner). This user exists in local Supabase with a GitHub username matching a mock collaborator login.

**Contract**: Reads `E2E_VIEWER_EMAIL` and `E2E_VIEWER_PASSWORD` from env vars. Navigates to `/auth/signin`, fills credentials, waits for redirect. Saves storage state to `playwright/.auth/viewer.json`. Does NOT seed a GitHub PAT (viewer doesn't create boards).

#### 4. Playwright config — add viewer project

**File**: `playwright.config.ts`

**Intent**: Register the viewer auth setup as a Playwright project and make the viewer's storage state available to specs that need it.

**Contract**: Add a `setup-viewer` project matching `auth-viewer.setup.ts`. The existing `chromium` project continues to depend on `setup` (owner user). Specs that need the viewer user will create a new browser context with the viewer's storage state explicitly — no new Playwright project for running specs is needed (the viewer context is created within the non-owner spec using `browser.newContext({ storageState: 'playwright/.auth/viewer.json' })`).

#### 5. Add npm script

**File**: `package.json`

**Intent**: Add `"e2e": "playwright test"` to the scripts block for convenience.

**Contract**: `npm run e2e` runs all Playwright tests (equivalent to `npx playwright test`).

#### 6. Gitignore viewer auth state

**File**: `.gitignore`

**Intent**: The existing pattern `playwright/.auth/` already covers `viewer.json`. Verify this — no change needed if the glob already matches.

**Contract**: `playwright/.auth/viewer.json` is gitignored.

### Success Criteria:

#### Automated Verification:

- Existing seed test passes with shared fixtures: `npx playwright test seed.spec.ts`
- Viewer auth setup completes without error: `npx playwright test --project=setup-viewer`
- TypeScript compiles: `npx tsc --noEmit`

#### Manual Verification:

- `playwright/.auth/viewer.json` is created after running setup
- `npm run e2e` runs the full suite

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Board Lifecycle Spec

### Overview

Write `board-lifecycle.spec.ts` covering: empty dashboard state → create board → verify dashboard redirects to the board → navigate to settings → delete board → verify dashboard shows empty state. Covers risks #8 (board DELETE cascade, UI-level) and dashboard redirect correctness.

### Changes Required:

#### 1. Board lifecycle spec

**File**: `tests/e2e/board-lifecycle.spec.ts`

**Intent**: Test the full board lifecycle from the dashboard's perspective — proving that creating a board changes the dashboard from empty state to redirect, and deleting the board returns the dashboard to empty state. The seed test already covers wizard steps; this spec focuses on the dashboard behavior and the delete-cascade E2E signal.

**Contract**: Uses `mockGitHubApis(page)` from fixtures. Board name uses `Date.now()` suffix. Test flow:

1. Navigate to `/dashboard`, assert "Welcome to GitGud" heading and "+ Create your first board" link visible (empty state)
2. Navigate to `/board/new`, complete the 3-step wizard (same pattern as seed test), capture the board ID from the redirect URL
3. Navigate to `/dashboard`, assert URL redirects to `/board/{id}/...` (the created board)
4. Navigate to `/board/{id}/settings`, click "Delete board", type board name to confirm, click "Permanently delete board"
5. Wait for redirect, navigate to `/dashboard`, assert "Welcome to GitGud" visible again (empty state restored)

Note: step 1 (empty state) assumes the test user has no other boards. The `Date.now()` board name prevents collision but the user account may have boards from failed prior runs. If this becomes flaky, the spec can delete existing boards in a `beforeAll` hook.

### Success Criteria:

#### Automated Verification:

- Spec passes: `npx playwright test board-lifecycle.spec.ts`
- Full suite still green: `npx playwright test`

#### Manual Verification:

- Watch the test run headed (`npx playwright test board-lifecycle.spec.ts --headed`) and confirm each step visually matches expectations

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Contributor Management Spec

### Overview

Write `contributor-management.spec.ts` covering: create board with one contributor → add a second contributor via the settings dialog → verify the second contributor on settings page AND in the impact nav dropdown → remove the second contributor → verify they're gone from settings. Covers contributor CRUD and validates the impact nav dropdown renders correctly with multiple contributors.

### Changes Required:

#### 1. Contributor management spec

**File**: `tests/e2e/contributor-management.spec.ts`

**Intent**: Test the add and remove contributor flows end-to-end, including the dialog interaction and cross-page verification (settings + impact nav). The board is created in `beforeAll` (following the seed test wizard pattern) and deleted in `afterAll` (UI-driven cleanup).

**Contract**: Uses `mockGitHubApis(page)` from fixtures. The mock collaborators include both `alice-dev` and `bob-viewer`. Board is created in `beforeAll` selecting only `alice-dev` as the initial contributor. Tests:

1. **Add contributor**: Navigate to settings, click "Add contributors" button, wait for dialog to open, select the `bob-viewer` checkbox, click "Add 1 contributor", verify dialog closes, verify `@bob-viewer` appears in the contributor list on settings
2. **Verify on impact nav**: Navigate to the impact page (`/board/{id}/impact/{login}/90d`), verify the contributor dropdown is visible (it only renders when `contributors.length > 1`), verify `@bob-viewer` appears in the dropdown options
3. **Remove contributor**: Navigate back to settings, click the trash button next to `@bob-viewer`, verify AlertDialog "Remove contributor?" appears, click "Remove", verify `@bob-viewer` is no longer in the contributor list

Cleanup in `afterAll`: navigate to settings, delete the board via the UI (same pattern as seed test).

### Success Criteria:

#### Automated Verification:

- Spec passes: `npx playwright test contributor-management.spec.ts`
- Full suite still green: `npx playwright test`

#### Manual Verification:

- Watch the test run headed and confirm the dialog interaction (add contributor) and AlertDialog (remove contributor) work as expected
- Verify the impact nav dropdown appears after adding the second contributor

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Non-Owner Denial Spec

### Overview

Write `non-owner-denied.spec.ts` covering: owner creates a board and adds the viewer as a contributor → viewer navigates to the board's settings page and sees read-only content (no edit/delete controls) → viewer attempts API mutations and receives 403. Covers risks R5 (settings API unauthorized mutation) and #1 (cross-board isolation at the UI level).

### Changes Required:

#### 1. Non-owner denial spec

**File**: `tests/e2e/non-owner-denied.spec.ts`

**Intent**: Test that a non-owner user cannot mutate a board through the UI or API. This spec uses two browser contexts: the owner (default storageState) to create the board and add the viewer as a contributor, and the viewer (viewer storageState from `auth-viewer.setup.ts`) to verify restricted access.

**Contract**: Uses `mockGitHubApis(page)` from fixtures (for the owner's board creation). The viewer's GitHub login must match a mock collaborator login (`bob-viewer`). Flow:

1. **Owner setup** (in `beforeAll`): Owner creates a board via the wizard (selecting `alice-dev` as initial contributor), then adds `bob-viewer` as a contributor via the settings dialog. Captures the board ID.
2. **Viewer UI assertions**: Create a new browser context with `browser.newContext({ storageState: 'playwright/.auth/viewer.json' })`. Navigate to `/board/{id}/settings`. Assert:
   - Board name is visible as static text (no edit pencil/button)
   - Repos are listed as static text (no "Add repository" button, no trash icons)
   - Contributors are listed as static links (no "Add contributors" button, no trash icons)
   - "Danger zone" section is not visible (no "Delete board" button)
3. **Viewer API assertions**: Using the viewer's page context, make API requests and assert 403:
   - `PATCH /api/board/{id}/settings` with `{ name: "hacked" }` → 403
   - `DELETE /api/board/{id}` → 403
   - `POST /api/board/{id}/contributors` with a payload → 403
   - `DELETE /api/board/{id}/contributors` with a payload → 403
4. **Cleanup** (in `afterAll`): Owner deletes the board via the UI.

### Success Criteria:

#### Automated Verification:

- Spec passes: `npx playwright test non-owner-denied.spec.ts`
- Full suite still green: `npx playwright test`

#### Manual Verification:

- Watch the headed test and confirm the viewer's settings page shows only static content
- Verify the viewer cannot see any mutation controls

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 5: CI Integration

### Overview

Add a `test-e2e` job to `.github/workflows/ci.yml` that runs the full Playwright suite on every PR. Requires local Supabase (like `test-integration`), Playwright browser installation, and E2E test account credentials as CI secrets.

### Changes Required:

#### 1. CI workflow — add test-e2e job

**File**: `.github/workflows/ci.yml`

**Intent**: Add a new job that starts local Supabase, installs Playwright browsers, writes E2E credentials to `.dev.vars`, and runs `npx playwright test`. Upload trace artifacts on failure for debugging.

**Contract**: New job `test-e2e` with the same runner and Node setup as `test-integration`. Steps:

1. Checkout, setup Node 24, `npm ci`
2. Supabase CLI setup (`supabase/setup-cli@v2`) + `npx supabase start`
3. `npx astro sync` (needs Cloudflare secrets)
4. `npx playwright install --with-deps chromium`
5. Write `.dev.vars` with local Supabase credentials AND E2E test account credentials (`E2E_EMAIL`, `E2E_PASSWORD`, `E2E_GITHUB_PAT`, `E2E_VIEWER_EMAIL`, `E2E_VIEWER_PASSWORD`) from GitHub secrets
6. `npx playwright test`
7. On failure: `actions/upload-artifact` targeting `playwright-report/` and `test-results/`

Required new GitHub repository secrets: `E2E_EMAIL`, `E2E_PASSWORD`, `E2E_GITHUB_PAT`, `E2E_VIEWER_EMAIL`, `E2E_VIEWER_PASSWORD`.

#### 2. Document E2E CI secrets

**File**: `context/changes/e2e-core-user-flows/change.md`

**Intent**: Document the new CI secrets needed and how to create the test accounts in the Notes section.

**Contract**: Update the Notes section with the list of required secrets and instructions for creating E2E test users in local Supabase (or the process for CI — users need to exist in the Supabase instance the CI job uses).

### Success Criteria:

#### Automated Verification:

- CI `test-e2e` job passes on a PR branch
- Existing CI jobs (`validate`, `test-integration`) are unaffected

#### Manual Verification:

- Review the CI job output and confirm Playwright traces are uploaded as artifacts on a deliberate failure
- Verify the E2E test accounts are documented

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### E2E Tests (this plan):

- Board lifecycle: empty dashboard → create → redirect verification → delete → empty dashboard
- Contributor CRUD: add via dialog → verify settings + impact nav → remove → verify gone
- Non-owner denial: UI hides controls + API returns 403

### Existing Coverage (not modified):

- Seed test: wizard state machine → settings verification → delete (Risk #3, #8)
- Component tests: wizard state reducer, form interactions
- Integration tests: RLS isolation, PAT leak, board settings mutation auth
- Hermetic tests: board creation API, contributor/repo API handlers

### Manual Testing Steps:

1. Run `npx playwright test --headed` and watch each spec execute
2. Verify the contributor dialog opens, populates collaborators, and closes after add
3. Verify the impact nav dropdown appears with both contributors
4. Verify the non-owner settings page shows only static text
5. Run `npx playwright test` in CI-like mode (fresh Supabase) to verify reproducibility

## Performance Considerations

- E2E suite adds ~30-60s to local test time (3 specs + seed + auth setup)
- CI adds a new job (~3-5 min including Supabase start + browser install + tests)
- `fullyParallel: true` in config means specs run concurrently locally; CI uses `workers: 1` for stability
- Each spec creates and deletes its own board — no cross-spec state dependency

## Migration Notes

- Two new E2E test accounts must be created (owner + viewer) before the suite can run
- For local dev: accounts need to exist in local Supabase (create via `npx supabase` or the signup UI)
- For CI: accounts need to be pre-seeded or created during the CI job setup (the auth setup files create sessions for existing accounts, they don't create the accounts themselves)
- Five new GitHub repository secrets required for CI: `E2E_EMAIL`, `E2E_PASSWORD`, `E2E_GITHUB_PAT`, `E2E_VIEWER_EMAIL`, `E2E_VIEWER_PASSWORD`

## References

- Test plan: `context/foundation/test-plan.md` — Phase 8, Risk Map (#3, #8, R5, #1)
- Seed test (template): `tests/e2e/seed.spec.ts`
- Auth setup: `tests/e2e/auth.setup.ts`
- Playwright config: `playwright.config.ts`
- ContributorManager: `src/components/ContributorManager.tsx:207-374`
- Settings page: `src/pages/board/[id]/settings.astro:46-133`
- Dashboard: `src/pages/dashboard.astro:18-30`
- Impact view contributor selector: `src/components/impact/ImpactView.tsx:101-175`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Foundation — Fixtures, Viewer Auth, npm Script

#### Automated

- [x] 1.1 Seed test passes with shared fixtures: `npx playwright test seed.spec.ts` — 2799708
- [x] 1.2 Viewer auth setup completes: `npx playwright test --project=setup-viewer` — 2799708
- [x] 1.3 TypeScript compiles: `npx tsc --noEmit` — 2799708

#### Manual

- [x] 1.4 `playwright/.auth/viewer.json` created after setup — 2799708
- [x] 1.5 `npm run e2e` runs the full suite — 2799708

### Phase 2: Board Lifecycle Spec

#### Automated

- [x] 2.1 Spec passes: `npx playwright test board-lifecycle.spec.ts`
- [x] 2.2 Full suite still green: `npx playwright test`

#### Manual

- [x] 2.3 Headed run visually matches expectations

### Phase 3: Contributor Management Spec

#### Automated

- [x] 3.1 Spec passes: `npx playwright test contributor-management.spec.ts` — 25f9312
- [x] 3.2 Full suite still green: `npx playwright test` — 25f9312

#### Manual

- [x] 3.3 Dialog interaction works correctly in headed run
- [x] 3.4 Impact nav dropdown appears with both contributors

### Phase 4: Non-Owner Denial Spec

#### Automated

- [x] 4.1 Spec passes: `npx playwright test non-owner-denied.spec.ts` — e6414ea
- [x] 4.2 Full suite still green: `npx playwright test` — e6414ea

#### Manual

- [x] 4.3 Viewer settings page shows only static content in headed run

### Phase 5: CI Integration

#### Automated

- [ ] 5.1 CI `test-e2e` job passes on PR branch
- [ ] 5.2 Existing CI jobs unaffected

#### Manual

- [ ] 5.3 Playwright traces uploaded as artifacts on deliberate failure
- [ ] 5.4 E2E test accounts documented
