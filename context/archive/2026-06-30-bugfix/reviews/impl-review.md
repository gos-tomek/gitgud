<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Fix GitHub Sync Workflow Subrequest Crashes and Chain Ordering

- **Plan**: context/changes/bugfix/plan.md
- **Scope**: All Phases (1-3) of 3
- **Date**: 2026-07-06
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 2 observations

## Verdicts

| Dimension           | Verdict               |
| ------------------- | --------------------- |
| Plan Adherence      | PASS                  |
| Scope Discipline    | PASS                  |
| Safety & Quality    | PASS                  |
| Architecture        | PASS                  |
| Pattern Consistency | PASS (2 observations) |
| Success Criteria    | PASS                  |

## Findings

### F1 — Module-scope test constants

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: tests/hermetic/list-and-upsert-prs.test.ts:53, tests/hermetic/classification-voting.test.ts:68-78
- **Detail**: list-and-upsert-prs.test.ts declares `repo: RepoRow` at module scope; classification-voting.test.ts shares `rootComment` and `prRow` similarly. The other hermetic tests create all data inside tests or factory functions. Not a bug — these constants are never mutated — but slightly inconsistent.
- **Fix**: Move to factory functions or inside beforeEach.
- **Decision**: FIXED — moved to factory functions (`makeRepo()`, `makeRootComment()`, `makePrRow()`), called per-test.

### F2 — Inline fake-timers management

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: tests/hermetic/classification-voting.test.ts:145-163
- **Detail**: Uses try/finally inside the test body for useFakeTimers/useRealTimers, while existing tests in the codebase (e.g. tests/unit/github.test.ts) use beforeEach/afterEach. Functionally correct — the finally block guarantees cleanup — but deviates from convention.
- **Fix**: Move to nested describe with beforeEach/afterEach.
- **Decision**: FIXED — extracted into nested `describe("with frozen time", ...)` using beforeEach/afterEach, matching tests/unit/github.test.ts convention.

## Verification Results

### Phase 2 — Automated

- ✅ `tsc --noEmit` — PASS
- ✅ `npm run lint` — PASS
- ✅ `npm run build` — PASS
- ✅ `grep` (no dangling refs to removed exports) — PASS (0 hits)

### Phase 3 — Automated

- ✅ `vitest run` (4 hermetic test files) — PASS (21/21)
- ✅ `npm run test:typecheck` — PASS
- ✅ `npm run lint` — PASS
- ✅ `vitest run --exclude integration` — PASS (285/285)

## Drift Summary

All plan items: MATCH

- Phase 2: 4/4 removals confirmed, 0 unplanned removals
- Phase 3: 11/11 plan-specified test cases present
- Phase 3 scope extensions (3.6-3.7): 4 extra tests, all documented in Progress section
