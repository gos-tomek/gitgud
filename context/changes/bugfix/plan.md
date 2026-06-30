# Fix GitHub Sync Workflow Subrequest Crashes and Chain Ordering — Implementation Plan

## Overview

Rebuild the Cloudflare Workflow orchestration in `worker.ts` to eliminate three confirmed defects: (1) review comments loop crashes from subrequest budget overflow, (2) classify runs simultaneously with sync instead of after, (3) dispatcher crashes on first sync of large repos. The sync functions in `github-sync.ts` stay untouched — only the orchestration layer changes.

## Current State Analysis

The sync workflow (`classification-batch`) is split into three phases via `ClassificationBatchParams.phase`:

- **dispatch** — lists repos, lists PRs for ALL repos (sharing one invocation's 50-subrequest budget), spawns sync-repo + classify instances simultaneously.
- **sync-repo** — enriches PRs via GraphQL, syncs review comments. The review comments loop lacks `step.sleep` between iterations — each iteration uses up to 47 subrequests, second iteration crashes instantly.
- **classify** — waits 3 minutes (timing hack), then classifies unprocessed threads.

Nine prior PRs (#47–#55) each shifted the crash point without eliminating it because they optimized budget math (47/50) rather than restructuring around the hard constraint.

### Key Discoveries:

- `worker.ts:198-213` — review comments loop has no `step.sleep` between iterations (proximate crash cause)
- `worker.ts:113-129` — dispatcher PR listing loop also has no `step.sleep` between repos (crashes on first sync of 2+ large repos)
- `worker.ts:160-169` — classify spawned simultaneously with sync-repo from dispatcher's `spawn-children` step
- `worker.ts:229` — classify uses 3-minute `step.sleep` as timing hack instead of real dependency
- `syncBoardGitHubData` (github-sync.ts:483-517) — dead code, not imported anywhere, has the same subrequest bug at scale

## Desired End State

Every workflow invocation stays under 32 subrequests (36% headroom from the 50-subrequest free-plan limit). The dispatcher makes exactly 1 external call (Supabase query). Each sync-repo is self-contained: it lists its own PRs, enriches them, syncs review comments with budget resets between iterations, updates `last_synced_at`, and spawns classify. Classify runs after sync completes — no timing hacks.

Verification: trigger a manual sync for a board with 3 repos. All three phases complete without "Too many subrequests" errors. Classify sees all synced data. DB tables populated identically to current behavior.

## What We're NOT Doing

- Changing `GQL_PRS_PER_QUERY` (stays at 500 — fits in one invocation at ~30 subrequests, well within budget)
- Modifying sync functions in `github-sync.ts` (`syncPrBatch`, `syncReviewCommentsForRepo`, `listAndUpsertPrsForRepo`)
- Adding rate-limit guards (6-14% of GitHub's 5,000/hr budget used worst-case)
- Fixing the non-workflow `syncBoardGitHubData` (removing it instead — it's dead code)
- Adding workflow-level integration tests (Cloudflare's `step.do`/`step.sleep` can't run in Vitest)

## Implementation Approach

Move PR listing from the dispatcher into sync-repo so each instance manages its own subrequest budget. Add `step.sleep` between all loops that make external calls. Spawn classify from sync-repo's final step instead of from the dispatcher.

The three fixes are interdependent (all touch the same orchestration code in `worker.ts`), so they ship as a single phase. Dead code removal and hermetic tests follow as separate phases.

---

## Phase 1: Rebuild Workflow Orchestration

### Overview

Rewrite the three workflow phases in `worker.ts` to fix all three defects. The sync functions in `github-sync.ts` are not modified — only how `worker.ts` calls them changes.

### Changes Required:

#### 1. Simplify dispatcher

**File**: `src/worker.ts` — `runDispatch` method

**Intent**: Remove all GitHub interaction from the dispatcher. It should only read repos from Supabase and spawn sync-repo instances with lightweight metadata. This eliminates the subrequest overflow on first sync of multiple large repos.

**Contract**: `runDispatch` makes exactly 1 external subrequest (the `list-board-repos` Supabase query). Steps become:

- `read-sync-state` — pure computation (0 subrequests), returns `new Date().toISOString()` for consistent `last_synced_at` across all repos
- `list-board-repos` — 1× Supabase select (1 subrequest)
- `spawn-children` — iterates repos, computes `since` from `repo.last_synced_at` (pure), calls `workflow.create` per repo (~0 subrequests, binding calls). Does NOT spawn classify — that's sync-repo's job now.

Remove: `get-github-token` step, `makeOctokit` call, `RepoTarget` interface, the `sync-list-prs-{r}` loop, `budget-reset-before-spawn` sleep, classify spawning from `spawn-children`.

#### 2. Update ClassificationBatchParams

**File**: `src/worker.ts` — `ClassificationBatchParams` interface

**Intent**: Remove `prs` field since sync-repo now lists its own PRs.

**Contract**: Remove `prs?: PrRef[]` from the interface. Other fields (`repoId`, `owner`, `repoName`, `since`, `syncStartedAt`) remain — they carry lightweight metadata from dispatcher to sync-repo.

#### 3. Make sync-repo self-contained

**File**: `src/worker.ts` — `runSyncRepo` method

**Intent**: Sync-repo lists its own PRs (moved from dispatcher), resets subrequest budget between all phases, and spawns classify as its final step.

**Contract**: `runSyncRepo` steps become:

- `get-github-token` — 1× Supabase (1 subrequest)
- `list-and-upsert-prs` — REST pagination + 1× upsert (≤26 subrequests for supabase/supabase scale). Calls `listAndUpsertPrsForRepo(supabase, octokit, repoRow, sinceDate, Number.POSITIVE_INFINITY)` where `repoRow` is constructed from params. Returns `PrRef[]`.
- `step.sleep("budget-reset-before-details")` — resets subrequest budget
- `sync-pr-details` — unchanged, ~30 subrequests
- `step.sleep("budget-reset-before-reviews")` — already exists
- `sync-review-comments-{p}` loop — `maxPages` reduced from 45 to 25 (≤27 subrequests per iteration). `step.sleep("budget-reset-review-{p}")` added between iterations (only when `nextSince` is non-null, i.e., more pages remain).
- `update-last-synced` — unchanged
- `spawn-classify` — new step, calls `workflow.create` with `{ boardId, phase: "classify" }` and ID `classify-{boardId}-{repoId}-{dateStamp}`. Wrapped in try-catch (non-fatal if classify spawn fails).

Remove: the guard that checks for `prs` in params.

#### 4. Remove classify wait hack

**File**: `src/worker.ts` — `runClassify` method

**Intent**: Remove the 3-minute `step.sleep("wait-for-syncs")` since classify is now spawned after sync-repo completes.

**Contract**: Remove the single `step.sleep("wait-for-syncs", "3 minutes")` line. The rest of `runClassify` is unchanged.

#### 5. Clean up dispatcher-only declarations

**File**: `src/worker.ts` — `runDispatch` method

**Intent**: Remove the inline `RepoTarget` interface that is no longer needed after dispatcher simplification.

**Contract**: Remove the `RepoTarget` interface declared inside `runDispatch` (used only by the old PR-listing loop). Top-level imports stay unchanged — `getGitHubToken` and `makeOctokit` are still used by `runSyncRepo`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx tsc --noEmit`
- Test type checking passes: `npm run test:typecheck`
- Linting passes: `npm run lint`
- Build succeeds: `npm run build`
- Non-integration tests pass: `vitest run --exclude 'tests/integration/**'`

#### Manual Verification:

- Trigger manual sync from dashboard for a board with repos
- Workflow instances visible in Cloudflare dashboard: 1 dispatch + N sync-repo + N classify
- No "Too many subrequests" errors in logs
- Classify runs after sync-repo completes (check timestamps in Cloudflare Workflow dashboard)
- DB tables populated: `github_pull_requests`, `github_reviews`, `github_review_comments`, `thread_classifications` contain expected data
- `github_repos.last_synced_at` updated for all synced repos

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Dead Code Removal

### Overview

Remove `syncBoardGitHubData` and its exclusive dependencies from `github-sync.ts`. This function is not imported anywhere — the dashboard sync button triggers the Workflow, not this function.

### Changes Required:

#### 1. Remove dead function and types

**File**: `src/lib/services/github-sync.ts`

**Intent**: Remove unused code that has the same subrequest bug and adds confusion about the sync path.

**Contract**: Remove the following exports:

- `SyncResult` interface (line 39-45) — only used as return type of `syncBoardGitHubData`
- `SyncOptions` interface (line 47-55) — only used as parameter type of `syncBoardGitHubData`
- `syncBoardGitHubData` function (line 483-517) — dead code, not imported anywhere

Remove the `createGitHubClient` import from `@/lib/github` (line 3) — only used inside `syncBoardGitHubData`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx tsc --noEmit`
- Linting passes: `npm run lint`
- Build succeeds: `npm run build`
- No import errors (grep confirms no references to removed exports)

#### Manual Verification:

- Dashboard sync button still works (uses Workflow, not the removed function)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Hermetic Tests

### Overview

Add tests for `syncPrBatch` and `syncReviewCommentsForRepo` with stubbed Octokit and Supabase. These verify the data transformation and error handling logic — not the workflow orchestration (which relies on Cloudflare primitives untestable in Vitest).

### Changes Required:

#### 1. Tests for syncPrBatch

**File**: `tests/hermetic/sync-pr-batch.test.ts`

**Intent**: Verify GraphQL batching, review overflow pagination, Supabase write batching, and error handling (including "Too many subrequests" re-throw).

**Contract**: Hermetic test file using stubbed Octokit (`graphql` method) and Supabase client (`rpc`, `from().upsert()`). Test cases cover:

- Happy path: N PRs batched into ceil(N/500) GQL queries, sizes updated via RPC, reviews upserted
- Overflow pagination: PRs with >100 reviews trigger `buildBatchReviewPageQuery`, capped at `MAX_OVERFLOW_ROUNDS=2`
- GQL error handling: non-subrequest errors are caught gracefully, added to `errors` array, processing continues
- Subrequest error re-throw: errors containing "Too many subrequests" are re-thrown (not swallowed)
- Empty input: 0 PRs returns `{ reviews: 0, errors: [] }` with no external calls

#### 2. Tests for syncReviewCommentsForRepo

**File**: `tests/hermetic/sync-review-comments.test.ts`

**Intent**: Verify REST pagination, `maxPages` truncation with `nextSince` cursor, PR number-to-id mapping, and deduplication.

**Contract**: Hermetic test file using stubbed Octokit (`rest.pulls.listReviewCommentsForRepo`) and Supabase client (`from().select()`, `from().upsert()`). Test cases cover:

- Happy path: comments fetched, PR numbers resolved to IDs via `mapPrNumbersToIds`, rows upserted
- Pagination: multiple pages fetched until `response.data.length < 100`
- Truncation at `maxPages`: when page count hits `maxPages`, returns `nextSince` (last comment's `updated_at`) for resumption
- Unmapped PRs: comments referencing PRs not in the database are filtered out (not upserted)
- Empty result: no comments returns `{ comments: 0 }` with no `nextSince`
- Deduplication: duplicate comment IDs (from boundary overlap) are deduped before upsert

### Success Criteria:

#### Automated Verification:

- Tests pass: `vitest run tests/hermetic/sync-pr-batch.test.ts tests/hermetic/sync-review-comments.test.ts`
- Test type checking passes: `npm run test:typecheck`
- Linting passes on test files: `npm run lint`
- Pre-commit hooks pass (includes non-integration test run)

#### Manual Verification:

- Review test output for clear test names and assertions

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Hermetic Tests (Phase 3):

- `syncPrBatch` — GraphQL batching, overflow, error propagation, subrequest re-throw
- `syncReviewCommentsForRepo` — pagination, truncation, PR mapping, deduplication

### Manual Testing:

1. Trigger sync from dashboard button
2. Verify Cloudflare Workflow dashboard shows correct instance chain: dispatch → sync-repo(s) → classify(s)
3. Check logs for absence of "Too many subrequests" errors
4. Verify classify timestamps are after sync-repo completion
5. Spot-check DB tables for expected data

### What's NOT Tested:

- Workflow orchestration (`step.do`/`step.sleep` sequencing) — requires workerd runtime, not available in Vitest
- Subrequest budget compliance — verified by arithmetic (documented in plan) and manual workflow run
- First sync of supabase/supabase-scale repo — requires adding as a board repo and triggering sync

## Performance Considerations

- `step.sleep("1 second")` adds ~1s wall time per budget reset. For supabase/supabase-scale sync-repo: ~4 sleeps = ~4s overhead. Negligible vs the 13-minute total sync time.
- Multiple classify instances (one per repo) may redundantly classify some threads. The overlap is bounded by the time between the first and last sync-repo completing. For 3 repos of similar size, overlap is minimal. Upsert makes it safe.
- `maxPages` reduced from 45 to 25 means more review comment iterations for very large repos (2 iterations instead of 1 for supabase/supabase). Each adds 1 step.do + 1 step.sleep — well within the 1,024 step limit.

## Subrequest Budget Summary

| Phase                                          | Max subreqs/invocation                 | Headroom |
| ---------------------------------------------- | -------------------------------------- | -------- |
| Dispatch: list-board-repos + spawn             | **1**                                  | 98%      |
| Sync-repo: get-token + list PRs                | **≤27** (24 pages + upsert + token)    | 46%      |
| Sync-repo: PR details                          | **~31** (5 GQL × 6 + token)            | 38%      |
| Sync-repo: review comments (per iteration)     | **≤27** (25 pages + map + upsert)      | 46%      |
| Sync-repo: update-last-synced + spawn-classify | **≤2** (shares last review invocation) | —        |
| Classify: fetch + batch + store                | **~3-5**                               | 90%+     |

No invocation exceeds 31 subrequests. All phases have ≥36% headroom from the 50-subrequest ceiling.

## References

- Frame brief: `context/changes/bugfix/frame.md`
- Research: `context/changes/bugfix/research.md`
- Forensic analysis of PRs #44-#55: `context/changes/bugfix/research.md` §6
- Source: `src/worker.ts` (workflow orchestration), `src/lib/services/github-sync.ts` (sync functions)
- API route: `src/pages/api/github/sync.ts` (dashboard trigger — creates same Workflow)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Rebuild Workflow Orchestration

#### Automated

- [x] 1.1 Type checking passes (`npx tsc --noEmit`) — 2808142
- [x] 1.2 Test type checking passes (`npm run test:typecheck`) — 2808142
- [x] 1.3 Linting passes (`npm run lint`) — 2808142
- [x] 1.4 Build succeeds (`npm run build`) — 2808142
- [x] 1.5 Non-integration tests pass (`vitest run --exclude 'tests/integration/**'`) — 2808142

#### Manual

- [ ] 1.6 Trigger manual sync from dashboard for a board with repos
- [ ] 1.7 Workflow instances visible in Cloudflare dashboard: 1 dispatch + N sync-repo + N classify
- [ ] 1.8 No "Too many subrequests" errors in logs
- [ ] 1.9 Classify runs after sync-repo completes (check timestamps in Cloudflare Workflow dashboard)
- [ ] 1.10 DB tables populated correctly
- [ ] 1.11 `github_repos.last_synced_at` updated for all synced repos

### Phase 2: Dead Code Removal

#### Automated

- [ ] 2.1 Type checking passes (`npx tsc --noEmit`)
- [ ] 2.2 Linting passes (`npm run lint`)
- [ ] 2.3 Build succeeds (`npm run build`)
- [ ] 2.4 No import errors (`grep` confirms no references to removed exports)

#### Manual

- [ ] 2.5 Dashboard sync button still works

### Phase 3: Hermetic Tests

#### Automated

- [ ] 3.1 Hermetic tests pass (`vitest run tests/hermetic/sync-pr-batch.test.ts tests/hermetic/sync-review-comments.test.ts`)
- [ ] 3.2 Test type checking passes (`npm run test:typecheck`)
- [ ] 3.3 Linting passes on test files (`npm run lint`)
- [ ] 3.4 Pre-commit hooks pass

#### Manual

- [ ] 3.5 Review test output for clear test names and assertions
