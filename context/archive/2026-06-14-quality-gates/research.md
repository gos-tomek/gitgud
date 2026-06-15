---
date: "2026-06-14T12:00:00+02:00"
researcher: Claude (Opus 4.6)
git_commit: 8931678a215c62fa12f2c3d666f20bfbdfb27aea
branch: changes/quality-gates
repository: gos-tomek/gitgud
topic: "Quality gates: pre-commit hooks, test strategy, and execution time benchmarks"
tags: [research, quality-gates, pre-commit, lefthook, husky, ci, eslint, tsc, vitest]
status: complete
last_updated: "2026-06-14"
last_updated_by: Claude (Opus 4.6)
---

# Research: Quality Gates

**Date**: 2026-06-14  
**Researcher**: Claude (Opus 4.6)  
**Git Commit**: `8931678`  
**Branch**: `changes/quality-gates`  
**Repository**: gos-tomek/gitgud

## Research Questions

1. Pre-commit hooks — compare husky (current) with Lefthook and alternatives
2. Test strategy — what checks fire when (post-edit, pre-commit, CI)?
3. Execution time of `npx eslint` and `npx tsc` during editing

## Summary

The project's quality gates have a **scope problem, not a stage problem**. The PostToolUse hooks run `eslint --fix .` (whole project: **44s**) and `tsc --noEmit` (**17s**) after every file edit — a combined ~61s pause per edit. Single-file eslint takes **13–15s** (still dominated by type-checking parser startup), which is 3× faster but still not instant. The `vitest related` check is fast (~2s) and already file-scoped.

For pre-commit tooling, **Lefthook** is the strongest upgrade over the current husky + lint-staged setup: it runs tasks in parallel, has built-in staged-file filtering, and replaces two tools with one YAML config. The migration is straightforward.

The test strategy needs a clear three-tier model: fast file-scoped checks post-edit, staged-file checks at pre-commit, and full-project + test suite in CI.

## Detailed Findings

### 1. Pre-commit Hook Tools Comparison

#### Current setup

- **husky 9.1.7** — `.husky/pre-commit` runs `npx lint-staged`
- **lint-staged 16.3.3** — config in `package.json`:
  - `*.{ts,tsx,astro}` → `eslint --fix`
  - `*.{json,css,md}` → `prettier --write`
- Tasks run **sequentially**; no parallelism

#### Comparison table

| Feature                            | Husky + lint-staged                       | Lefthook                                 | simple-git-hooks + nano-staged |
| ---------------------------------- | ----------------------------------------- | ---------------------------------------- | ------------------------------ |
| Language                           | Node.js                                   | Go (single binary)                       | Node.js                        |
| npm weekly downloads               | Husky: ~29M, lint-staged: ~8M             | ~2.4M                                    | ~523K                          |
| GitHub stars                       | Husky: 35K + lint-staged: 15K             | 8.1K                                     | 1.7K                           |
| Install size                       | Husky: 6.4KB + lint-staged: ~147KB + deps | npm wrapper: 26.5KB (Go binary separate) | 12.7KB + 52KB                  |
| Dependencies                       | Husky: 0, lint-staged: several            | 0 (Go binary)                            | 0 each                         |
| **Parallel execution**             | No — sequential                           | **Yes — default**                        | No                             |
| **Built-in staged-file filtering** | No (needs lint-staged)                    | **Yes** — `{staged_files}` + glob        | No (needs nano-staged)         |
| Auto re-stage fixed files          | Via lint-staged                           | Built-in: `stage_fixed: true`            | Via nano-staged                |
| Config format                      | Shell scripts + JSON/JS                   | Single YAML file                         | JSON in package.json           |
| Multiple commands per hook         | Via lint-staged                           | Native — unlimited                       | One command per hook           |
| Last release                       | Husky: Jan 2025 (9.1.7)                   | May 2026 (2.1.9) — very active           | Jul 2025 (2.13.1)              |

#### Recommendation

**Lefthook** is the best fit. Key advantages for this project:

- **Parallel execution** cuts pre-commit time from `max(eslint) + max(tsc)` → `max(eslint, tsc)` — roughly halving wall time
- **Built-in staged-file filtering** eliminates the lint-staged dependency
- **Single `lefthook.yml`** replaces `.husky/pre-commit` + `lint-staged` config in `package.json`
- Most actively maintained of the three options (releases every few weeks as of 2026)

Equivalent config would look like:

```yaml
# lefthook.yml
pre-commit:
  parallel: true
  commands:
    eslint:
      glob: "*.{ts,tsx,astro}"
      run: npx eslint --fix {staged_files}
      stage_fixed: true
    prettier:
      glob: "*.{json,css,md}"
      run: npx prettier --write {staged_files}
      stage_fixed: true
    typecheck-src:
      run: npx tsc --noEmit
    typecheck-tests:
      run: npx tsc --noEmit --project tests/tsconfig.json
    test:
      run: npx vitest run --exclude 'tests/integration/**'
```

### 2. Test Strategy: What Fires When

#### Current state

| Stage                       | Trigger                        | What runs                                               | Time          | Config location                      |
| --------------------------- | ------------------------------ | ------------------------------------------------------- | ------------- | ------------------------------------ |
| **Post-edit** (Claude hook) | Every `Write`/`Edit` tool call | `eslint --fix .` (whole project)                        | **44s**       | `.claude/settings.json`              |
|                             |                                | `tsc --noEmit`                                          | **17s**       | `.claude/settings.json`              |
|                             |                                | `vitest related "$FILE" --run`                          | **~2s**       | `.claude/settings.json`              |
| **Pre-commit** (husky)      | `git commit`                   | `lint-staged` (eslint --fix + prettier on staged files) | ~15–20s       | `.husky/pre-commit` + `package.json` |
| **CI** (GitHub Actions)     | PR to main                     | `npm run lint` (eslint whole project)                   | ?             | `.github/workflows/ci.yml`           |
|                             |                                | `npm run build` (astro build — includes tsc)            | ?             | `.github/workflows/ci.yml`           |
|                             |                                | `wrangler deploy --dry-run`                             | ?             | `.github/workflows/ci.yml`           |
| **CI** (missing)            | —                              | `npm test` (vitest)                                     | **not wired** | —                                    |

#### Problems with current state

