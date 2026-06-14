# Quality Gates Implementation Plan

## Overview

Wire vitest into CI (Phase 4 of test-plan rollout), migrate pre-commit from husky+lint-staged to Lefthook with parallel quality gates, scope PostToolUse hooks to the edited file, and fix blocking test type errors. This change combines CI wiring (Phase 4 as scoped) with local hook optimization — the local-hook work crosses the documented Lesson 3 boundary by explicit user choice.

## Current State Analysis

The project has four test directories (`tests/unit/`, `tests/component/`, `tests/hermetic/`, `tests/integration/`) and a working Vitest setup, but no tests run in CI. The CI pipeline (`.github/workflows/ci.yml`) only runs lint + build + wrangler dry-run. The deploy pipeline (`deploy.yml`) deploys without any test gate.

Locally, the PostToolUse hooks run `eslint --fix .` (whole project, 44s) and `tsc --noEmit` (17s) after every file edit — a 61s pause per edit. The pre-commit hook (`husky` + `lint-staged`) only runs eslint + prettier on staged files — no typecheck, no tests.

### Key Discoveries:

- `.github/workflows/ci.yml:1-25` — no `npm test` step; triggers only on `pull_request` to main
- `.github/workflows/deploy.yml:1-163` — deploys on push to main with zero test gates
- `.claude/settings.json:32-33` — `eslint --fix .` (whole project) and `tsc --noEmit` run per edit
- `tests/unit/wizard-reducer.test.ts` — 13 type errors (discriminated union narrowing) block `tsc --project tests/tsconfig.json`
- `tsconfig.json` excludes `tests/` — bare `tsc --noEmit` never type-checks test files (critical gap)
- `package.json:13-15` — `test`, `test:watch`, `test:typecheck` scripts already exist
- `.husky/pre-commit:1` — runs `npx lint-staged` (eslint + prettier only, no tsc/tests)

## Desired End State

After this plan is complete:

1. **CI (PR to main)**: two required jobs — `validate` (lint + build + typecheck + non-integration tests + wrangler dry-run) and `test-integration` (Supabase service + integration tests). Both must pass to merge.
2. **CI (push to main)**: non-integration tests run as a gate before deploy in `deploy.yml`.
3. **Pre-commit (Lefthook)**: parallel eslint + prettier on staged files, tsc × 2 (src + tests), and vitest (non-integration) — replaces husky + lint-staged.
4. **PostToolUse hooks**: eslint scoped to the edited file (`eslint --fix "$FILE"`), tsc removed (covered by pre-commit), vitest related unchanged.
5. **Type errors fixed**: all 13 narrowing errors in `wizard-reducer.test.ts` resolved.
6. **Branch protection**: documented as manual step — require `validate` and `test-integration` status checks to pass before merge.

### Verification:

- `npm test` passes (all test types)
- `npm run test:typecheck` passes (zero type errors in tests)
- `npm run lint` passes
- `lefthook run pre-commit` completes successfully
- CI pipeline runs both jobs on a test PR
- Deploy pipeline runs non-integration tests before deploying

## What We're NOT Doing

- Adding Supabase service container to the PR `validate` job (integration tests get their own job)
- Running integration tests on push to main (only on PRs via dedicated job)
- Changing eslint config or disabling type-checked rules
- Adding e2e tests or Playwright
- Configuring branch protection via API (manual GitHub UI step)
- Changing the test structure or adding new tests (beyond fixing type errors)

## Implementation Approach

Five phases ordered by dependency: fix type errors first (unblocks tsc gate), then set up Lefthook pre-commit (local quality), then scope PostToolUse hooks (developer experience), then wire CI (the core Phase 4 deliverable), then update documentation.

## Phase 1: Fix test type errors in wizard-reducer.test.ts

### Overview

Fix 13 discriminated union narrowing errors so that `tsc --noEmit --project tests/tsconfig.json` passes. This unblocks the tsc gate at pre-commit and CI.

### Changes Required:

#### 1. Fix step1() helper spread widening

**File**: `tests/unit/wizard-reducer.test.ts`

**Intent**: The `step1()` helper spreads `initialState` (typed as full `WizardState` union) which widens the `step` property to `1 | 2 | 3`. Fix by asserting the step literal after spread.

