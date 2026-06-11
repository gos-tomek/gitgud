<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Board Creation Contract

- **Plan**: context/changes/board-creation-contract/plan.md
- **Scope**: All Phases (1-4 of 4)
- **Date**: 2026-06-11
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — Cross-change file committed on this branch

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: context/changes/testing-access-boundary/reviews/impl-review.md
- **Detail**: This file belongs to the testing-access-boundary change, not board-creation-contract. It was committed on this branch (likely during a prior session) and will appear in the PR diff, polluting the change's scope boundary.
- **Fix**: Leave as-is — the file is harmless context metadata. Splitting it to a separate commit/branch is more churn than value at this point.
- **Decision**: ACCEPTED — left as-is, harmless cross-change metadata.

### F2 — jest-dom setup loaded globally for all test environments

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: vitest.config.ts:17
- **Detail**: setupFiles: ["tests/setup-dom.ts"] runs for all test files including hermetic (Node) and integration (Node) tests that don't need DOM matchers. Currently harmless — jest-dom's vitest setup only extends expect and has no DOM side effects. Worth noting for future awareness if the test suite grows.
- **Fix**: Accept as-is or scope setup to component tests via Vitest's environmentMatchGlobs.
- **Decision**: FIXED — removed global `setupFiles` from vitest.config.ts; moved `import "@testing-library/jest-dom/vitest"` directly into tests/component/CreateBoardForm.test.tsx; deleted now-unused tests/setup-dom.ts.

### F3 — Fetch mock returns synchronous Response

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: tests/component/CreateBoardForm.test.tsx:42
- **Detail**: The fetch mock returns a Response object directly instead of Promise&lt;Response&gt;. Works because awaiting a non-Promise resolves immediately, and tests use waitFor for timing. All 9 component tests pass. If future component logic depends on async timing (loading spinners, race conditions), this mock would not exercise those paths.
- **Fix**: Wrap return values in Promise.resolve() for more faithful simulation.
- **Decision**: FIXED — fetchMock return type changed to `Promise<Response>` and each branch now returns `Promise.resolve(...)`.

### F4 — Explicit vitest imports vs globals convention

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: tests/hermetic/board-creation.test.ts:1
- **Detail**: New test files explicitly import {describe, it, expect, vi} from "vitest", while existing integration tests rely on globals: true. Both approaches work; explicit imports are more defensive. Minor inconsistency — not blocking.
- **Fix**: Align to one convention project-wide (either direction).
- **Decision**: SKIPPED — both styles work; not worth a project-wide pass now.

## Verification Results

| Check | Result |
|-------|--------|
| npm test | ✅ 5 files, 70 tests passed |
| npm run lint | ✅ clean |
| npx tsc --noEmit -p tests/tsconfig.json | ✅ clean |

## Triage (2026-06-11)

All 4 findings triaged. F1 accepted as-is; F2 and F3 fixed (re-verified: `npm test` 5/5 files, 70/70 tests; `npm run lint` clean); F4 skipped.
