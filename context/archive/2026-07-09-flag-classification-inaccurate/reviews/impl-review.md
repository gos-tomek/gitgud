<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Thread Classification Voting

- **Plan**: context/changes/flag-classification-inaccurate/plan.md
- **Scope**: Phases 1–4 of 4 (full plan)
- **Date**: 2026-07-10
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 2 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | WARNING |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

## Findings

### F1 — Unplanned update to `get_board_started_root_comments_for_commenter`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: supabase/migrations/20260709120000_thread_classification_vote.sql:253
- **Detail**: Phase 4 lists two RPCs for metrics exclusion: `get_board_classifications_for_commenter` and `get_homepage_stats`. The implementation also updates `get_board_started_root_comments_for_commenter` to add `AND (tc.vote IS DISTINCT FROM false)` via a LEFT JOIN to `thread_classifications`. This function returns the denominator for thread-coverage % — without this update, the denominator would still count excluded threads while the numerator would not, producing incorrect coverage percentages.
- **Fix**: Document in the plan as an addendum to Phase 4. The change is logically necessary and correctly implemented.
- **Decision**: FIXED — added addendum to Phase 4 in plan.md documenting the `get_board_started_root_comments_for_commenter` update.

### F2 — Vote filter label "All cross-checks" vs planned "All signals"

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/components/threads/ThreadsView.tsx:513
- **Detail**: The plan specified the vote filter default label as "All signals". The implementation uses "All cross-checks" instead. The column header is also "Cross-check" rather than "Vote". This is a cosmetic naming decision — functionally identical.
- **Fix**: No action needed unless the "signals" terminology is preferred for user-facing consistency.
- **Decision**: SKIPPED — "Cross-checks" is the preferred UI label.

### F3 — Unused `login` path parameter in vote endpoint

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/board/[boardId]/threads/[login]/[threadId]/vote.ts:13-34
- **Detail**: The `login` path parameter is validated by `paramsSchema` (line 13) but never used — only `boardId` and `threadId` are destructured (line 34). Authorization is correctly handled by `getBoardWithRole` + the RPC's `is_board_member` check. This is consistent with the plan's intent ("any role is allowed"). The `login` exists in the URL for routing hierarchy consistency with the companion `threads/[login].ts` endpoint — it's dead validation, not an authorization gap.
- **Fix**: No action needed. The validation is harmless and the URL structure matches the parent resource hierarchy.
- **Decision**: SKIPPED — harmless dead validation; URL hierarchy intentionally matches `threads/[login].ts`.

## Automated Verification Results

| Check                                             | Result                  |
| ------------------------------------------------- | ----------------------- |
| `npx tsc --noEmit` (src)                          | ✅ Pass                 |
| `npm run test:typecheck` (tests)                  | ✅ Pass                 |
| `npm run lint`                                    | ✅ Pass                 |
| `npx vitest run --exclude 'tests/integration/**'` | ✅ Pass — 313/313 tests |