**Contract**: `step1()` return type must remain `Extract<WizardState, { step: 1 }>`. Add `step: 1 as const` to the spread result, or cast `initialState` to the step-1 variant.

#### 2. Add narrowing guards in fetch lifecycle tests

**File**: `tests/unit/wizard-reducer.test.ts`

**Intent**: Lines 302-341 access step-specific properties (`reposLoading`, `repos`, `reposError`, `collaboratorsLoading`, `collaborators`, `collaboratorsError`) on `WizardState` without narrowing. The test file already demonstrates the pattern on lines 100-112 with `if (result.step !== 2) throw new Error("expected step 2")`.

**Contract**: After each `wizardReducer()` call in the fetch lifecycle describe block, add a narrowing guard before accessing step-specific properties. Follow the existing pattern at line 102. An assertion helper (`function assertStep2(s: WizardState): asserts s is Extract<WizardState, { step: 2 }>`) is acceptable if it reduces repetition across the 12 call sites.

### Success Criteria:

#### Automated Verification:

- `npm run test:typecheck` exits 0 (zero type errors in test files)
- `tsc --noEmit` exits 0 (src files still clean)
- `npm test` passes (tests still green after narrowing changes)

#### Manual Verification:

- None — this is a mechanical type fix with no behavioral change.

**Implementation Note**: After completing this phase and all automated verification passes, proceed to Phase 2.

---

## Phase 2: Migrate pre-commit from husky+lint-staged to Lefthook

### Overview

Replace the current husky + lint-staged setup with Lefthook. The current pre-commit (`.husky/pre-commit` → `npx lint-staged`) runs eslint + prettier sequentially on staged files. Lefthook will run eslint, prettier, tsc (×2 projects), and vitest (non-integration) in parallel.

> **Note**: This phase crosses the documented Lesson 3 boundary (CLAUDE.md: "Do not configure hooks, hook lifecycle, or debugging hooks. That is Lesson 3.") by explicit user choice.

### Changes Required:

#### 1. Remove husky and lint-staged

**File**: `package.json`

**Intent**: Remove `husky` and `lint-staged` from devDependencies and delete the `lint-staged` config block (lines 75-82). These are replaced by Lefthook.

**Contract**: Remove `"husky": "9.1.7"` (line 60), `"lint-staged": "^16.3.3"` (line 61) from `devDependencies`. Remove the entire `"lint-staged": { ... }` block (lines 75-82).

#### 2. Delete .husky directory

**File**: `.husky/pre-commit`

**Intent**: Remove the husky hook directory. Lefthook manages its own Git hooks.

**Contract**: Delete the entire `.husky/` directory.

#### 3. Install Lefthook and create config

**File**: `lefthook.yml` (new, project root)

**Intent**: Create a Lefthook config that replicates the current lint-staged tasks plus adds tsc (both projects) and vitest (non-integration). All commands run in parallel.

**Contract**: The config must define a `pre-commit` hook with `parallel: true` and these commands:
- `eslint`: glob `*.{ts,tsx,astro}`, run `npx eslint --fix {staged_files}`, `stage_fixed: true`
- `prettier`: glob `*.{json,css,md}`, run `npx prettier --write {staged_files}`, `stage_fixed: true`
- `typecheck-src`: run `npx tsc --noEmit` (project-wide, cannot be file-scoped)
- `typecheck-tests`: run `npx tsc --noEmit --project tests/tsconfig.json`
- `test`: run `npx vitest run --exclude 'tests/integration/**'`

Add `@evilmartians/lefthook` to `devDependencies` and add `"prepare": "lefthook install"` to `scripts` so Git hooks are set up on `npm ci`.

#### 4. Update .gitignore if needed

**File**: `.gitignore`

**Intent**: Lefthook may create a `.lefthook-local.yml` for personal overrides. Add it to `.gitignore` if not already present.

**Contract**: Add `.lefthook-local.yml` to `.gitignore`.

### Success Criteria:

#### Automated Verification:

- `npm ci` installs lefthook and runs `lefthook install` via prepare script
- `npx lefthook run pre-commit` completes with all 5 commands passing
- `husky` and `lint-staged` are absent from `node_modules/.package-lock.json`
- `.husky/` directory does not exist

