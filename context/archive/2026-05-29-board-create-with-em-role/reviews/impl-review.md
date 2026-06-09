<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Board Create with EM Role (S-01)

- **Plan**: context/changes/board-create-with-em-role/plan.md
- **Scope**: Phase 1–2 of 2
- **Date**: 2026-05-30
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 1 observation

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

### F1 — Unplanned auth-flow and tooling changes

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/pages/api/auth/signin.ts, src/pages/index.astro, eslint.config.js
- **Detail**: Three files changed that are not listed in the plan: (1) eslint.config.js — disables @typescript-eslint/no-misused-promises for .astro files (needed because astro-eslint-parser crashes on `return Astro.redirect()`); (2) src/pages/api/auth/signin.ts — redirects post-signin to /dashboard instead of /; (3) src/pages/index.astro — redirects authenticated users to /dashboard. The ESLint change is a necessary implementation detail. The auth redirect changes are UX improvements that make the flow coherent with the new /boards routes but extend beyond planned scope.
- **Fix**: Document these as addenda in the plan's Progress section so the plan remains ground truth.
- **Decision**: FIXED — addenda appended to plan.md Progress section.

### F2 — Custom submit button instead of SubmitButton reuse

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/CreateBoardForm.tsx:50-66
- **Detail**: Plan specified "Reuse SubmitButton from src/components/auth/" but implementation uses shadcn Button with local useState + flushSync for the submitting state. This is justified: SubmitButton relies on useFormStatus() which only works with React Server Actions — it cannot detect submission state for a native HTML form POSTing to an external API route. The custom approach is functionally equivalent and correct for this use case.
- **Fix**: No fix needed — deviation is a valid technical choice. If more forms use this pattern, consider extracting a shared NativeSubmitButton.
- **Decision**: ACCEPTED-AS-RULE: useFormStatus only works with React Server Actions
