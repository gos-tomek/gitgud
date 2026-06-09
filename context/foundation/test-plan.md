# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-06-09

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic visual diff that already catches
   the regression.
2. **User concerns are first-class evidence.** Risks anchored in "the
   team is worried about X, and the failure would surface somewhere in
   \<area\>" carry the same weight as PRD lines or hot-spot data.
3. **Risks are scenarios, not code locations.** This plan documents _what
   could fail_ and _why we believe it's likely_ — drawn from documents,
   interview, and codebase _signal_ (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is
   produced by `/10x-research` during each rollout phase. If the plan and
   research disagree about where the failure lives, research is the
   ground truth.

Hot-spot scope used for likelihood weighting: `src/`, `supabase/migrations/` — 80 commits / 30 days.

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the _evidence that surfaced
this risk_ — never a specific file as "where the failure lives" (that is
research's job, see §1 principle #3).

| #   | Risk (failure scenario)                                                                                                                                                                                  | Impact | Likelihood | Source (evidence — not anchor)                                                                                                    |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Cross-board data leakage (IDOR)** — a user on Board A reads repos, contributors, or profile data belonging to Board B through API routes or direct Supabase queries                                    | High   | Medium     | Interview Q1; PRD guardrails (no hidden management-only layer, data parity NFR); hot-spot dir `src/lib/services/` (7 commits/30d) |
| 2   | **GitHub PAT exposed to client** — raw or partially-masked PAT surfaces in an API response body, error message, or application log                                                                       | High   | Medium     | Interview Q1; infrastructure.md (no observability wired); hot-spot dir `src/pages/api/github/` (6 commits/30d)                    |
| 3   | **Board wizard state regression** — 3-step CreateBoardForm loses data between steps, allows step bypass, or submits incomplete board (missing repos or contributors)                                     | Medium | High       | Interview Q3; hot-spot dir `src/components/` (6 commits/30d); archived S-02/S-03 plans (form refactored twice)                    |
| 4   | **Board creation partial-failure state** — POST /api/boards inserts board, stores PAT, links repos, stores contributors in sequence; partial failure leaves orphaned data with no rollback               | Medium | Medium     | Archived S-02/S-03 plans (multi-step insert); hot-spot dir `src/pages/api/boards/` (4 commits/30d)                                |
| 5   | **RLS policy gap on new tables** — a new migration adds a table without REVOKE ALL, missing per-operation policies, or a policy subquery that introduces recursion/bypass                                | High   | Medium     | Lessons.md ("Always REVOKE ALL before RLS"); PRD Access Control; hot-spot dir `supabase/migrations/` (5 commits/30d)              |
| 6   | **Server trusts client on API boundaries** — an API route passes unvalidated URL params, array contents, or nested objects to Supabase, allowing malformed input to corrupt data or bypass access checks | Medium | Medium     | CLAUDE.md (Zod validation convention); hot-spot dir `src/pages/api/` (10+ commits/30d combined)                                   |

**Deferred risks** — PRD-grounded scenarios for slices not yet built. These activate when their prerequisite code ships; re-evaluate via `--refresh`.

| #   | Risk (failure scenario)                                                                                                                                            | Impact | Likelihood | Source (evidence — not anchor)                                                                              | Activates with              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ---------- | ----------------------------------------------------------------------------------------------------------- | --------------------------- |
| 7   | **Data parity violation** — IC viewing their own profile sees different data than EM viewing the same profile, breaking the transparency invariant                 | High   | Medium     | PRD NFR data-parity; PRD guardrail (IC sees same data as EM)                                                | S-04 (raw metrics)          |
| 8   | **Board deletion cascade incomplete** — deleting a board leaves orphaned contributors, repos, PRs, reviews, or classification data in the database                 | Medium | Medium     | PRD FR-021; roadmap S-10 (destructive operation, no undo)                                                   | S-10 (delete board)         |
| 9   | **Classification stores raw comment content** — the daily batch persists full comment text after classification, violating the no-retention guardrail              | High   | Medium     | PRD FR-012 Business Logic ("no raw comment content stored after classification"); roadmap Open Q4 (privacy) | F-03 (classification batch) |
| 10  | **OAuth identity mismatch** — user links the wrong GitHub account; auto-match trigger fails silently; IC sees no classified data despite being a board contributor | Medium | Medium     | Roadmap F-04 (multiple GitHub accounts unknown); PRD Access Control (identity bridge)                       | F-04 (OAuth linking)        |
| 11  | **PAT expiry false positive/negative** — board freezes when PAT is valid (false positive), or continues syncing with an expired PAT (false negative)               | Medium | Low        | PRD FR-022; roadmap S-11 (detection mechanism unknown)                                                      | S-11 (PAT expiry freeze)    |

### Risk Response Guidance

| Risk | What would prove protection                                                                                                                                        | Must challenge                                                                                                                                                                | Context `/10x-research` must ground                                                                                                               | Likely cheapest layer                                                                     | Anti-pattern to avoid                                                                                      |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| #1   | User on Board A cannot SELECT/INSERT/UPDATE/DELETE rows belonging to Board B, regardless of API route                                                              | "RLS is enabled" does not mean "RLS is correct" — policy expressions must be verified against actual cross-board queries, not just auth presence                              | Full RLS policy tree across all tables with board_id FK; SECURITY DEFINER helpers and search_path settings; any API route that constructs queries | Integration (real Supabase, two users, two boards)                                        | Testing only that the owner sees their own data (happy path) without asserting non-member is denied        |
| #2   | No API response body, error response, or log entry contains a raw PAT value                                                                                        | "PAT is encrypted at rest" does not mean it never appears decrypted in transit — decryption happens on every GitHub API call                                                  | All code paths that decrypt or handle raw PAT; error handling in those paths; logger configuration and output shape                               | Integration (call API routes, inspect response + error payloads)                          | Asserting stored value is encrypted without checking transient exposure in responses and error bodies      |
| #3   | Wizard enforces step ordering, persists data across all 3 steps, final submit includes complete data from every step                                               | "The form renders" does not mean the state machine works — each transition must carry data forward and validate preconditions                                                 | React state shape for the wizard; step transition triggers; data flow from wizard state to API call payload                                       | Component tests (vitest + testing-library) for state machine; integration for full submit | Snapshot tests that verify HTML but not behavior; testing steps in isolation without verifying transitions |
| #4   | If a mid-sequence step fails, user sees a clear error and no orphaned data persists (or cleanup runs)                                                              | "Each step succeeds individually" does not mean the sequence is safe — the failure of step 3 of 4 is the interesting case                                                     | Exact operation sequence in POST /api/boards; whether any steps use transactions or have cleanup on failure                                       | Hermetic (stub Supabase client that fails on specific operations)                         | Testing only the happy path (all steps succeed) without partial-failure scenarios                          |
| #5   | Every table has REVOKE ALL + per-operation RLS verified by running cross-user queries, not by reading the SQL text                                                 | "The migration file looks correct" does not mean the policies are correct in combination — interaction effects between policies on different tables can open unexpected paths | Full migration chain; SECURITY DEFINER function definitions and their search_path; policy dependency graph across tables                          | Integration (per table: insert as user A, verify user B cannot SELECT)                    | Checking migration SQL text rather than running actual cross-user queries against a real DB                |
| #6   | Every API route rejects invalid input (missing fields, wrong types, out-of-bounds values) with a clean error, never passing raw unvalidated params to the database | "Zod is imported" does not mean every field is validated — URL params and nested array contents often slip through unvalidated                                                | Each API route's validation schema; what gets passed to Supabase calls; whether URL params are validated or trusted                               | Unit tests for Zod schemas; integration for routes with invalid payloads                  | Testing only that valid input succeeds without testing that invalid input is rejected                      |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| #   | Phase name                        | Goal (one line)                                                                         | Risks covered        | Test types                                                      | Status        | Change folder                            |
| --- | --------------------------------- | --------------------------------------------------------------------------------------- | -------------------- | --------------------------------------------------------------- | ------------- | ---------------------------------------- |
| 1   | Bootstrap + access boundary       | Install test runner; prove cross-board isolation and PAT non-leakage with real DB tests | #1, #2, #5           | integration (real Supabase)                                     | shipped       | context/changes/testing-access-boundary/ |
| 2   | Board creation contract           | Prove wizard state machine and API orchestration handle happy + failure paths           | #3, #4               | component (vitest + testing-library), hermetic (stubbed client) | not started   | —                                        |
| 3   | Validation + data layer templates | RLS regression template for new tables; validation test template for API routes         | #5, #6               | integration (RLS per-table), unit (Zod schemas)                 | not started   | —                                        |
| 4   | Quality gates                     | Wire vitest into CI; set minimum signal floor; update project conventions               | cross-cutting        | CI gates                                                        | not started   | —                                        |
| 5   | Slice-ready contracts             | Cover deferred risks #7–#11 as their prerequisite slices ship                           | #7, #8, #9, #10, #11 | integration, hermetic                                           | not started   | —                                        |

## 4. Stack

Test-base profile: **none** — no test runner config, no test files. Phase 1 bootstraps the runner.

| Layer              | Tool                   | Version | Notes                                                      |
| ------------------ | ---------------------- | ------- | ---------------------------------------------------------- |
| unit + integration | none yet — see Phase 1 | —       | Vitest recommended (Astro 6 / TypeScript / Vite ecosystem) |
| component          | none yet — see Phase 2 | —       | @testing-library/react for React islands                   |
| API mocking        | none yet — see Phase 2 | —       | Stubbed Supabase client for hermetic tests                 |
| e2e                | none yet               | —       | Not in rollout scope; evaluate at --refresh                |
| accessibility      | none yet               | —       | Not in rollout scope                                       |

**Stack grounding tools (current session):**

- Docs: Context7 — available; Astro 6 and Vitest docs accessible; checked: 2026-06-09
- Search: Exa.ai — available; can verify current tool support and APIs; checked: 2026-06-09
- Runtime/browser: none — no Playwright MCP in current session
- Provider/platform: Cloudflare MCP — available (docs/search/execute); relevant for Workers-specific test setup; checked: 2026-06-09

## 5. Quality Gates

| Gate               | Where      | Required?                 | Catches                                       |
| ------------------ | ---------- | ------------------------- | --------------------------------------------- |
| lint + typecheck   | local + CI | required (wired)          | syntactic / type drift                        |
| build              | local + CI | required (wired)          | SSR compilation, import resolution            |
| unit + integration | local + CI | required after §3 Phase 1 | logic regressions, access boundary violations |
| component tests    | local + CI | required after §3 Phase 2 | wizard state machine regressions              |
| pre-commit (husky) | local      | required (wired)          | eslint --fix + prettier on staged files       |

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once
the relevant rollout phase ships; before that, the sub-section reads
"TBD — see §3 Phase \<N\>."

### 6.1 Adding an integration test (RLS / access boundary)

**Reference implementation**: `tests/integration/access-boundary.test.ts`, `tests/integration/pat-leak.test.ts`

#### Two-client pattern

Every integration test uses two Supabase clients with different privilege levels:

- **Admin client** (`adminClient` from `tests/helpers/supabase.ts`) — initialized with the service-role key, bypasses RLS. Use for setup (insert seed data), teardown (delete rows/users), and post-operation verification (confirm UPDATE/DELETE affected 0 rows).
- **User client** (returned by `createTestUser`) — initialized with the anon key, signed in as a specific user, enforces RLS. Use for all assertions about what a user can or cannot access.

Never use the admin client to assert access control — it bypasses RLS and will always succeed.

#### Test user factory

```ts
import { createTestUser, cleanupUser, adminClient } from "../helpers/supabase.js";

const ts = Date.now();
const { client, userId } = await createTestUser(`test-${ts}@test.local`);
// ... tests ...
await cleanupUser(userId);
```

`createTestUser` creates the auth user via the admin API (email already confirmed), then signs in with a fresh anon client and returns both the signed-in client and the user ID. Always clean up in `afterAll` — leaked users accumulate in local Supabase.

#### Supabase availability guard

Wrap every integration test suite with `describe.skipIf` so tests skip cleanly when local Supabase isn't running:

```ts
import { checkSupabase } from "../helpers/setup.js";

const supabaseAvailable = await checkSupabase();

describe.skipIf(!supabaseAvailable)("My RLS test", () => {
  // ...
});
```

`checkSupabase` pings the REST API and does a probe query. If unreachable, it logs "Local Supabase not running — run `npx supabase start`" and returns `false`. The module-level `await` is valid because Vitest runs test files in a Node ESM context.

#### Test data seeding

Use the admin client to insert seed data — never the user client, whose RLS policies may block inserts needed for setup. Follow the FK chain top-down: boards → board_members (auto-enrolled by trigger) → github_repos → github_pull_requests → github_reviews → github_review_comments → board_contributors.

For cross-isolation tests, use `seedTwoBoards()` from `tests/helpers/seed.ts` which builds two full board environments in one call and returns a `cleanup()` function.

Always delete in `afterAll` and always cascade from the top (`boards` DELETE cascades all child rows); then delete users last. Pattern:

```ts
beforeAll(async () => { fixture = await seedTwoBoards(); });
afterAll(async () => { await fixture.cleanup(); });
```

#### RLS denial assertion patterns

RLS denials behave differently per operation — assert the correct shape:

| Operation | RLS behavior | Assertion |
|-----------|-------------|-----------|
| SELECT | USING clause filters silently — denied reads return an empty array, no error | `expect(error).toBeNull(); expect(data).toEqual([]);` |
| INSERT | WITH CHECK failure → PostgreSQL error code `42501` | `expect(error?.code).toBe("42501");` |
| UPDATE | USING clause match returns 0 rows — silently a no-op | Read via admin before + after; `expect(after?.field).toBe(before?.field)` |
| DELETE | USING clause match returns 0 rows — silently a no-op | Read via admin after; `expect(data).toHaveLength(N)` where N is expected surviving count |

For UPDATE/DELETE, always verify via the admin client that the row was not modified/deleted — the operation itself returns no error, so only the database state tells the truth.

#### Server output capture for sensitive data leak testing

To assert that a value never appears in server log output, start the Astro dev server programmatically and capture its stdout/stderr:

```ts
import { startAstroServer } from "../helpers/astro-server.js";

let serverHandle: Awaited<ReturnType<typeof startAstroServer>>;

beforeAll(async () => {
  serverHandle = await startAstroServer(4322); // use a non-default port
}, 30_000);

afterAll(async () => {
  await serverHandle.stop();
});

it("server output does not contain the secret", async () => {
  // trigger the code path that would log the secret
  const lines = serverHandle.output();
  expect(lines.some((l) => l.includes(SECRET))).toBe(false);
});
```

`startAstroServer` spawns `npx astro dev --port <port>`, waits for the ready signal, and captures all subsequent stdout/stderr into an array. `output()` returns that array at call time.

#### Astro dev server lifecycle for HTTP tests

Keep the server alive for the entire test suite — start it in `beforeAll`, stop it in `afterAll`. Never restart per test; startup takes 3–5 s. Use `createAuthenticatedFetch` to make requests with a valid Supabase session cookie:

```ts
import { createAuthenticatedFetch } from "../helpers/auth-fetch.js";

const authFetch = createAuthenticatedFetch(userClient, `http://localhost:4322`);
const res = await authFetch("/api/github/sync", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ boardId }),
});
```

`createAuthenticatedFetch` extracts the session from the signed-in Supabase client, encodes it in the `sb-{ref}-auth-token` cookie format that `@supabase/ssr` expects (including chunking for large sessions), and injects it into every request's `Cookie` header.

### 6.2 Adding a component test (React island)

TBD — see §3 Phase 2 for wizard state machine and multi-step form patterns.

### 6.3 Adding a unit test (Zod schema / pure function)

TBD — see §3 Phase 3 for validation template and Zod schema patterns.

### 6.4 Adding a test for a new API endpoint

TBD — see §3 Phase 1 (integration) and Phase 3 (validation template).

### 6.5 Adding an RLS test for a new migration

TBD — see §3 Phase 3 for the per-table RLS regression template.

### 6.6 Per-rollout-phase notes

(Filled in as each phase ships.)

## 7. What We Deliberately Don't Test

Exclusions agreed during the rollout (Phase 2 interview, Q5). Future
contributors should respect these unless the underlying assumption changes.

- **Static pages** (landing, index, layout) — rarely change, low blast radius, no business logic. Re-evaluate if these pages gain dynamic content or auth-gated sections. (Source: Phase 2 interview Q5.)
- **Generated types** (Supabase-generated types, Zod inferred types) — the generator is the test; snapshot-testing generated output catches nothing meaningful. Re-evaluate if custom type transforms are layered on top. (Source: Phase 2 interview Q5.)

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-06-09
- Stack versions last verified: 2026-06-09
- AI-native tool references last verified: 2026-06-09

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes,
- a deferred risk (§2) activates because its prerequisite slice shipped.
