<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Deferred Risk Gap Closure

- **Plan**: context/changes/deferred-risk-gap-closure/plan.md
- **Scope**: All Phases (1–3 of 3)
- **Date**: 2026-07-30
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 1 observation

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

## Findings

### F1 — Test title claims 7 child tables; only 6 are verified

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: tests/integration/board-deletion.test.ts:24
- **Detail**: The plan specified asserting zero rows across 7 child tables including `board_members`. The test asserts 6 tables. A code comment correctly explains the omission (`board_members` was dropped in `20260623110000_drop_board_members.sql`), but the test's `it()` description still reads "all 7 child tables" — a misleading claim that will confuse the next reviewer.
- **Fix**: Update the `it()` description to read "all 6 child tables" (or name them) so it matches reality.
- **Decision**: FIXED — updated it() description from "7" to "6" child tables.

### F2 — Missing vi.clearAllMocks between it.each iterations

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: tests/integration/impact-parity.test.ts:51
- **Detail**: The `it.each` loop calls `mockReturnValueOnce` twice per iteration (IC then EM). If iteration N throws after queuing the IC mock but before the handler consumes it, that unconsumed `fixture.contributor.client` value bleeds into iteration N+1. The next iteration then queues its own two mocks on top, so the parity assertion in N+1 compares IC (with contributor.client) against EM (also with contributor.client). Parity still holds — both sides are the same role — so the test passes. But a per-role access regression is now invisible: if ownerA.client ever returned different data, the bleed would mask it. A `beforeEach(() => vi.clearAllMocks())` inside the describe block eliminates the bleed and matches the guard pattern used in the `classifyThreads — subrequest budget` describe block in `classification-voting.test.ts`.
- **Fix**: Add `beforeEach(() => vi.clearAllMocks())` inside the `describe.skipIf(...)` block in `impact-parity.test.ts`.
  - Strength: Eliminates mock bleed, matches the pattern already used in sibling hermetic tests, makes each iteration fully independent.
  - Tradeoff: Clears all mocks between iterations — any mock state that needed to persist across them would be reset. Here there is no such state, so the tradeoff is nil.
  - Confidence: HIGH — the `createClient` mock is the only vi.mock in this file; nothing else in the describe depends on accumulated mock state.
  - Blind spot: None significant.
- **Decision**: SKIPPED

### F3 — afterAll manually duplicates fixture cleanup steps

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: tests/integration/board-deletion.test.ts:14
- **Detail**: `afterAll` in `board-deletion.test.ts` manually calls `cleanupBoard(fixture.ownerB.boardId)` + three `cleanupUser` calls, while `impact-parity.test.ts` (same fixture, same change) calls `fixture.cleanup()`. The manual form works correctly for the current seed shape, but if `seedTwoBoards()` adds resources to its `cleanup()` in a future phase, the board-deletion afterAll would silently miss them. The plan noted "Board A deleted by test; afterAll needs to clean up Board B and three users only" — this matches what `fixture.cleanup()` already does (Board A is deleted by the test before cleanup runs, so cleanup() calling cleanupBoard(boardAId) on an already-deleted board is a no-op).
- **Fix**: Replace the manual cleanup body with `await fixture.cleanup()`.
- **Decision**: FIXED — replaced manual afterAll cleanup with `await fixture.cleanup()`; removed unused `cleanupBoard`/`cleanupUser` imports.
