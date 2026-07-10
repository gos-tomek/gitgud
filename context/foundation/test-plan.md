# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-07-10

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

| #   | Risk (failure scenario)                                                                                                                                                                                          | Impact | Likelihood | Source (evidence — not anchor)                                                                                                                                          |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Cross-board data leakage (IDOR)** — a user on Board A reads repos, contributors, or profile data belonging to Board B through API routes or direct Supabase queries                                            | High   | Medium     | Interview Q1; PRD guardrails (no hidden management-only layer, data parity NFR); hot-spot dir `src/lib/services/` (7 commits/30d)                                       |
| 2   | **GitHub PAT exposed to client** — raw or partially-masked PAT surfaces in an API response body, error message, or application log                                                                               | High   | Medium     | Interview Q1; infrastructure.md (no observability wired); hot-spot dir `src/pages/api/github/` (6 commits/30d)                                                          |
| 3   | **Board wizard state regression (mitigated — Phase 2)** — 3-step CreateBoardForm loses data between steps, allows step bypass, or submits incomplete board (missing repos or contributors)                       | Medium | High       | Interview Q3; hot-spot dir `src/components/` (6 commits/30d); archived S-02/S-03 plans (form refactored twice)                                                          |
| 4   | **Board creation partial-failure state (mitigated — Phase 2)** — POST /api/boards inserts board, stores PAT, links repos, stores contributors in sequence; partial failure leaves orphaned data with no rollback | Medium | Medium     | Archived S-02/S-03 plans (multi-step insert); hot-spot dir `src/pages/api/boards/` (4 commits/30d)                                                                      |
| 5   | **RLS policy gap on new tables** — a new migration adds a table without REVOKE ALL, missing per-operation policies, or a policy subquery that introduces recursion/bypass                                        | High   | Medium     | Lessons.md ("Always REVOKE ALL before RLS"); PRD Access Control; hot-spot dir `supabase/migrations/` (5 commits/30d)                                                    |
| 6   | **Server trusts client on API boundaries** — an API route passes unvalidated URL params, array contents, or nested objects to Supabase, allowing malformed input to corrupt data or bypass access checks         | Medium | Medium     | CLAUDE.md (Zod validation convention); hot-spot dir `src/pages/api/` (10+ commits/30d combined)                                                                         |
| 7   | **Data parity violation** — IC viewing their own profile sees different data than EM viewing the same profile, breaking the transparency invariant                                                               | High   | Medium     | `profile-raw-github-metrics` shipped 2026-06-17; `src/lib/services/impact-metrics.ts` (1146 lines, 4 self-review filter sites); PRD NFR data-parity                     |
| 8   | **Board deletion cascade incomplete** — deleting a board leaves orphaned contributors, repos, PRs, reviews, or classification data; no guard for running workflows at delete time                                | Medium | Medium     | `delete-board` shipped 2026-07-07; board DELETE at `src/pages/api/board/[boardId]/index.ts:12`; PRD FR-021                                                              |
| 9   | **Classification stores raw comment content** — the daily batch persists full comment text after classification, violating the no-retention guardrail                                                            | High   | Medium     | `classification-batch` shipped 2026-06-22; `src/worker.ts` WorkflowEntrypoint; PRD FR-012 ("no raw comment content stored after classification")                        |
| 10  | **OAuth identity mismatch** — user links the wrong GitHub account; auto-match trigger fails silently; IC sees no classified data despite being a board contributor                                               | Medium | Medium     | `link-github-account` shipped 2026-06-23; `user_profiles` identity bridge; dropped `board_members` table                                                                |
| R1  | **Workflow chain breaks silently** — a mid-chain phase (prdetails/reviews/classify) fails, and downstream phases proceed on stale or missing data with no alert                                                  | High   | High       | `bugfix` workflow overhaul 2026-07-06 (58 commits/30d); `src/worker.ts` fire-and-forget spawn pattern (`Workflow.create()` with no completion polling); user concern #1 |
| R5  | **Settings API unauthorized mutation** — non-owner renames, deletes board, or modifies repos/contributors through API routes that rely solely on RLS                                                             | High   | Medium     | `manage-ic-roster` + `expand` shipped 2026-07-07; 6 mutation endpoints; no ownership check in handler code (`src/pages/api/board/[boardId]/index.ts:30`)                |
| R8  | **Dashboard metrics silently wrong** — self-review exclusion drift, division-by-zero on empty boards, or date-range boundary errors produce incorrect numbers without visible error                              | Medium | Medium     | `src/lib/services/impact-metrics.ts` (1146 lines); division-by-zero at line 594; 4 self-review filter sites (lines 210, 233, 438, 478)                                  |

