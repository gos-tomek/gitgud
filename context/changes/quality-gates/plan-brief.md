# Quality Gates — Plan Brief

> Full plan: `context/changes/quality-gates/plan.md`
> Frame brief: `context/changes/quality-gates/frame.md`
> Research: `context/changes/quality-gates/research.md`

## What & Why

Wire vitest into CI, set up a three-tier quality gate model (post-edit → pre-commit → CI), and migrate pre-commit tooling from husky+lint-staged to Lefthook. This closes Phase 4 of the test-plan rollout — the last cross-cutting phase before slice-specific work. The local hook optimization (Lefthook, PostToolUse scoping) crosses the documented Lesson 3 boundary by explicit user choice, addressing a 61s-per-edit feedback loop that the frame identified as a scope problem, not a stage problem.

## Starting Point

Tests exist in four directories (unit, component, hermetic, integration) but never run in CI. The CI pipeline only does lint + build + wrangler dry-run. Locally, PostToolUse hooks run whole-project eslint (44s) and tsc (17s) after every edit. Pre-commit (husky+lint-staged) runs only eslint + prettier — no typecheck, no tests. There are 13 pre-existing type errors in test files that `tsc` never catches because `tsconfig.json` excludes `tests/`.

## Desired End State

CI blocks merges via two required jobs (validate + test-integration). Deploys run non-integration tests before shipping. Pre-commit runs 5 parallel checks via Lefthook in ~25s. PostToolUse drops from 61s to ~17s per edit. All test type errors are fixed.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| CI integration test strategy | Separate required job with Supabase | Integration tests need a real DB; separating them keeps the validate job fast | Plan |
| CI trigger for tests on push to main | Non-integration tests only, as deploy gate | Full integration suite already ran on the PR; re-running would add 90s+ for no new signal | Plan |
| Pre-commit tooling | Migrate to Lefthook | Parallel execution halves wall time; built-in staged-file filtering replaces lint-staged | Research |
| Pre-commit test scope | Non-integration only | Integration tests need Supabase, skip guard makes them a no-op without it — false safety | Research |
| PostToolUse eslint scope | File-scoped (`eslint --fix "$FILE"`) | 3× faster; cross-file issues caught at pre-commit (Lefthook) | Plan |
| PostToolUse tsc | Removed | Covered by Lefthook pre-commit (tsc × 2 in parallel) | Plan |
| Test type errors | Fix in this change | Unblocks the tsc gate from day one; mechanical narrowing fix, not logic change | Plan |
| Merge blocking | Branch protection (manual GitHub UI step) | Cannot be configured via code in the repo | Plan |

## Scope

**In scope:**
- Fix 13 type errors in `wizard-reducer.test.ts`
- Migrate husky+lint-staged → Lefthook with 5 parallel pre-commit tasks
- Scope PostToolUse eslint to edited file, remove tsc hook
- Add non-integration tests + typecheck to CI `validate` job
- Add `test-integration` job with Supabase to CI
- Add non-integration test gate to deploy workflow
- Update CLAUDE.md, test-plan.md §3/§5, change.md

**Out of scope:**
- Supabase service container in `validate` job
- Integration tests on push to main
- eslint config changes or disabling type-checked rules
- e2e tests / Playwright
- Branch protection API automation
- New tests beyond type error fixes

## Architecture / Approach

Three-tier quality gate model:

```
Post-edit (PostToolUse)     Pre-commit (Lefthook)      CI (GitHub Actions)
─────────────────────────   ───────────────────────    ──────────────────────────
eslint --fix "$FILE"        eslint {staged_files}      validate: lint+tsc+tests+build
vitest related "$FILE"      prettier {staged_files}    test-integration: supabase+integration
                            tsc --noEmit (src)         deploy gate: non-integration tests
                            tsc --noEmit (tests)
                            vitest (non-integration)
~17s per edit               ~25s per commit            ~2-3 min per PR
```

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Fix test type errors | `tsc --project tests/tsconfig.json` passes | None — mechanical narrowing fixes |
| 2. Migrate to Lefthook | Parallel pre-commit with 5 quality gates | Lefthook install hook must survive `npm ci` |
| 3. Scope PostToolUse hooks | 3.5× faster per-edit feedback (61s → 17s) | Cross-file lint issues delayed to pre-commit |
| 4. Wire vitest into CI | Two required CI jobs + deploy test gate | `supabase start` in GitHub Actions runner needs Docker |
| 5. Update documentation | CLAUDE.md, test-plan.md, change.md consistent | None — documentation only |

**Prerequisites:** All existing tests pass; Docker available on GitHub Actions runners (ubuntu-latest includes it)
**Estimated effort:** ~2-3 sessions across 5 phases

## Open Risks & Assumptions

- `supabase start` in GitHub Actions assumes Docker is available on `ubuntu-latest` — it is as of June 2026, but if GitHub changes runner images this could break
- Lefthook's `{staged_files}` glob must match the current lint-staged globs exactly — verify during Phase 2
- Branch protection is a manual step — until configured, PRs can merge without passing checks

## Success Criteria (Summary)

- No code reaches main without passing lint + typecheck + non-integration tests (CI gate)
- Integration tests run against real Supabase on every PR (separate required job)
- Developer edit-to-feedback loop drops from 61s to ~17s (PostToolUse) and pre-commit adds tsc + tests at ~25s
