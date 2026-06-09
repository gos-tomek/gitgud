<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Link Board to GitHub Org

- **Plan**: context/changes/link-board-to-github-org/plan.md
- **Scope**: All Phases (1–5)
- **Date**: 2026-06-01
- **Verdict**: NEEDS ATTENTION
- **Findings**: 1 critical, 4 warnings, 1 observation

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | WARNING |
| Safety & Quality    | FAIL    |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

## Findings

### F1 — Unbounded repo pagination on Cloudflare Workers

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/github/repos.ts:48-62
- **Detail**: The endpoint paginates all repos with no upper bound. A user with thousands of repos forces the Worker to accumulate all results in memory (128 MB limit). Manual entry fallback already covers repos outside the picker.
- **Fix**: Add a hard cap — break out of the pagination loop once the limit is reached.
  - Strength: One guard clause in the loop body; manual entry covers anything the picker misses.
  - Tradeoff: Users past the cap won't see all repos in the picker — acceptable given manual entry exists.
  - Confidence: HIGH — straightforward loop bound.
  - Blind spot: None significant.
- **Decision**: FIXED — capped at 200 repos via labeled outer loop break.

### F2 — Fine-grained PAT blocks user with no escape path

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/components/CreateBoardForm.tsx:100-106
- **Detail**: When a `github_pat_` prefix is detected, `handlePatChange` sets a warning status and returns without calling validate-pat. The Next button requires `status === "valid"`, so the user is permanently stuck on step 1.
- **Fix A ⭐ Recommended**: Show the warning, then still validate
- **Fix B**: Keep the block, but improve the UX
- **Decision**: FIXED via Fix B — changed status to "error" with explicit message "Fine-grained tokens are not supported. Please use a classic PAT (starts with ghp\_)." so the user clearly understands the hard block.

### F3 — Board creation silently succeeds when PAT/repo storage fails

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/boards/index.ts:46-69
- **Detail**: Board creation, PAT storage (RPC), and repo linking are three independent operations. If createBoard succeeds but set_board_github_pat fails, the response is still 201 and the user lands on a board without a PAT (unusable for sync).
- **Fix A ⭐ Recommended**: Make PAT storage failure fatal (return 500)
- **Fix B**: Delete the board if any post-creation step fails
- **Decision**: FIXED via Fix A — PAT storage failure now logs with logger.error and returns 500.

### F4 — Unplanned /api/boards/check-name endpoint

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/pages/api/boards/check-name.ts
- **Detail**: New POST endpoint for early duplicate-name detection not mentioned in the plan. Benign UX improvement but undocumented scope creep.
- **Fix**: Document as a plan addendum in the Progress section.
- **Decision**: FIXED — addendum added to plan.md Progress section.

### F5 — Pattern drift: inline Response + wrong status for missing Supabase

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/boards/index.ts, src/pages/api/boards/check-name.ts
- **Detail**: Board API routes used inline `new Response(JSON.stringify(...))` and returned 500 for missing Supabase instead of the 503 used by GitHub routes and sync.ts.
- **Fix**: Add a `json()` helper to both board routes and use 503 for missing Supabase.
- **Decision**: FIXED — json() helper added to both files; missing Supabase now returns 503.

### F6 — Missing logger.error in boards/index.ts catch-all

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/boards/index.ts:70-75
- **Detail**: The catch-all handler returned 500 without logging the error, silently swallowing unexpected exceptions.
- **Fix**: Add `logger.error("[boards]", err);` before the 500 response.
- **Decision**: FIXED — logger.error call added before the catch-all 500 return.
