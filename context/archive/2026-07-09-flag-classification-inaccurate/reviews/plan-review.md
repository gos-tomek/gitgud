<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Thread Classification Voting Implementation

- **Plan**: context/changes/flag-classification-inaccurate/plan.md
- **Mode**: Deep
- **Date**: 2026-07-09
- **Verdict**: SOUND
- **Findings**: 1 critical, 1 warning, 0 observations

## Verdicts

| Dimension             | Verdict |
| --------------------- | ------- |
| End-State Alignment   | PASS    |
| Lean Execution        | PASS    |
| Architectural Fitness | PASS    |
| Blind Spots           | PASS    |
| Plan Completeness     | WARNING |

## Grounding

7/7 paths ✓, 6/6 symbols ✓, brief↔plan ✓

## Findings

### F1 — CREATE OR REPLACE cannot add parameter to existing RPCs

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2, Change 2
- **Detail**: The plan says to use `CREATE OR REPLACE` on `get_board_classified_threads` and `get_board_classified_threads_count` to add a `p_vote text` parameter with a default. In PostgreSQL, `CREATE OR REPLACE FUNCTION` only replaces the body of a function with the exact same argument types. Adding a new parameter creates a new function overload. If the new overload has a default for the added param, PostgreSQL cannot disambiguate calls that omit it — callers hit "function is not unique" errors. The codebase already uses DROP + CREATE for signature changes: `20260624200000_classified_threads_paginate_before_message_count.sql:14-16` drops the old signature before creating the new one.
- **Fix**: Use `DROP FUNCTION` (with full old signature) then `CREATE FUNCTION` (with the new `p_vote text DEFAULT NULL` param) for both `get_board_classified_threads` and `get_board_classified_threads_count`. Update the REVOKE/GRANT statements to include the new parameter in the signature.
- **Decision**: FIXED — plan updated to use DROP + CREATE pattern with REVOKE/GRANT on new signature.

### F2 — colSpan and header alignment not addressed

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3, Change 1
- **Detail**: ThreadRow's expanded discussion row uses `colSpan={6}` at `ThreadsView.tsx:307`. Adding the 7th vote column means this must become `colSpan={7}`, otherwise the expanded content won't span the full table width. The plan's Phase 3 changes list the new `<th>` and `<td>` but don't mention updating the expansion row's colSpan. The corresponding progress item (3.10 — "Table responsive on narrow screens") doesn't cover column-count alignment either.
- **Fix**: Add to Phase 3 Change 1: "Update `colSpan={6}` to `colSpan={7}` on the expanded discussion row." Add progress item "3.11 Table header aligns with 7th column" to match the success criterion.
- **Decision**: FIXED (differently) — Date column replaced by Vote column instead of adding a 7th column. Date moved as secondary text into the comment cell. Table stays at 6 columns; colSpan={6} unchanged.