#### Manual Verification:

- Create a test commit with a staged `.ts` file and verify lefthook fires all parallel checks.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Scope PostToolUse hooks

### Overview

Reduce the per-edit feedback loop from ~61s to ~17s by scoping eslint to the edited file and removing tsc (now covered by Lefthook pre-commit).

> **Note**: This phase crosses the documented Lesson 3 boundary by explicit user choice.

### Changes Required:

#### 1. Scope eslint to edited file

**File**: `.claude/settings.json`

**Intent**: Change `eslint --fix .` (whole project, 44s) to `eslint --fix "$FILE"` (single file, 13-15s). The `vitest related` command already uses this pattern.

**Contract**: The eslint hook command (line 33) changes from `npx eslint --fix . --quiet` to the same `bash -c 'FILE=$(jq -r .tool_input.file_path) && npx eslint --fix "$FILE" --quiet'` pattern used by the vitest hook (line 43). Cross-file issues (unused exports) surface at pre-commit.

#### 2. Remove tsc from PostToolUse

**File**: `.claude/settings.json`

**Intent**: Remove the `tsc --noEmit` hook (17s per edit). Type errors now surface at pre-commit (Lefthook runs tsc × 2 in parallel with other checks) and CI.

**Contract**: Delete the hook entry at lines 37-40. The remaining hooks are eslint (file-scoped) and vitest related.

### Success Criteria:

#### Automated Verification:

- `.claude/settings.json` is valid JSON
- PostToolUse hooks section contains exactly 2 hooks (eslint file-scoped, vitest related)
- `tsc --noEmit` does not appear in `.claude/settings.json`

#### Manual Verification:

- Edit a `.ts` file and verify the PostToolUse hook completes in ~15-17s (eslint + vitest) instead of ~61s.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Wire vitest into CI

### Overview

Add tests to both CI pipelines: a two-job structure on PRs (validate + test-integration) and a non-integration test gate before deploy on push to main. Configure both jobs as required status checks for merge.

### Changes Required:

#### 1. Add non-integration test steps to validate job

**File**: `.github/workflows/ci.yml`

**Intent**: Add typecheck (src + tests) and non-integration vitest run to the existing `validate` job, between lint and build steps.

**Contract**: Add three steps after `npm run lint`:
- `npm run test:typecheck` (tsc on test files)
- `npx tsc --noEmit` (tsc on src files — currently implicit in build, but making it explicit gives a clearer error)
- `npx vitest run --exclude 'tests/integration/**'` (unit + component + hermetic tests)

#### 2. Add test-integration job with Supabase

**File**: `.github/workflows/ci.yml`

**Intent**: Add a separate required job that starts a local Supabase instance and runs integration tests. Uses `supabase/setup-cli@v2` (already used in `deploy.yml`) and `npx supabase start` to bootstrap Supabase in Docker on the runner.

**Contract**: New job `test-integration` that:
- Runs on `ubuntu-latest`
- Checks out code, sets up Node 24, runs `npm ci`
- Installs Supabase CLI via `supabase/setup-cli@v2`
- Runs `npx supabase start` to start local Supabase (provides DB + auth + API on default ports)
- Runs `npx astro sync` with env vars from `supabase start` output
- Runs `npx vitest run tests/integration/` with `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` set to local Supabase defaults (`http://127.0.0.1:54321`, local dev keys from `supabase/config.toml`)

The test helpers (`tests/helpers/supabase.ts`) already default to these values, but setting them explicitly makes the CI config self-documenting.

#### 3. Add test gate to deploy workflow

**File**: `.github/workflows/deploy.yml`

**Intent**: Add a `pre-deploy-tests` job that runs non-integration tests before the deploy job. The deploy job depends on it via `needs:`.

**Contract**: New job `pre-deploy-tests` before `deploy-production`:
- Runs on `ubuntu-latest`
- Checks out code, sets up Node 24, runs `npm ci`, `npx astro sync`
- Runs `npm run test:typecheck`, `npx tsc --noEmit`, `npx vitest run --exclude 'tests/integration/**'`
- `deploy-production` job adds `needs: [pre-deploy-tests]` so deploy waits for tests to pass
- Env vars `SUPABASE_URL` and `SUPABASE_KEY` from secrets (needed for `astro sync`)