1. **Post-edit: whole-project scope** — `eslint --fix .` scans all 46 source files (44s) instead of just the edited file (13–15s). The `tsc --noEmit` (17s) cannot be file-scoped (TypeScript's project-wide type checking is all-or-nothing). Combined: **~61s per edit**.
2. **Pre-commit: no typecheck, no tests** — only lint-staged (eslint + prettier) runs. A commit with type errors passes pre-commit.
3. **CI: no test step** — `npm test` is not in `ci.yml`. Tests exist (`tests/integration/`, `tests/component/`, `tests/hermetic/`, `tests/unit/`) but never run in CI.
4. **Redundant work** — eslint runs at all three stages (post-edit whole-project, pre-commit staged, CI whole-project).

#### Decided three-tier model

> Decision: pre-commit runs fast tests (component + hermetic + unit) but NOT integration tests.
> Integration tests run only in CI. Rationale: they need local Supabase, are slower, and the
> `checkSupabase` skip guard makes them a no-op for devs without Supabase running — false safety.

| Stage                               | What runs                                                                                                                                                                         | Vitest scope                                                                                 | Est. time |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------- |
| **Post-edit** (Claude hook)         | `eslint --fix "$FILE" --quiet` + `vitest related "$FILE" --run`                                                                                                                   | Related tests only (any type; integration auto-skips without Supabase)                       | ~17s      |
| **Pre-commit** (Lefthook, parallel) | `eslint --fix {staged_files}` + `prettier --write {staged_files}` + `tsc --noEmit` + `tsc --noEmit --project tests/tsconfig.json` + `vitest run --exclude 'tests/integration/**'` | component + hermetic + unit                                                                  | ~25s      |
| **CI** (GitHub Actions)             | `npm run lint` + `npm run build` + `npm run test:typecheck` + `npm test` + `wrangler deploy --dry-run`                                                                            | **All tests** including integration (with Supabase service container or skip-if-unavailable) | full      |

> **Critical gap found during research**: root `tsconfig.json` has `"exclude": ["dist", "tests"]`.
> A bare `tsc --noEmit` never type-checks test files. Without an explicit
> `tsc --noEmit --project tests/tsconfig.json` step, type errors in tests (like the 13 current
> errors in `wizard-reducer.test.ts`) pass through every stage silently — vitest transpiles
> but does not typecheck, eslint's type-checked rules also use the root tsconfig that excludes tests.

**What each tier catches that the previous one doesn't:**

- Post-edit → immediate feedback on the file you just touched (lint errors, related test regressions)
- Pre-commit → type errors in **src/ and tests/** (`tsc` × 2 projects), cross-file regressions in component/hermetic/unit tests, formatting
- CI → integration tests (RLS, access boundary, PAT leakage), full-project lint, production build

### 3. Execution Time Benchmarks

Measured on the current codebase (46 source files, 12 test files):

| Command                                              | Scope                | Wall time | Notes                                         |
| ---------------------------------------------------- | -------------------- | --------- | --------------------------------------------- |
| `npx eslint --fix . --quiet`                         | Whole project        | **44.2s** | Current PostToolUse config                    |
| `npx eslint --fix src/pages/dashboard.astro --quiet` | Single .astro file   | **15.5s** | Type-checked rules require full project parse |
| `npx eslint --fix src/lib/supabase.ts --quiet`       | Single .ts file      | **13.4s** | Same parser startup cost                      |
| `npx tsc --noEmit`                                   | Whole project (src/) | **17.5s** | Cannot be file-scoped                         |
| `npx tsc --noEmit --project tests/tsconfig.json`     | Test files only      | **7.4s**  | Has pre-existing type errors (exit code 2)    |
| `npx vitest related <file> --run`                    | Related tests only   | **~1.7s** | Fast — already file-scoped                    |

**Key insight**: Single-file eslint (13–15s) is still slow because `strictTypeChecked` rules require the TypeScript project service to parse the entire project graph before linting even one file. The 3× speedup vs whole-project (44s) comes from skipping the lint/fix phase on other files, not from avoiding the parse.

**Options to reduce eslint single-file time further:**

- Disable `projectService` for PostToolUse-only runs (loses type-checked rules — not recommended)
- Use `TIMING=1 npx eslint` to identify which rules are slowest and consider disabling the most expensive ones in a PostToolUse-specific config
- Accept 13–15s as the floor for type-aware linting and focus optimization on eliminating redundant runs

## Code References

- `.claude/settings.json:27-49` — PostToolUse hooks (eslint, tsc, vitest)
- `.husky/pre-commit:1` — `npx lint-staged`
- `package.json:76-82` — lint-staged config
- `.github/workflows/ci.yml:1-24` — CI pipeline (no test step)
- `eslint.config.js:14-17` — `projectService: true` (type-checked rules — root cause of slow single-file lint)
- `vitest.config.ts` — test runner config
- `tsconfig.json` — excludes `tests/`; separate `tests/tsconfig.json` for test typecheck

## Architecture Insights

1. **eslint type-checking is the bottleneck.** The `strictTypeChecked` + `stylisticTypeChecked` configs with `projectService: true` force a full TypeScript project parse for any file, even a single-file lint. This is an inherent cost of type-aware linting, not a configuration mistake.

2. **tsc cannot be file-scoped.** TypeScript's `--noEmit` always type-checks the full project graph. There is no `tsc --noEmit src/foo.ts` that only checks one file. This makes it unsuitable for per-edit hooks but appropriate for pre-commit/CI.

3. **Pre-existing type errors in tests.** `tsc --project tests/tsconfig.json` exits with 13 type errors in `tests/unit/wizard-reducer.test.ts` — these would block a pre-commit typecheck gate. They need fixing before or alongside this change.

4. **CI has no test step.** The pipeline runs lint + build + wrangler dry-run but never `npm test`. This is the primary gap Phase 4 is meant to close.

## Historical Context

- `context/changes/quality-gates/frame.md` — framing analysis concluded the slowness is a scope problem (whole-project commands), not a stage problem (post-edit vs pre-commit). Recommended splitting CI wiring from local hook strategy.
- `context/archive/2026-06-11-test-fix-gaps/plan.md:613` — documented incident where project-wide `tsc --noEmit` PostToolUse check blocked an unrelated edit due to pre-existing type errors elsewhere.

## Decisions Made

1. **Pre-commit test scope**: component + hermetic + unit only. Integration tests fire in CI only (need Supabase, false safety without it).
2. **Pre-commit includes `tsc --noEmit`**: yes — parallel with eslint via Lefthook, so no additive cost.

## Open Questions

1. **CI test step: skip integration tests if no Supabase?** The existing `checkSupabase` guard skips tests gracefully, but CI would need either a Supabase service container or acceptance that integration tests only run locally.
2. **Fix test type errors first?** The 13 type errors in `wizard-reducer.test.ts` would block the `tsc --noEmit --project tests/tsconfig.json` gate at pre-commit. These are narrowing issues (discriminated union `WizardState` not narrowed after reducer call) — quick to fix with type assertions or explicit narrowing. Should they be fixed in this change or a separate one?
3. **Lefthook migration scope** — replace husky+lint-staged entirely, or keep the current setup and only change CI? The frame.md recommends splitting: CI wiring in this change, local hooks in a separate one.
