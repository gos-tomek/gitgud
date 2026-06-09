# Testing Access Boundary — Implementation Plan

## Overview

Bootstrap Vitest and write integration tests that prove cross-board isolation (Risk #1), PAT non-leakage (Risk #2), and RLS policy correctness (Risk #5) against a real local Supabase instance. This is Phase 1 of the test-plan rollout (`context/foundation/test-plan.md §3`).

## Current State Analysis

Zero test infrastructure exists: no runner, no test files, no npm scripts.

Research (`context/changes/testing-access-boundary/research.md`) mapped:

- Full RLS policy tree across 7 board-scoped tables — consistent pattern: SELECT for members, writes for owner only, mediated by `is_board_member()` / `is_board_owner()` SECURITY DEFINER helpers
- PAT lifecycle with 4 leak vectors: two in API response bodies (sync.ts outer catch, SyncResult.errors[]), two in log output (zero-sanitization logger, Cloudflare observability)
- Vitest 4.x + `getViteConfig()` as the recommended test runner setup
- Service functions (`boards.ts`, `github-sync.ts`) are clean of `astro:env/server` — testable with direct Supabase clients
- `github.ts` imports `astro:env/server` — requires `getViteConfig()` to resolve in tests

### Key Discoveries:

- All 7 tables are missing `REVOKE ALL FROM authenticated` (violating `lessons.md` convention). Tests will verify RLS still denies access despite this gap — documenting current behavior as a baseline, not fixing it.
- RLS SELECT denial is **silent** (returns empty `[]`, no error). INSERT denial returns error code `42501`. UPDATE/DELETE denial silently affects 0 rows. Tests must assert the correct denial shape per operation.
- The Supabase client in the app uses `@supabase/ssr` with cookie-based sessions. HTTP tests need to construct auth cookies matching what `parseCookieHeader` in `src/lib/supabase.ts` expects.
- `sync.ts:58–61` outer catch returns `err.message` to client — the primary PAT leak vector in response bodies.
- `consola` default reporter prints only `err.message` + `err.stack` — currently safe, but fragile (no explicit redaction).
- No Cloudflare-specific APIs used in `src/` — tests run in Node.js, no miniflare needed.

## Desired End State

- `npm test` runs Vitest integration tests against a running local Supabase
- Tests prove: a user on Board A cannot access Board B's data through any of the 7 board-scoped tables or any service function
- Tests prove: the raw PAT string never appears in sync endpoint error responses or captured server log output
- `test-plan.md §6.1` cookbook documents integration test patterns for future use
- Verification: `npm test` passes with all assertions green; stopping Supabase causes tests to skip with a clear message

## What We're NOT Doing

- Fixing the `REVOKE ALL FROM authenticated` gap (separate change — tests document current behavior)
- Adding a logger redaction layer (separate change — tests assert PAT absence, acting as a canary)
- Component tests for the board creation wizard (Phase 2)
- Zod validation schema tests (Phase 3)
- CI integration for tests (Phase 4 of test-plan rollout)
- e2e tests or Playwright setup
- Testing static pages or generated types (excluded per `test-plan.md §7`)

## Implementation Approach

Two test suites, each using the cheapest layer that gives a real signal:

1. **`access-boundary.test.ts`** — Direct Supabase client (two-client pattern: admin bypasses RLS for setup/teardown, user client enforces RLS for assertions). No HTTP server, no Astro runtime. Tests the actual access boundary at the database level.

2. **`pat-leak.test.ts`** — Hybrid approach: HTTP requests to a running Astro dev server for response body vectors (#1/#2), plus server stdout/stderr capture for log vectors (#3/#4). Stores a known invalid PAT, triggers sync errors, asserts the PAT string is absent from all output channels.

## Critical Implementation Details

### Supabase SSR cookie construction for HTTP tests

The Astro app's `src/lib/supabase.ts` creates a server client via `@supabase/ssr` that reads auth from the `Cookie` header using `parseCookieHeader`. For local Supabase (`http://127.0.0.1:54321`), the storage key is `sb-127-auth-token` (derived from hostname). HTTP tests must sign in via `@supabase/supabase-js`, extract the session, and set this cookie with the session payload so the server-side client can resolve the authenticated user. If the session JSON exceeds the cookie size limit, `@supabase/ssr` uses chunked cookies (`sb-127-auth-token.0`, `.1`, etc.) — the auth-fetch helper must handle this.

---

## Phase 1: Bootstrap Test Infrastructure

### Overview

Install Vitest, create configuration and test helpers, add npm scripts, update ESLint config, verify with a smoke test.

### Changes Required:

#### 1. Install Vitest

**File**: `package.json`

**Intent**: Add Vitest as a dev dependency and create test scripts so `npm test` runs the integration suite.

**Contract**: `npm install -D vitest`. Add scripts `"test": "vitest run"` and `"test:watch": "vitest"`.

#### 2. Vitest configuration

**File**: `vitest.config.ts` (new)

**Intent**: Configure Vitest with Astro's `getViteConfig()` to resolve `astro:env/server`, `astro:middleware`, and the `@/*` path alias — without needing manual module mocks.

**Contract**: Default export from `getViteConfig()` (`astro/config`). Test options: `environment: "node"`, `globals: true`, `include: ["tests/**/*.test.ts"]`. If `getViteConfig()` doesn't resolve the `@/*` alias correctly, add explicit `resolve.alias` using `import.meta.url`.

#### 3. Test helper: Supabase clients

**File**: `tests/helpers/supabase.ts` (new)

**Intent**: Provide an admin client (service-role key, bypasses RLS) for setup/teardown and a test user factory for creating ephemeral authenticated clients.

**Contract**: Exports:

- `adminClient` — `createClient(SUPABASE_URL, SERVICE_ROLE_KEY)` from `@supabase/supabase-js`
- `createTestUser(email: string) → Promise<{ client: SupabaseClient, userId: string }>` — creates user via `adminClient.auth.admin.createUser({ email, password, email_confirm: true })`, signs in via a fresh anon client, returns both
- `cleanupUser(userId: string)` — deletes user via admin
- `cleanupBoard(boardId: string)` — deletes board via admin (CASCADE handles children)

Reads `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` from `process.env` with local Supabase defaults as fallback. Local keys are stable across `supabase start` invocations.

#### 4. Test helper: Supabase availability guard

**File**: `tests/helpers/setup.ts` (new)

**Intent**: Skip all integration tests with a clear message if local Supabase isn't running, rather than failing with cryptic connection errors.

**Contract**: Exports a setup function for use in `beforeAll`. Pings the Supabase REST API (`GET /rest/v1/`). If unreachable, logs "Local Supabase not running — run `npx supabase start`" and skips the test suite.

#### 5. ESLint config for test files

**File**: `eslint.config.js`

**Intent**: Allow Vitest globals (`describe`, `it`, `expect`) and console usage in test files without triggering lint warnings.

**Contract**: Add a config entry for files matching `tests/**/*.ts` that disables `no-console` and declares Vitest globals. This avoids per-file `// eslint-disable` comments.

#### 6. Smoke test

**File**: `tests/integration/smoke.test.ts` (new)

**Intent**: Verify the entire test infrastructure works end-to-end: Vitest runs, Supabase guard passes, admin client connects, user factory works.

**Contract**: Single `describe` block that creates a test user, queries the `boards` table (expect empty for a fresh user), and cleans up. Proves the two-client pattern works before writing real tests.

### Success Criteria:

#### Automated Verification:

- `npm test` runs and the smoke test passes
- `npm run lint` passes with test files included
- TypeScript: `npx astro check` or `npx tsc --noEmit` passes with test files

#### Manual Verification:

- Stop local Supabase (`npx supabase stop`), run `npm test` — tests skip with clear message, not fail with connection errors

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Cross-Board Isolation Tests (Risk #1 + #5)

### Overview

Prove that RLS policies correctly deny cross-board access across all 7 board-scoped tables and through service functions. Uses the direct Supabase client approach — no HTTP server needed.

### Changes Required:

#### 1. Test data seeding helper

**File**: `tests/helpers/seed.ts` (new)

**Intent**: Provide a reusable fixture that creates two isolated board environments with full data chains, enabling cross-board denial assertions.

**Contract**: Exports `seedTwoBoards() → Promise<TwoBoardFixture>` where the fixture contains:

- `ownerA: { client, userId, boardId }` and `ownerB: { client, userId, boardId }`
- Seeded data IDs for Board A: `repoId`, `prId`, `reviewId`, `commentId`, `contributorId`
- `cleanup()` function that deletes boards (CASCADE) then users

Seeds via admin client: create boards → insert board_members (owner auto-enrolled by trigger) → insert github_repos → insert github_pull_requests → insert github_reviews → insert github_review_comments → insert board_contributors. All for Board A. Board B gets only a board (minimal data, enough to prove isolation).

#### 2. Access boundary test suite

**File**: `tests/integration/access-boundary.test.ts` (new)

**Intent**: Systematically verify that User B (owner of Board B) cannot access any data belonging to Board A, across all 7 tables and all CRUD operations. Also verify service function isolation and edge cases.

**Contract**: Test structure:

- **`describe("cross-board SELECT denial")`**: For each of boards, board_members, github_repos, github_pull_requests, github_reviews, github_review_comments, board_contributors — User B's client queries with Board A's IDs → `expect(data).toEqual([])`. This is the core IDOR test.

- **`describe("cross-board write denial")`**: For each table where User B is not the owner:
  - INSERT → `expect(error?.code).toBe("42501")`
  - UPDATE (where applicable) → verify 0 rows affected by reading via admin
  - DELETE → verify row still exists via admin

- **`describe("service function isolation")`**: Import `getBoardWithRole`, `getBoardRepos`, `getBoardContributors` from `@/lib/services/boards`. Call each with User B's client and Board A's ID:
  - `getBoardWithRole(clientB, boardIdA, userIdB)` → expect `null`
  - `getBoardRepos(clientB, boardIdA)` → expect `[]`
  - `getBoardContributors(clientB, boardIdA)` → expect `[]`

- **`describe("indirect join denial")`**: User B queries `github_reviews` and `github_review_comments` using Board A's PR ID → expect empty. User B queries using a non-existent PR ID → expect empty (not error). This tests the `get_board_id_for_pr()` → `is_board_member()` chain with NULL board_id.

- **`describe("REVOKE ALL gap verification")`**: Same cross-board SELECT assertions as above, but explicitly named to document that RLS denies access despite missing `REVOKE ALL FROM authenticated`. The test names should state this assumption so a future migration fix can reference these tests.

### Success Criteria:

#### Automated Verification:

- All cross-board SELECT queries return `[]` (not errors) for all 7 tables
- All cross-board INSERT attempts return PostgreSQL error code `42501`
- All cross-board UPDATE/DELETE attempts affect 0 rows (verified via admin client)
- Service functions return `null` / `[]` for non-member users
- Indirect join queries return `[]` for cross-board and non-existent PR IDs
- All tests pass: `npm test`

#### Manual Verification:

- Review test output to confirm all 7 tables are covered for SELECT and that write operations match the policy design (owner-only writes)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: PAT Non-Leakage Tests (Risk #2)

### Overview

Prove that the raw PAT string never appears in sync endpoint error responses or server log output when errors occur during PAT-handling code paths. Uses a hybrid approach: HTTP tests for response body vectors, server output capture for log vectors.

### Changes Required:

#### 1. HTTP test helper: Astro dev server lifecycle

**File**: `tests/helpers/astro-server.ts` (new)

**Intent**: Start the Astro dev server programmatically for HTTP integration tests and capture its stdout/stderr for log leak assertions.

**Contract**: Exports:

- `startAstroServer(port: number) → Promise<{ stop: () => Promise<void>, output: () => string[] }>` — spawns `npx astro dev --port <port>`, waits for the ready signal in stdout (e.g., "Local" or the URL), captures all stdout/stderr lines, returns a handle with `stop()` and `output()` (returns accumulated server output)
- Use a non-default port (e.g., 4321) to avoid conflicts with a running dev server

#### 2. HTTP test helper: authenticated fetch

**File**: `tests/helpers/auth-fetch.ts` (new)

**Intent**: Make authenticated HTTP requests to the Astro dev server so API routes can resolve the current user via Supabase SSR cookies.

**Contract**: Exports `createAuthenticatedFetch(supabaseClient: SupabaseClient, baseUrl: string) → (path: string, init?: RequestInit) => Promise<Response>`. Extracts the session from the signed-in client, constructs the `sb-127-auth-token` cookie (matching `@supabase/ssr` format for local Supabase), and includes it in the `Cookie` header of every request.

#### 3. PAT leak test suite

**File**: `tests/integration/pat-leak.test.ts` (new)

**Intent**: Assert that the raw PAT never appears in sync endpoint error responses (Vectors #1/#2) or captured server output (Vectors #3/#4).

**Contract**: Test structure:

- **Setup**: Create test user (board owner), create board via admin, store a known test PAT (e.g., `"ghp_TestSentinelPAT_NEVER_LEAK_THIS_1234"`) via admin client calling `set_board_github_pat` RPC with a test encryption key. The PAT is intentionally invalid — it will cause GitHub API calls to fail during sync. Start Astro dev server.

- **`describe("sync error response does not contain PAT (Vectors #1/#2)")`**: Authenticate as the board owner. POST to `/api/github/sync` with `{ boardId }`. Expect a non-200 response (sync fails because the PAT is invalid). Assert: `expect(responseBody).not.toContain(TEST_PAT)` on the full JSON-stringified response. Assert: `expect(responseBody).not.toContain(ENCRYPTION_KEY)`.

- **`describe("server output does not contain PAT (Vectors #3/#4)")`**: After triggering the sync error above, read the captured server stdout/stderr. Assert: no line contains the test PAT string. Assert: no line contains the encryption key. This covers the consola logger + Cloudflare observability concern.

- **`describe("pre-PAT error paths return clean messages")`**: POST to `/api/github/sync` without auth → expect `{ error: "Unauthorized" }` (no PAT involved). POST with non-owner user → expect `{ error: "Only the board owner can trigger a sync" }`. POST with non-existent boardId → expect `{ error: "Board not found" }`. These verify that error paths that precede PAT handling don't leak any internal details.

### Success Criteria:

#### Automated Verification:

- Sync error response body does not contain the test PAT string or encryption key
- Captured server output (stdout/stderr) does not contain the test PAT string or encryption key
- Pre-PAT-handling error paths (401, 403, 404) return exact hardcoded error messages
- All tests pass: `npm test`

#### Manual Verification:

- Review the actual error messages returned by the sync endpoint in test output — confirm they are generic (e.g., "Sync failed", "Bad credentials") and not leaking internal state

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Cookbook + Cleanup

### Overview

Document the integration test patterns established in Phases 1–3 into the test-plan cookbook, update rollout status, and close the change.

### Changes Required:

#### 1. Fill in test-plan cookbook §6.1

**File**: `context/foundation/test-plan.md`

**Intent**: Document the integration test patterns so future developers can write new tests following established conventions without re-reading the full plan.

**Contract**: Replace the "TBD" placeholder in §6.1 with a concise cookbook covering:

- Two-client pattern (admin for setup/teardown, user for assertions)
- Test user factory usage
- Test data seeding pattern
- RLS denial assertion patterns per operation type (empty for SELECT, 42501 for INSERT, verify-via-admin for UPDATE/DELETE)
- Console/server output capture for sensitive data leak testing
- Astro dev server lifecycle for HTTP tests
- Supabase guard pattern

#### 2. Update rollout status

**File**: `context/foundation/test-plan.md`

**Intent**: Mark Phase 1 as shipped in the §3 rollout table.

**Contract**: Change the Status cell for Phase 1 from `change opened` to `shipped`. Set the Change folder to `context/changes/testing-access-boundary/`.

#### 3. Update change.md

**File**: `context/changes/testing-access-boundary/change.md`

**Intent**: Mark the change as complete.

**Contract**: Set `status: done`, `updated: <today's date>`.

### Success Criteria:

#### Automated Verification:

- All test suites still pass after doc changes: `npm test`

#### Manual Verification:

- Read §6.1 cookbook: a developer unfamiliar with the test setup can follow it to write a new RLS integration test

---

## Testing Strategy

### Integration Tests (Real Supabase):

- Cross-board SELECT/INSERT/UPDATE/DELETE denial for all 7 tables
- Service function isolation (`getBoardWithRole`, `getBoardRepos`, `getBoardContributors`)
- Indirect join denial through `get_board_id_for_pr` chain
- PAT non-leakage in sync endpoint error responses
- PAT non-leakage in server log output

### Edge Cases:

- `get_board_id_for_pr(non_existent_id)` → access denied (NULL board_id path)
- Sync with invalid PAT → error response doesn't contain token
- Pre-PAT-handling errors (401, 403, 404) return hardcoded messages only
- Missing `REVOKE ALL FROM authenticated` doesn't create RLS bypass

### Manual Testing Steps:

1. Stop local Supabase, run `npm test` — verify tests skip with clear message
2. Start Supabase, run `npm test` — verify all tests pass
3. Review sync endpoint error messages in test output for leakage
4. Read §6.1 cookbook and assess whether a new developer could follow it

## Performance Considerations

- Integration tests are I/O-bound (HTTP to local Postgres). Individual assertions are fast (~50-100ms) but setup/teardown (user creation, board seeding) adds overhead.
- Phase 3 HTTP tests add Astro dev server startup time (~3-5s). The server lifecycle should span the entire test suite, not restart per test.
- Total suite runtime target: under 30s for the full run (excluding server startup).

## References

- Research: `context/changes/testing-access-boundary/research.md`
- Test plan: `context/foundation/test-plan.md` (§3 Phase 1, §6.1 cookbook target)
- Lessons: `context/foundation/lessons.md` (REVOKE ALL convention)
- Archived PAT design: `context/archive/2026-05-30-github-ingestion-access/plan.md`
- Archived board creation: `context/archive/2026-06-01-link-board-to-github-org/plan.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Bootstrap test infrastructure

#### Automated

- [x] 1.1 npm test runs and smoke test passes — 1f002a6
- [x] 1.2 npm run lint passes with test files — 1f002a6
- [x] 1.3 TypeScript compilation passes with test files — 1f002a6

#### Manual

- [x] 1.4 Supabase stopped → tests skip with clear message

### Phase 2: Cross-board isolation tests

#### Automated

- [x] 2.1 Cross-board SELECT queries return empty arrays for all 7 tables — 585df1a
- [x] 2.2 Cross-board INSERT attempts return error code 42501 — 585df1a
- [x] 2.3 Cross-board UPDATE/DELETE attempts affect 0 rows (verified via admin) — 585df1a
- [x] 2.4 Service functions return null/empty for non-members — 585df1a
- [x] 2.5 All tests pass: npm test — 585df1a

#### Manual

- [ ] 2.6 Review test output confirms all 7 tables and write operations covered

### Phase 3: PAT non-leakage tests

#### Automated

- [x] 3.1 Sync error response body does not contain test PAT or encryption key — 32ecd17
- [x] 3.2 Server stdout/stderr does not contain test PAT or encryption key — 32ecd17
- [x] 3.3 Pre-PAT-handling errors return exact hardcoded messages — 32ecd17
- [x] 3.4 All tests pass: npm test — 32ecd17

#### Manual

- [x] 3.5 Review actual sync endpoint error messages for leakage — 32ecd17

### Phase 4: Cookbook + cleanup

#### Automated

- [x] 4.1 All test suites still pass after doc changes

#### Manual

- [x] 4.2 §6.1 cookbook is followable by unfamiliar developer
