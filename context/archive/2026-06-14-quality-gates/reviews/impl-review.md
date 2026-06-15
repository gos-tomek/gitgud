<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Quality Gates

- **Plan**: context/changes/quality-gates/plan.md
- **Scope**: All phases (1–5)
- **Date**: 2026-06-14
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 2 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

## Findings

### F1 — Supabase CLI version unpinned in CI

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: .github/workflows/ci.yml:44
- **Detail**: `supabase/setup-cli@v2` uses `version: latest`. A breaking Supabase CLI release could silently break CI with no code change. All other actions in the workflow use pinned major versions.
- **Fix**: Pin to a specific version (e.g. `version: 2.20.0`) for reproducibility.
- **Decision**: FIXED — pinned `supabase/setup-cli@v2` to `version: 2.101.0` in both ci.yml:44 and deploy.yml:64 (same unpinned pattern existed in both).

### F2 — PostToolUse eslint hook fires on non-lintable files

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: .claude/settings.json:33
- **Detail**: The eslint hook runs on every Write/Edit regardless of file extension. Editing a .json, .md, or .css file will invoke eslint on it — with flat config eslint may warn or error on unsupported files, adding noise to the feedback loop.
- **Fix**: Add an extension guard: `bash -c 'FILE=$(jq -r .tool_input.file_path) && [[ "$FILE" =~ \.(ts|tsx|astro)$ ]] && npx eslint --fix "$FILE" --quiet || true'`
- **Decision**: FIXED — applied the suggested extension guard verbatim in .claude/settings.json:33.

### F3 — Hardcoded local Supabase keys in CI workflow

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: .github/workflows/ci.yml:33-34
- **Detail**: SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are inline in the workflow. These are well-known local-only defaults from `supabase start`, not real secrets — but their presence could confuse a future contributor into thinking secrets are leaked.
- **Fix**: Add a one-line comment clarifying these are local CLI defaults, or extract them via `supabase status -o env` in a prior step.
- **Decision**: FIXED — added a one-line comment above the env block in ci.yml:32 clarifying these are local-only `supabase start` defaults.

### F4 — Env var placement inconsistency between CI and deploy

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: .github/workflows/ci.yml (validate) vs deploy.yml (pre-deploy-tests)
- **Detail**: In ci.yml, SUPABASE_URL/KEY are set at the step level (build only). In deploy.yml, they're set at the job level. The ci.yml approach (step-level) is actually the more precise pattern (least-privilege).
- **Fix**: No action required — noting for awareness. If aligning, prefer step-level (ci.yml pattern).
- **Decision**: FIXED — removed the unnecessary job-level `SUPABASE_URL`/`SUPABASE_KEY` env block from `pre-deploy-tests` in deploy.yml. Both vars are `optional: true` in the astro:env schema and `astro sync` already runs without them in ci.yml's validate job and in deploy.yml's own deploy-production job — none of pre-deploy-tests' steps (astro sync, typecheck, vitest) need real credentials.

## Plan Drift Summary

| Category            | Count |
| ------------------- | ----- |
| MATCH               | 14    |
| DRIFT (acceptable)  | 2     |
| MISSING             | 0     |
| EXTRA (scope creep) | 0     |

Acceptable drifts:

1. Phase 1: type-cast (`initialState as Extract<...>`) instead of `step: 1 as const` — functionally equivalent.
2. Phase 2: `lefthook` package instead of `@evilmartians/lefthook` — same tool, renamed upstream.

## Automated Verification Results

| Check                                  | Result                              |
| -------------------------------------- | ----------------------------------- |
| `tsc --noEmit`                         | ✅ PASS                             |
| `npm run test:typecheck`               | ✅ PASS                             |
| `npx vitest run --exclude integration` | ✅ PASS (55/55)                     |
| `npm run lint`                         | ✅ PASS                             |
| `npx lefthook run pre-commit`          | ✅ PASS (skipped — no staged files) |
| `ci.yml` valid YAML                    | ✅ PASS                             |
| `deploy.yml` valid YAML                | ✅ PASS                             |
