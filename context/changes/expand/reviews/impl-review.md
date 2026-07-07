<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Contract Phase — Drop Dead PAT Column, RPC & Tighten board_contributors Grants

- **Plan**: context/changes/expand/plan.md
- **Scope**: Phase 1 of 1
- **Date**: 2026-07-07
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 1 warning, 0 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

## Findings

### F1 — REVOKE missing anon role

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260707120000_contract_drop_board_pat.sql:13
- **Detail**: Line 13 revokes from `authenticated` only, but the project convention (lessons.md rule + 20260614120000_revoke_all_hardening.sql) is to always REVOKE from both `anon` and `authenticated`. While `board_contributors` likely has no `anon` grants today (the hardening migration only granted to `authenticated`), the defensive pattern prevents future drift from leaving an unexpected gap.
- **Fix**: Change line 13 to `REVOKE ALL ON public.board_contributors FROM anon, authenticated;`
  - Strength: Matches the established pattern in 20260614120000 and the lessons.md rule exactly.
  - Tradeoff: None — purely defensive, no behavioral change.
  - Confidence: HIGH — identical pattern used in the hardening migration.
  - Blind spot: None significant.
- **Decision**: FIXED
