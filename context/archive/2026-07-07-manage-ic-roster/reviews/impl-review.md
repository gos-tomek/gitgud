<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Board Settings Management

- **Plan**: context/changes/manage-ic-roster/plan.md
- **Scope**: All Phases (1–4)
- **Date**: 2026-07-07
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 1 observation

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

### F1 — Migration skips REVOKE ALL before GRANT

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260708120000_regrant_board_contributors_delete.sql:5
- **Detail**: The migration issues a bare `GRANT DELETE` without a preceding `REVOKE ALL`. The project's lessons.md rule states: "Always REVOKE ALL before relying on RLS." The plan explicitly called for "additive grant only, no REVOKE" — so this matches the plan, but the plan itself conflicts with the established lesson. If a future migration is inserted between 20260707 and 20260708, the assumed grant baseline (SELECT+INSERT only) could be wrong.
- **Fix**: Prefix with REVOKE ALL, then re-grant the full intended set: `REVOKE ALL ON public.board_contributors FROM anon, authenticated;` followed by `GRANT SELECT, INSERT, DELETE ON public.board_contributors TO authenticated;`.
  - Strength: Matches defensive pattern in every other migration touching this table; self-documenting of full grant set.
  - Tradeoff: Minor — 2-line change, no behavioral difference today.
  - Confidence: HIGH — identical pattern in 20260602120000 and 20260707120000 migrations.
  - Blind spot: None significant.
- **Decision**: FIXED — Prefixed with `REVOKE ALL ON public.board_contributors FROM anon, authenticated;` before re-granting SELECT, INSERT, DELETE.

### F2 — check-name endpoint swallows query errors

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/board/check-name.ts:49
- **Detail**: Line 49 destructures only `{ data }` from `query.maybeSingle()`, ignoring any `error`. If the Supabase query fails (network timeout, service outage), `data` is null and the endpoint returns 204 — falsely reporting the name as available. A user could then save a duplicate board name. The sibling endpoint `settings.ts` handles this correctly by checking `error` on its own duplicate-check query. This error-swallowing predates the manage-ic-roster change, but the file was modified and the pattern is now inconsistent with the new sibling routes.
- **Fix**: Destructure `{ data, error }`, return 500 if `error` is truthy, matching the pattern in settings.ts:50-56.
  - Strength: 3-line change; aligns with sibling API routes; prevents false "name available" on query failure.
  - Tradeoff: None significant.
  - Confidence: HIGH — identical error-check pattern in settings.ts.
  - Blind spot: None significant.
- **Decision**: FIXED — Destructured `{ data, error }` and added 500 guard before the 409 check.

### F3 — Repo DELETE API has no server-side confirmation gate

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/board/[boardId]/repos.ts:80
- **Detail**: Repo removal triggers CASCADE deletion of all PRs, reviews, and comments — an irreversible destructive operation. The UI has a type-to-confirm dialog, but a raw API call bypasses it. RLS limits this to board owners, so the blast radius is constrained. Acceptable as-is given RLS + test coverage, but worth noting for future defense-in-depth consideration.
- **Fix**: No fix recommended — informational only.
- **Decision**: SKIPPED — RLS + UI confirmation guard is sufficient; informational only.

## Automated Verification

| Check                              | Result                        |
| ---------------------------------- | ----------------------------- |
| `npx tsc --noEmit`                 | ✅ Pass                       |
| `npm run test:typecheck`           | ✅ Pass                       |
| `npm run lint`                     | ✅ Pass                       |
| `vitest run --exclude integration` | ✅ 26 files, 313 tests passed |
| `npm run build`                    | ✅ Complete                   |
