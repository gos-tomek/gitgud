<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Test Fix Gaps

- **Plan**: context/changes/test-fix-gaps/plan.md
- **Scope**: All 9 phases (full plan review)
- **Date**: 2026-06-14
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical · 5 warnings · 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Automated Verification Results

| Check | Result |
|-------|--------|
| `npm run lint` | PASS |
| `npm run build` | PASS |
| Unit + hermetic + component tests (52 tests) | PASS |
| Integration tests (require Supabase) | Not run |
| No "Known defect"/"Known bug" markers in tests | PASS |
| No dead code (`createBoard`/`addBoardContributors`/`BoardNameTakenError`) in src/ | PASS |

## Triage Outcome (2026-06-14)

All 7 findings triaged. F2 and F4 fixed in code (with new regression tests); F1, F5 risk-accepted and documented in plan.md; F6 documented as plan addenda; F7 documented via SQL comment; F3 skipped.

| Finding | Decision |
|---------|----------|
| F1 — DROP FUNCTION expand/contract | ACCEPTED (Fix A) — documented in plan.md |
| F2 — Logger redaction skips positional args | FIXED — `src/lib/logger.ts` + `tests/unit/logger.test.ts` |
| F3 — REVOKE ALL over-grants UPDATE | SKIPPED |
| F4 — POST /api/boards missing try/catch | FIXED — `src/pages/api/boards/index.ts` + `tests/hermetic/board-creation.test.ts` |
| F5 — Three-PR strategy collapsed to one branch | ACCEPTED (Fix A) — documented in plan.md |
| F6 — Unplanned tsc fixes | FIXED — documented in plan.md `## Addenda` |
| F7 — plpgsql NULL/empty input guards | FIXED (documented) — SQL header comment |

Post-fix verification: `npm run lint` PASS, `npm run build` PASS, unit+hermetic+component tests 55/55 PASS (3 new regression tests added).

## Findings

### F1 — DROP FUNCTION violates expand/contract rule

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260611120000_create_board_atomic.sql:62
- **Detail**: CLAUDE.md states: "Destructive DROP/ALTER must lag one release behind the code that stops using the column, because wrangler rollback reverts only the Worker — the DB schema does not roll back with it." The migration drops `set_board_github_pat` in the same release as the code that stops using it. If the Worker is rolled back, the old POST /api/boards handler calls `set_board_github_pat` which no longer exists — board creation breaks entirely. The plan acknowledged this ("safe because the only production caller is updated in the same PR") but this contradicts the project's own convention.
- **Fix A ⭐ Recommended**: Accept the risk and document it
  - Strength: The function is only called by POST /api/boards (verified in research). A rollback would already break board creation because the old handler shape no longer matches the RPC signature. Keeping the old function alongside `create_board_atomic` adds maintenance debt for a rollback path that doesn't restore full functionality anyway.
  - Tradeoff: Formally violates the expand/contract convention.
  - Confidence: HIGH — function caller analysis is thorough.
  - Blind spot: If a Supabase Edge Function or external cron calls `set_board_github_pat` outside this repo.
- **Fix B**: Split DROP into a follow-up migration
  - Strength: Strict expand/contract compliance. Rollback-safe.
  - Tradeoff: Dead function lingers for one release. Requires a follow-up change to clean it up.
  - Confidence: MEDIUM — the one-release lag adds coordination cost for a function with a single verified caller.
  - Blind spot: None significant.
- **Decision**: ACCEPTED (Fix A) — risk documented in plan.md Migration Notes § Database migrations

### F2 — Logger redaction skips positional args

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/logger.ts:19-21
- **Detail**: The `wrap()` function only redacts the first `message` argument. The `...args` rest parameters pass through to consola unredacted. A caller like `logger.error("Failed", someToken)` would log the token in cleartext. Current callers pass structured objects as second args (`{boardName, userId, pgCode}`), but a future caller could pass a PAT string positionally.
- **Fix**: Apply `redact()` to string args in `...args`: change `consola[method](redact(message), ...args)` to `consola[method](redact(message), ...args.map(a => typeof a === "string" ? redact(a) : a))`.
- **Decision**: FIXED — `src/lib/logger.ts:20` now maps `redact` over `...args` (redact() is a no-op on non-strings, so it covers both cases). Added regression tests in `tests/unit/logger.test.ts`.