**Deferred risks** — PRD-grounded scenarios for slices not yet built. These activate when their prerequisite code ships; re-evaluate via `--refresh`.

> Risks #7–#10 promoted to active (2026-07-09) — see active table above.

| #   | Risk (failure scenario)                                                                                                                              | Impact | Likelihood | Source (evidence — not anchor)                         | Activates with           |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------- | ------------------------------------------------------ | ------------------------ |
| 11  | **PAT expiry false positive/negative** — board freezes when PAT is valid (false positive), or continues syncing with an expired PAT (false negative) | Medium | Low        | PRD FR-022; roadmap S-11 (detection mechanism unknown) | S-11 (PAT expiry freeze) |

### Risk Response Guidance

| Risk | What would prove protection                                                                                                                                                                                | Must challenge                                                                                                                                                                | Context `/10x-research` must ground                                                                                                                                         | Likely cheapest layer                                                                                                                      | Anti-pattern to avoid                                                                                      |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| #1   | User on Board A cannot SELECT/INSERT/UPDATE/DELETE rows belonging to Board B, regardless of API route                                                                                                      | "RLS is enabled" does not mean "RLS is correct" — policy expressions must be verified against actual cross-board queries, not just auth presence                              | Full RLS policy tree across all tables with board_id FK; SECURITY DEFINER helpers and search_path settings; any API route that constructs queries                           | Integration (real Supabase, two users, two boards) + E2E (Phase 8) for full browser flow confidence                                        | Testing only that the owner sees their own data (happy path) without asserting non-member is denied        |
| #2   | No API response body, error response, or log entry contains a raw PAT value                                                                                                                                | "PAT is encrypted at rest" does not mean it never appears decrypted in transit — decryption happens on every GitHub API call                                                  | All code paths that decrypt or handle raw PAT; error handling in those paths; logger configuration and output shape                                                         | Integration (call API routes, inspect response + error payloads)                                                                           | Asserting stored value is encrypted without checking transient exposure in responses and error bodies      |
| #3   | Wizard enforces step ordering, persists data across all 3 steps, final submit includes complete data from every step                                                                                       | "The form renders" does not mean the state machine works — each transition must carry data forward and validate preconditions                                                 | React state shape for the wizard; step transition triggers; data flow from wizard state to API call payload                                                                 | Component tests (vitest + testing-library) for state machine; integration for full submit + E2E (Phase 8) for full browser flow confidence | Snapshot tests that verify HTML but not behavior; testing steps in isolation without verifying transitions |
| #4   | If a mid-sequence step fails, user sees a clear error and no orphaned data persists (or cleanup runs)                                                                                                      | "Each step succeeds individually" does not mean the sequence is safe — the failure of step 3 of 4 is the interesting case                                                     | Exact operation sequence in POST /api/boards; whether any steps use transactions or have cleanup on failure                                                                 | Hermetic (stub Supabase client that fails on specific operations)                                                                          | Testing only the happy path (all steps succeed) without partial-failure scenarios                          |
| #5   | Every table has REVOKE ALL + per-operation RLS verified by running cross-user queries, not by reading the SQL text                                                                                         | "The migration file looks correct" does not mean the policies are correct in combination — interaction effects between policies on different tables can open unexpected paths | Full migration chain; SECURITY DEFINER function definitions and their search_path; policy dependency graph across tables                                                    | Integration (per table: insert as user A, verify user B cannot SELECT)                                                                     | Checking migration SQL text rather than running actual cross-user queries against a real DB                |
| #6   | Every API route rejects invalid input (missing fields, wrong types, out-of-bounds values) with a clean error, never passing raw unvalidated params to the database                                         | "Zod is imported" does not mean every field is validated — URL params and nested array contents often slip through unvalidated                                                | Each API route's validation schema; what gets passed to Supabase calls; whether URL params are validated or trusted                                                         | Unit tests for Zod schemas; integration for routes with invalid payloads                                                                   | Testing only that valid input succeeds without testing that invalid input is rejected                      |
| #7   | IC and EM calling the same impact API endpoint for the same contributor return identical data payloads                                                                                                     | "IC and EM each receive data" does not prove parity — only a field-by-field comparison of both responses confirms the invariant                                               | Impact API response schema for IC vs EM; any role-conditional field filtering in `impact-metrics.ts`; which endpoints expose per-user vs per-board data                     | Integration (same API, two roles, compare payloads)                                                                                        | Testing only that each role gets data without comparing they get the same data                             |
| #8   | Board DELETE removes all child rows (repos, PRs, reviews, comments, classifications, contributors) with zero orphaned rows in any child table                                                              | "Account deletion works" does not prove board-only deletion works — these are separate code paths                                                                             | Exact FK + CASCADE chain for board DELETE; whether `board_contributors.user_id` SET NULL applies to board-only delete; what happens to running workflows                    | Integration (delete board, verify cascade via admin client) + E2E (Phase 8) for full browser flow confidence                               | Testing only account deletion without board-only deletion                                                  |
| #9   | After classification runs, the stored `thread_classifications` row contains classification labels only — no original comment text from any source                                                          | "Classification runs successfully" does not mean "raw text wasn't stored" — the guardrail is about what persists, not that classification succeeds                            | `thread_classifications` schema (which columns exist, what gets stored vs discarded); `classification.ts` storage call; what the AI binding returns and what gets extracted | Hermetic (mock AI binding, assert stored output has labels not raw text)                                                                   | Testing classification accuracy instead of retention boundary                                              |
| #10  | After linking a GitHub account, the identity bridge trigger correctly auto-matches the GitHub login to existing `board_contributors` rows; wrong-account link does not grant access to another user's data | "OAuth redirect completes" does not mean the auto-match trigger fired correctly — the trigger operates post-link                                                              | `user_profiles` schema and identity bridge trigger; how `board_contributors.github_login` maps to `user_profiles.github_login`; the auto-match trigger definition           | Integration (create user, link GitHub, verify identity bridge)                                                                             | Testing only the OAuth redirect without verifying the auto-match trigger                                   |
| R1   | When a mid-chain phase fails, subsequent phases detect stale/missing data rather than proceeding silently; full sync trigger → data appears flow completes end-to-end                                      | "Individual sync functions succeed in isolation" does not prove chain-level failure handling — fire-and-forget spawning means failures are invisible to the orchestrator      | `step.do` failure semantics in Cloudflare Workflows; how classify dedup works across multi-repo runs; what the dispatcher does when a child workflow fails                  | Hermetic for mid-chain failure + E2E for full chain                                                                                        | Testing individual sync functions without chain-level orchestration                                        |
| R5   | A non-board-owner calling PATCH settings, DELETE board, or POST/DELETE repos/contributors endpoints receives a rejection, not a success                                                                    | "The owner can mutate" does not prove non-owners are denied — RLS-only auth needs a cross-role test                                                                           | RLS policies on `boards`, `github_repos`, `board_contributors` for mutation operations; `board_members` role column and how it maps to ownership                            | Integration (non-owner calls mutation endpoints, assert rejection) + E2E (Phase 8) for full browser flow confidence                        | Testing only that the owner can mutate without testing that non-owner is denied                            |
| R8   | Edge-case fixtures (zero-PR board, self-review-only period, single-PR compute) return correct values; self-review exclusion is consistent across all 4 filter sites                                        | "Normal data produces correct metrics" does not catch division-by-zero or filter drift — edge cases require explicit fixture data                                             | `threadsPerReviewedPr` computation path; which of the 4 self-review filter sites can diverge; date-range boundary comparison logic                                          | Unit/hermetic (fixture data with edge cases)                                                                                               | Testing only with "normal" data volumes without zero-PR or self-review-only scenarios                      |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| #   | Phase name                        | Goal (one line)                                                                                                                                                  | Risks covered   | Test types                                                      | Status                                          | Change folder                                               |
| --- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | --------------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------- |
| 1   | Bootstrap + access boundary       | Install test runner; prove cross-board isolation and PAT non-leakage with real DB tests                                                                          | #1, #2, #5      | integration (real Supabase)                                     | shipped                                         | context/archive/2026-06-09-testing-access-boundary/         |
| 2   | Board creation contract           | Prove wizard state machine and API orchestration handle happy + failure paths                                                                                    | #3, #4          | component (vitest + testing-library), hermetic (stubbed client) | shipped                                         | context/archive/2026-06-10-board-creation-contract/         |
| 3   | Validation + data layer templates | RLS regression template for new tables; validation test template for API routes                                                                                  | #5, #6          | integration (RLS per-table), unit (Zod schemas)                 | skipped — covered by Phase 1 + Phase 2 patterns | context/archive/2026-06-14-validation-data-layer-templates/ |
| 4   | Quality gates                     | Wire vitest into CI; set minimum signal floor; update project conventions                                                                                        | cross-cutting   | CI gates                                                        | shipped                                         | context/archive/2026-06-14-quality-gates/                   |
| 5   | Deferred risk gap closure         | Close coverage gaps in activated deferred risks: IC-vs-EM parity assertion, board-only deletion cascade, classification content retention, OAuth identity bridge | #7, #8, #9, #10 | integration, hermetic                                           | not started                                     | —                                                           |
| 6   | New risk surfaces                 | Cover workflow chain mid-failure recovery, settings API auth boundaries, metric correctness edge cases                                                           | R1, R5, R8      | hermetic, integration, unit                                     | not started                                     | —                                                           |
| 7   | E2E workflow chain                | Prove manual sync trigger → data appears flow via Playwright against deployed Cloudflare preview                                                                 | R1              | e2e (Playwright)                                                | not started                                     | —                                                           |
| 8   | E2E core user flows               | Board lifecycle E2E: signup → create board → verify on dashboard → add/change/remove contributor → delete board → verify gone; non-owner denied                  | #3, #8, R5, #1  | e2e (Playwright)                                                | not started                                     | —                                                           |