### Success Criteria:

#### Automated Verification:

- `ci.yml` is valid YAML (parse with `npx yaml ci.yml` or similar)
- `deploy.yml` is valid YAML
- CI `validate` job includes typecheck + non-integration test steps
- CI `test-integration` job includes `supabase start` + integration test steps
- Deploy `pre-deploy-tests` job runs before `deploy-production`

#### Manual Verification:

- Push the branch and open a test PR — verify both `validate` and `test-integration` jobs appear and run
- Verify `test-integration` starts Supabase and runs integration tests
- Verify PR cannot merge if either job fails (after branch protection is configured)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that CI jobs run correctly before proceeding to the next phase.

---

## Phase 5: Update documentation and close Phase 4

### Overview

Update test-plan.md (§3 status, §5 quality gates table), CLAUDE.md (commands, CI, testing sections), and change.md status.

### Changes Required:

#### 1. Update test-plan.md §3 Phase 4 status

**File**: `context/foundation/test-plan.md`

**Intent**: Mark Phase 4 as shipped and record the change folder path.

**Contract**: In the §3 rollout table (line 81), change Phase 4 Status from `not started` to `shipped` and set Change folder to `context/changes/quality-gates/`.

#### 2. Update test-plan.md §5 quality gates table

**File**: `context/foundation/test-plan.md`

**Intent**: Update the quality gates table to reflect the new three-tier model and tooling.

**Contract**: Update the §5 table (lines 105-111) to reflect:
- `pre-commit (lefthook)` replaces `pre-commit (husky)` — now catches eslint + prettier + tsc (src + tests) + vitest (non-integration)
- `unit + integration` row: update "Where" to clarify CI has two jobs (non-integration in validate, integration in test-integration)
- Add a row for `component + hermetic tests` if not already distinct

#### 3. Update CLAUDE.md Commands section

**File**: `CLAUDE.md`

**Intent**: Update the pre-commit hooks description (line 22) and add `npm run test:typecheck` to commands.

**Contract**:
- Line 17: update `npm test` description — it runs all tests, not just integration
- Line 22: change from "husky + lint-staged runs `eslint --fix` on `*.{ts,tsx,astro}` and `prettier --write` on `*.{json,css,md}`" to describe Lefthook with all 5 parallel commands (eslint, prettier, tsc × 2, vitest non-integration)
- Add `npm run test:typecheck` command to the list

#### 4. Update CLAUDE.md CI section

**File**: `CLAUDE.md`

**Intent**: Update the CI description (line 68) to reflect the two-job structure and deploy test gate.

**Contract**: Line 68 currently reads "runs lint + build on every push and PR to master." Update to describe: two jobs on PRs (validate: lint + typecheck + tests + build + wrangler dry-run; test-integration: Supabase + integration tests). Non-integration tests also run before deploy on push to main.

#### 5. Update CLAUDE.md Testing section

**File**: `CLAUDE.md`

**Intent**: Update the testing section (lines 72-76) to reflect all four test types, not just integration.

**Contract**: Line 72 currently says "Tests live in `tests/integration/`." Update to list all four directories: `tests/unit/`, `tests/component/`, `tests/hermetic/`, `tests/integration/`.

#### 6. Update change.md status

**File**: `context/changes/quality-gates/change.md`

**Intent**: Mark the change as planned (will become shipped after implementation).

**Contract**: Set `status: planned`, update `updated:` timestamp.

#### 7. Configure branch protection (manual step)

**Intent**: Document the manual GitHub UI step to require `validate` and `test-integration` status checks before merge to main.

**Contract**: This is a manual step, not a code change. Document in the plan that after CI jobs run successfully on a PR, the repo admin must go to GitHub → Settings → Branches → Branch protection rules for `main` → enable "Require status checks to pass before merging" and add `validate` and `test-integration` as required checks.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes (no lint errors in changed files)
- All references in test-plan.md §3 and §5 are consistent with new CI structure
- CLAUDE.md mentions Lefthook, two CI jobs, and all four test directories

#### Manual Verification:

- Read through updated CLAUDE.md and test-plan.md for accuracy
- Configure branch protection in GitHub UI
- Verify a PR to main shows both required checks

**Implementation Note**: After completing this phase, the quality-gates change is complete. Update change.md status to `shipped` after merge.

---

## Testing Strategy

### Unit Tests:

- No new tests added — this change is infrastructure/config
- Existing tests must continue passing after type error fixes (Phase 1)

### Integration Tests:

- The CI `test-integration` job itself is the integration test of the test infrastructure
- Verify `supabase start` + `vitest run tests/integration/` works in GitHub Actions

### Manual Testing Steps:

1. Run `npx lefthook run pre-commit` locally and verify all 5 commands pass in parallel
2. Edit a file and verify PostToolUse hooks complete in ~15-17s
3. Open a test PR and verify both CI jobs run and report status
4. Verify PR merge is blocked when a job fails (after branch protection)
5. Merge a PR and verify deploy.yml runs non-integration tests before deploying

## Performance Considerations

- **Pre-commit wall time**: ~25s with Lefthook parallel (vs ~15-20s sequential husky, but with tsc + tests added)
- **PostToolUse time**: ~15-17s (vs ~61s today) — 3.5× faster feedback loop
- **CI validate job**: adds ~30s for tests to existing lint+build time
- **CI test-integration job**: ~90-120s (Supabase startup + migration + tests)
- **Deploy pipeline**: adds ~30s for non-integration tests before deploy

## References

- Research: `context/changes/quality-gates/research.md`
- Frame: `context/changes/quality-gates/frame.md`
- Test plan: `context/foundation/test-plan.md` (§3 Phase 4, §5 Quality Gates)
- Current CI: `.github/workflows/ci.yml:1-25`
- Current deploy: `.github/workflows/deploy.yml:1-163`
- Current hooks: `.claude/settings.json:27-49`
- Current pre-commit: `.husky/pre-commit:1`, `package.json:75-82`
- Type errors: `tests/unit/wizard-reducer.test.ts:47,302-341`
- Test helpers: `tests/helpers/supabase.ts` (env var defaults for CI)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Fix test type errors

#### Automated

- [x] 1.1 `npm run test:typecheck` exits 0
- [x] 1.2 `tsc --noEmit` exits 0
- [x] 1.3 `npm test` passes

### Phase 2: Migrate pre-commit to Lefthook

#### Automated

- [ ] 2.1 `npm ci` installs lefthook and runs `lefthook install`
- [ ] 2.2 `npx lefthook run pre-commit` passes all 5 commands
- [ ] 2.3 husky and lint-staged absent from dependencies
- [ ] 2.4 `.husky/` directory does not exist

#### Manual

- [ ] 2.5 Test commit triggers lefthook with parallel checks

### Phase 3: Scope PostToolUse hooks

#### Automated

- [ ] 3.1 `.claude/settings.json` is valid JSON with 2 PostToolUse hooks
- [ ] 3.2 `tsc --noEmit` does not appear in `.claude/settings.json`

#### Manual

- [ ] 3.3 File edit completes PostToolUse in ~15-17s

### Phase 4: Wire vitest into CI

#### Automated

- [ ] 4.1 `ci.yml` is valid YAML
- [ ] 4.2 `deploy.yml` is valid YAML
- [ ] 4.3 CI validate job includes typecheck + non-integration tests
- [ ] 4.4 CI test-integration job includes supabase start + integration tests
- [ ] 4.5 Deploy pre-deploy-tests job runs before deploy-production

#### Manual

- [ ] 4.6 PR shows both validate and test-integration jobs
- [ ] 4.7 test-integration starts Supabase and runs integration tests
- [ ] 4.8 PR cannot merge if either job fails

### Phase 5: Update documentation and close Phase 4

#### Automated

- [ ] 5.1 `npm run lint` passes
- [ ] 5.2 test-plan.md §3/§5 updated consistently
- [ ] 5.3 CLAUDE.md mentions Lefthook, two CI jobs, four test directories

#### Manual

- [ ] 5.4 Updated docs are accurate on review
- [ ] 5.5 Branch protection configured in GitHub UI
- [ ] 5.6 PR shows required checks after protection is set