### F3 — REVOKE ALL over-grants UPDATE on immutable tables

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260614120000_revoke_all_hardening.sql:19-24
- **Detail**: The migration grants `SELECT, INSERT, UPDATE, DELETE` uniformly on all 7 tables. `board_members` and `board_contributors` have no UPDATE RLS policy — these are immutable/append-only tables. RLS blocks UPDATE in practice (no policy = deny all), but granting UPDATE table-level privilege violates least-privilege. If someone later disables RLS or adds a permissive UPDATE policy by mistake, these tables become writable.
- **Fix**: For `board_members` and `board_contributors`, change the GRANT to `GRANT SELECT, INSERT, DELETE` (omit UPDATE).
- **Decision**: SKIPPED

### F4 — POST /api/boards missing try/catch

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/boards/index.ts:58-84
- **Detail**: Sibling API routes (`/api/github/sync`, `/api/github/validate-pat`, `/api/github/repos`, `/api/github/collaborators`) all wrap their core logic in `try/catch` and return a JSON 500 on unexpected errors. The refactored POST handler only checks `result.error` (the Supabase error envelope) but does not catch exceptions from `supabase.rpc()` itself (e.g., network timeout). An unhandled throw would produce a raw 500 with no JSON body.
- **Fix**: Wrap the rpc call in `try/catch`, consistent with sibling routes. The catch block logs via `logger.error` and returns `json({ error: "Board creation failed..." }, 500)`.
- **Decision**: FIXED — `src/pages/api/boards/index.ts:58-89` now wraps the rpc call + result handling in try/catch, matching sibling routes. Added hermetic test "rpc throws ... returns 500" in `tests/hermetic/board-creation.test.ts`.

### F5 — Three-PR strategy collapsed to one branch

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Scope Discipline
- **Location**: N/A (branch strategy)
- **Detail**: The plan specified three independent PRs on three branches: `change/test-fix-gaps-api` (phases 1–4), `change/test-fix-gaps-wizard` (phases 5–7), and `change/test-fix-gaps-infra` (phases 8–9). All 9 phases (14 commits) landed on the single branch `change/test-fix-gaps-api`.
- **Fix A ⭐ Recommended**: Ship as one PR, document the deviation
  - Strength: All work is complete and tested. Splitting now would be cherry-pick surgery on 14 interdependent commits with shared plan.md updates.
  - Tradeoff: Larger review surface. Rollback is all-or-nothing.
  - Confidence: HIGH — the phases are logically independent but the commits interleave plan.md progress updates.
  - Blind spot: None significant.
- **Fix B**: Cherry-pick into separate branches
  - Strength: Matches original plan. Smaller PRs are easier to review and safer to rollback individually.
  - Tradeoff: Significant effort to separate 14 commits with interleaved meta-file updates. Risk of introducing errors during the split.
  - Confidence: LOW — the commit history isn't cleanly separated by PR scope.
  - Blind spot: None significant.
- **Decision**: ACCEPTED (Fix A) — deviation documented in plan.md § Implementation Approach. Ships as a single PR from `change/test-fix-gaps-api`.

### F6 — Unplanned tsc fixes in astro.config.mjs and github-sync.ts

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: astro.config.mjs, src/lib/services/github-sync.ts
- **Detail**: Two files not in the plan were changed. `astro.config.mjs`: replaced `sessionDrivers.null()` with `{ entrypoint: "unstorage/drivers/null" }` (Astro 6.3.7 API change). `github-sync.ts`: added missing `errors: []` to an early-return `SyncResult`. Both were pre-existing tsc errors that blocked the edit hook. Documented in commit `b40258c`.
- **Fix**: Document these as addenda in the plan. They are justified.
- **Decision**: FIXED — added `## Addenda` section to plan.md documenting both unplanned tsc fixes and their justification.

### F7 — plpgsql function lacks NULL/empty input guards

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260611120000_create_board_atomic.sql:28-45
- **Detail**: `create_board_atomic` accepts `p_name` and `p_raw_token` without NULL/empty checks. If called directly (bypassing API Zod validation), a board could be created with NULL name and no PAT. Similarly, `jsonb_array_length(NULL)` returns NULL — the IF guards silently skip repo/contributor inserts on NULL input. Safe in practice: the API endpoint validates before calling the RPC, and the function is only granted to `authenticated`.
- **Fix**: Optional defense-in-depth: add `RAISE EXCEPTION` guards for NULL/empty `p_name` and `p_raw_token`. Or document the API-layer-validates assumption.
- **Decision**: FIXED (documented, not RAISE EXCEPTION guards) — added a header comment to `supabase/migrations/20260611120000_create_board_atomic.sql` explaining the API-layer-validates assumption and the intentional NULL handling of `jsonb_array_length`.