> Phase 5 was originally 'Slice-ready contracts' — retired 2026-07-09 because organic test coverage was added alongside feature slices. Remaining gaps are now addressed by Phases 5–8 above.

## 4. Stack

Test-base profile: **meaningful** — 32 test files (6 unit, 6 component, 14 hermetic, 6 integration) + 5 helpers.

| Layer              | Tool                              | Version | Notes                                                                                        |
| ------------------ | --------------------------------- | ------- | -------------------------------------------------------------------------------------------- |
| unit + integration | Vitest                            | ^4.1.8  | Installed; Astro 6 / TypeScript / Vite ecosystem                                             |
| component          | @testing-library/react            | ^16.3.2 | Installed; happy-dom for DOM environment per test file                                       |
| API mocking        | vi.mock / vi.hoisted pattern      | —       | See §6.3; stubbed Supabase client for hermetic tests                                         |
| e2e                | Playwright — planned (Phases 7–8) | ^1.61.1 | In devDependencies; Phase 7 (sync chain, deployed preview), Phase 8 (core user flows, local) |
| accessibility      | none yet                          | —       | Not in rollout scope                                                                         |

**Stack grounding tools (current session):**

- Docs: Context7 — available; Astro 6 and Vitest docs accessible; checked: 2026-07-09
- Search: Exa.ai — available; can verify current tool support and APIs; checked: 2026-07-09
- Runtime/browser: Playwright MCP — available in current session; checked: 2026-07-09
- Provider/platform: Cloudflare MCP — available (docs/search/execute); relevant for Workers-specific test setup; checked: 2026-07-09

## 5. Quality Gates

| Gate                           | Where                                                                                                     | Required?        | Catches                                                                                  |
| ------------------------------ | --------------------------------------------------------------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------- |
| lint + typecheck (src + tests) | pre-commit (lefthook) + CI (`validate`, `pre-deploy-tests`)                                               | required (wired) | syntactic / type drift — including test-file narrowing errors (`tsc` ×2: src + tests)    |
| build                          | CI (`validate`, `deploy-production`)                                                                      | required (wired) | SSR compilation, import resolution                                                       |
| unit + integration tests       | local (lefthook: non-integration) + CI `validate` (non-integration) + CI `test-integration` (integration) | required (wired) | logic regressions, access boundary violations                                            |
| component + hermetic tests     | local (lefthook) + CI (`validate`)                                                                        | required (wired) | wizard state machine regressions, hermetic API contract drift                            |
| pre-commit (lefthook)          | local                                                                                                     | required (wired) | eslint --fix + prettier (staged files), `tsc` ×2 (src + tests), vitest (non-integration) |

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
beforeAll(async () => {
  fixture = await seedTwoBoards();
});
afterAll(async () => {
  await fixture.cleanup();
});
```

#### RLS denial assertion patterns

RLS denials behave differently per operation — assert the correct shape:

| Operation | RLS behavior                                                                 | Assertion                                                                                |
| --------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| SELECT    | USING clause filters silently — denied reads return an empty array, no error | `expect(error).toBeNull(); expect(data).toEqual([]);`                                    |
| INSERT    | WITH CHECK failure → PostgreSQL error code `42501`                           | `expect(error?.code).toBe("42501");`                                                     |
| UPDATE    | USING clause match returns 0 rows — silently a no-op                         | Read via admin before + after; `expect(after?.field).toBe(before?.field)`                |
| DELETE    | USING clause match returns 0 rows — silently a no-op                         | Read via admin after; `expect(data).toHaveLength(N)` where N is expected surviving count |

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

**Reference implementation**: `tests/component/CreateBoardForm.test.tsx`

#### Per-file environment override

Component tests render into a DOM; integration and hermetic tests don't and stay faster without one. Override Vitest's default Node environment per file with a docblock as the very first line:

```ts
// @vitest-environment happy-dom
```

#### Mocking `fetch`

React islands call API routes via `fetch`, not the Supabase client. Stub `globalThis.fetch` with `vi.stubGlobal` and dispatch on the request URL:

```ts
const fetchMock = vi.fn((input: string, _init?: RequestInit): Response => {
  switch (input) {
    case "/api/github/validate-pat":
      return jsonResponse({ login: "octocat", avatarUrl: "..." });
    case "/api/boards/check-name":
      return new Response(null, { status: 204 });
    default:
      throw new Error(`Unhandled fetch to ${input}`);
  }
});
vi.stubGlobal("fetch", fetchMock);
```

Throwing on an unhandled URL surfaces a missing mock case immediately, instead of failing later with a confusing `undefined` error.

#### Mocking `window.location`

Components that redirect on success (`window.location.href = ...`) need `location` stubbed — happy-dom throws on real navigation:

```ts
beforeEach(() => {
  vi.stubGlobal("location", { href: "" });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
```

Assert the redirect by reading `window.location.href` after the triggering action.

#### Debounced inputs

For inputs with a debounce (e.g. PAT validation at 500ms), prefer `waitFor` over fake timers — `userEvent` relies on real timers internally, and mixing it with `vi.useFakeTimers()` is fragile:

```ts
await user.type(screen.getByLabelText(/GitHub Personal Access Token/i), PAT);
await waitFor(() => expect(screen.getByText(/Connected as/i)).toBeInTheDocument(), { timeout: 2000 });
```

#### `userEvent.setup()`

Always create an instance with `userEvent.setup()` and use it for every interaction — do not call `userEvent.click()` etc. as bare static methods:

```ts
const user = userEvent.setup();
await user.click(screen.getByRole("button", { name: /next/i }));
```

#### Accessible queries

Query by role, label, and visible text — `getByRole`, `getByLabelText`, `getByText`, `findByText`. Never assert on class names or test IDs. To find a checkbox inside a `<label>` by its visible text, locate the text node and scope with `within`:

```ts
const label = screen.getByText(fullName).closest("label");
await user.click(within(label!).getByRole("checkbox"));
```

### 6.3 Adding a hermetic API test (stubbed Supabase client)

**Reference implementation**: `tests/hermetic/board-creation.test.ts`

Hermetic tests run in the default Node environment (no `@vitest-environment` override) and call the API route's exported handler (`POST`, `GET`, ...) directly as a plain async function — no Astro middleware involved.

#### `vi.hoisted()` for mock variables

`vi.mock()` calls are hoisted above all other code by Vitest's transform. Any variable a mock factory references must be declared with `vi.hoisted()`, or it's `undefined`/`ReferenceError` when the factory runs:

```ts
const mockSupabase = vi.hoisted(() => ({
  auth: { getUser: vi.fn() },
  rpc: vi.fn(),
  from: vi.fn(),
}));
vi.mock("@/lib/supabase", () => ({ createClient: vi.fn(() => mockSupabase) }));
```

#### Mocking `astro:env/server` and service modules

`astro:env/server` is a virtual module — Vitest cannot resolve it without an explicit factory. Mock it alongside any `@/lib/services/*` modules the handler imports:

```ts
vi.mock("astro:env/server", () => ({
  GITHUB_TOKEN_ENCRYPTION_KEY: "test-encryption-key",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_KEY: "test-supabase-key",
}));
```

#### Re-declaring error classes for `instanceof` checks

If the handler does `instanceof` against an error class exported by a mocked module, re-declare that class inside the same `vi.hoisted()` block — the handler's imported reference and the thrown instance must share a constructor:

```ts
const mockBoardServices = vi.hoisted(() => ({
  createBoard: vi.fn(),
  BoardNameTakenError: class BoardNameTakenError extends Error {
    constructor() {
      super("You already have a board with that name");
      this.name = "BoardNameTakenError";
    }
  },
}));
vi.mock("@/lib/services/boards", () => mockBoardServices);
```

#### Fluent chain mocking with table-name dispatch

`supabase.from(table)` returns a different chain shape per table. Dispatch on the table name inside `mockImplementation`, throwing on any table the test doesn't expect:

```ts
mockSupabase.from.mockImplementation((table: string) => {
  if (table === "github_repos") return { insert: mockRepoInsert };
  if (table === "boards") return { delete: vi.fn(() => ({ eq: mockDeleteEq })) };
  throw new Error(`Unexpected table: ${table}`);
});
```

#### `makeContext` helper

Build the minimal `APIContext` the handler needs from a real `Request`:

```ts
function makeContext(body: unknown): APIContext {
  const request = new Request("http://localhost/api/boards", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { request, cookies: {} } as unknown as APIContext;
}
```

#### `beforeEach` reset and happy-path defaults

Call `vi.clearAllMocks()` then reconfigure every dependency to its happy-path return value, so each test only needs to override the one step it's exercising with `mockResolvedValueOnce` / `mockRejectedValueOnce`.

#### Documenting known defects

When a test asserts current (buggy) behavior rather than desired behavior, add an inline `// Known defect ...` comment naming it — so a future fix to the production code is recognized as a deliberate behavior change, not a test regression.

### 6.4 Adding a unit test (Zod schema / pure function)

**Reference implementation**: `tests/hermetic/board-creation.test.ts:118-135`

Phase 3 (validation templates) was skipped — all 7 API routes already follow an identical
`safeParse → 400` Zod wiring (see `context/changes/validation-data-layer-templates/research.md`).
The hermetic test above is the validation template: an `it.each` over `[fieldName, mutatedBody,
expectedMessage]` asserting 400 status, the Zod error message, and no downstream side-effect call.
Copy this pattern for new routes. A dedicated pure-Zod unit-test layer is only worth adding if a
future schema introduces `.refine()` or `.transform()` with custom logic.

### 6.5 Adding a test for a new API endpoint

TBD — see §3 Phase 1 (integration) and §6.4 (validation template).

### 6.6 Adding an RLS test for a new migration

**Reference implementation**: `tests/integration/access-boundary.test.ts`

Phase 3 (RLS regression template) was skipped — §6.1 already documents the full pattern with
per-operation RLS denial assertion shapes (see `context/changes/validation-data-layer-templates/research.md`).
For a new table: add seed data to `seedTwoBoards()` (`tests/helpers/seed.ts`), then copy one test
per policy-defined operation (SELECT/INSERT/UPDATE/DELETE) from `access-boundary.test.ts`, swapping
the table name and columns. Follow the assertion shapes in §6.1's "RLS denial assertion patterns"
table for the operation(s) the new table's policies define.

### 6.7 Per-rollout-phase notes

Organically added test files through Phase 4 — cross-referenced to the cookbook pattern each follows.

#### §6.1 Integration (6 files)

- `tests/integration/access-boundary.test.ts` — two-client RLS isolation for cross-board IDOR (#1, #5); reference implementation for §6.1 and §6.6.
- `tests/integration/pat-leak.test.ts` — dev server output capture verifying no raw PAT appears in API responses (#2); reference for the server output capture pattern in §6.1.
- `tests/integration/smoke.test.ts` — connectivity guard; confirms local Supabase is reachable before other integration suites run.
- `tests/integration/impact-access.test.ts` — IC and EM role authentication against a real Supabase instance; groundwork for IC-vs-EM parity assertion (#7; comparative assertion gap remains for Phase 5).
- `tests/integration/board-settings.test.ts` — owner vs. non-owner mutation RLS for rename/delete/repo/contributor endpoints (R5).
- `tests/integration/account-deletion.test.ts` — full deletion cascade via admin client; verifies no orphaned child rows after user account delete (#8).

#### §6.2 Component (6 files)

- `tests/component/CreateBoardForm.test.tsx` — 3-step wizard state machine, step transitions, and full submit (#3, #4); reference implementation for §6.2.
- `tests/component/ChangePasswordForm.test.tsx` — password change form interactions and error states.
- `tests/component/DeleteAccountDialog.test.tsx` — account deletion confirmation dialog, destructive-action guard (#8).
- `tests/component/PatUpdateForm.test.tsx` — PAT update form; live validation debounce and masked display (#2).
- `tests/component/SignUpForm.test.tsx` — signup form interactions and client-side validation.
- `tests/component/impact.test.tsx` — impact view components: period selector, KPI card rendering, contributor selector (#7, R8).

#### §6.3 Hermetic (14 files)

- `tests/hermetic/board-creation.test.ts` — board creation API route with stubbed Supabase; reference implementation for §6.3 and §6.4 validation template.
- `tests/hermetic/validate-pat.test.ts` — PAT validation endpoint with mocked GitHub client (#2).
- `tests/hermetic/github-pat-fallback.test.ts` — PAT fallback behavior when primary token expires or fails (#2).
- `tests/hermetic/profile-pat.test.ts` — profile PAT update handler; encryption and storage (#2).
- `tests/hermetic/profile-password.test.ts` — password change handler; success, wrong-password, and weak-password paths.
- `tests/hermetic/delete-account.test.ts` — account deletion API handler; admin-client cascade and auth.admin.deleteUser call (#8).
- `tests/hermetic/board-settings.test.tsx` — board name editor, repo manager, and contributor manager UI components (R5).
- `tests/hermetic/impact-api.test.ts` — impact metrics API handler; route validation and service delegation (#7).
- `tests/hermetic/impact-metrics.test.ts` — impact-metrics service: self-review exclusion, division-by-zero, and date-range boundary fixtures (R8).
- `tests/hermetic/sync-pr-batch.test.ts` — PR sync batch service with mocked Octokit and Supabase; partial-failure path (R1).
- `tests/hermetic/sync-review-comments.test.ts` — review comment sync with mocked clients; stale-data and retry behavior (R1).
- `tests/hermetic/list-and-upsert-prs.test.ts` — PR list-and-upsert service; upsert idempotency and GitHub pagination (R1).
- `tests/hermetic/threads-api.test.ts` — classification threads API handler; filters and response shape (#9).
- `tests/hermetic/classification-voting.test.ts` — classification service: AI binding mock verifying stored output contains labels only, not raw comment text (#9).

#### §6.4 Unit (6 files)

- `tests/unit/wizard-reducer.test.ts` — board wizard state reducer; step transitions and validation preconditions (#3, #4).
- `tests/unit/classification.test.ts` — classification label logic and dedup rules (#9).
- `tests/unit/date-range.test.ts` — period slug parsing and validation; boundary and edge-case coverage for date-range logic (R8).
- `tests/unit/github.test.ts` — GitHub utility functions; URL parsing and identifier normalization.
- `tests/unit/logger.test.ts` — logger module; consola wrapper behavior.
- `tests/unit/token-status.test.ts` — PAT token status helper; expiry detection and warning thresholds (#2).

## 7. What We Deliberately Don't Test

Exclusions agreed during the rollout (Phase 2 interview, Q5). Future
contributors should respect these unless the underlying assumption changes.

- **Static pages** (landing, index, layout) — rarely change, low blast radius, no business logic. Re-evaluate if these pages gain dynamic content or auth-gated sections. (Source: Phase 2 interview Q5.) Note: homepage (`src/pages/index.astro`) now includes dynamic stats via `get_homepage_stats` RPC — re-evaluate if stats accuracy becomes a risk.
- **Generated types** (Supabase-generated types, Zod inferred types) — the generator is the test; snapshot-testing generated output catches nothing meaningful. Re-evaluate if custom type transforms are layered on top. (Source: Phase 2 interview Q5.)

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-07-09
- Stack versions last verified: 2026-07-09
- AI-native tool references last verified: 2026-07-09

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes,
- a deferred risk (§2) activates because its prerequisite slice shipped.
