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
- `syncBoardGitHubData` (github-sync.ts:641-675) — dead code, not imported anywhere, has the same subrequest bug at scale

## Desired End State

Every workflow invocation stays well under the 50-subrequest free-plan limit. The dispatcher makes exactly 1 external call (Supabase query). PR listing, enrichment, and review comment sync each run in their own workflow instance with a fresh subrequest budget. Classify runs after sync completes — no timing hacks. Large classify workloads are chunked into separate instances with a recursive dispatcher pattern.

Verification: trigger a manual sync for a board with 3 repos. All phases complete without "Too many subrequests" errors. Classify sees all synced data. DB tables populated identically to current behavior.

## What We're NOT Doing

- Changing `GQL_PRS_PER_QUERY` (stays at 100 — fits in one invocation at ~4-6 subrequests per chunk)
- Modifying sync functions in `github-sync.ts` (`syncPrBatch`, `syncReviewCommentsForRepo`, `listAndUpsertPrsForRepo`)
- Adding rate-limit guards (6-14% of GitHub's 5,000/hr budget used worst-case)
- Fixing the non-workflow `syncBoardGitHubData` (removing it instead — it's dead code)
- Adding workflow-level integration tests (Cloudflare's `step.do`/`step.sleep` can't run in Vitest)

## Implementation Approach

Decompose the monolithic sync-repo into a chain of single-responsibility workflow instances, each with its own fresh 50-subrequest budget. The chain is: dispatch → sync-repo (list PRs) → orchestrate (read PR refs from DB, spawn children) → prdetails (GQL enrichment per chunk) + reviews (review comments, chains if truncated, finalizes with update-last-synced + spawn classify) → classify dispatcher → classify-chunk.

This eliminates subrequest overflows structurally — no instance needs more than ~30 subrequests — rather than relying on `step.sleep` budget resets within a single instance. Fire-and-forget spawning avoids the need for `.get()`/`.status()` polling (which itself burns subrequests).

The three fixes are interdependent (all touch the same orchestration code in `worker.ts`), so they ship as a single phase. Dead code removal and hermetic tests follow as separate phases.

---

## Phase 1: Rebuild Workflow Orchestration (COMPLETED — 280dd0b)

### Overview

Decomposed the monolithic workflow into a chain of single-responsibility instances. Instead of sync-repo doing everything in one invocation with `step.sleep` budget resets, each operation now runs in its own workflow instance with a fresh 50-subrequest budget.

### Architecture (as implemented)

```
dispatch (1 Supabase query)
  └─ spawn N × sync-repo (list + upsert PRs for one repo)
       └─ spawn 1 × orchestrate (read PR refs from DB, spawn children)
            ├─ spawn M × prdetails (GQL enrichment for one chunk of GQL_PRS_PER_QUERY PRs)
            └─ spawn 1 × reviews (review comments, 25 REST pages per instance)
                 ├─ if truncated → chain to next reviews instance (since=cursor)
                 └─ if done → update-last-synced + spawn classify

classify (dispatcher — fetch unclassified thread IDs, chunk, spawn children)
  ├─ spawn K × classify-chunk (classify one batch of 20 threads via Workers AI)
  └─ if >45 chunks → spawn recursive classify dispatcher for remainder
```

### Changes Made:

#### 1. Simplified dispatcher (`runDispatch`)

**File**: `src/worker.ts:114-153`

Removed all GitHub interaction. Makes 1 Supabase query (`list-board-repos`), computes `since` per repo from `last_synced_at`, spawns sync-repo instances. Uses ms-precision `syncStamp` (not per-day `dateStamp`) so same-day re-syncs get unique child IDs.

#### 2. Expanded ClassificationBatchParams

**File**: `src/worker.ts:20-38`

Replaced `prs?: PrRef[]` with granular fields for the new phases: `prChunk`, `chunkIndex`, `reviewPageIndex`, `threadRootIds`, `threadChunk`. Added `orchestrate`, `prdetails`, `reviews`, `classify-chunk` to the `phase` union.

#### 3. Split sync-repo into sync-repo + orchestrate + prdetails + reviews

**Files**: `src/worker.ts:158-395`

- **sync-repo** (`runSyncRepo`, line 158): Lists + upserts PRs via `listAndUpsertPrsForRepo`. If 0 PRs, short-circuits to update-last-synced + spawn classify. Otherwise spawns one `orchestrate` instance.
- **orchestrate** (`runOrchestrate`, line 221): Re-reads PR refs from DB (paginated), chunks by `GQL_PRS_PER_QUERY`, spawns N `prdetails` instances + 1 `reviews` instance. Fire-and-forget — no polling.
- **prdetails** (`runPrDetails`, line 298): Enriches one chunk of PRs via `syncPrBatch`. Own invocation = own budget (~4-6 subrequests per chunk).
- **reviews** (`runReviews`, line 318): Syncs review comments via `syncReviewCommentsForRepo` with `maxPages=25`. If truncated (`nextSince` returned), chains to next `reviews` instance. When done (not truncated), finalizes: `update-last-synced` + `spawn-classify`. Classify spawn is try-caught (non-fatal).

#### 4. Rebuilt classify as dispatcher + chunk pattern

**Files**: `src/worker.ts:401-487`

- **classify** (`runClassify`, line 401): Fetches unclassified thread IDs (paginated, 1000 per page), chunks by `CLASSIFICATION_BATCH_SIZE=20`, spawns up to `CLASSIFY_MAX_SPAWNS_PER_DISPATCHER=45` `classify-chunk` instances. If more chunks remain, spawns a recursive classify dispatcher with remaining IDs.
- **classify-chunk** (`runClassifyChunk`, line 462): Classifies one batch of threads via `classifyThreads` (Workers AI) and upserts results.

#### 5. Added shared helpers

**File**: `src/worker.ts:48-89`

- `chunk<T>()` — generic array chunking
- `describeError()` — error serialization (handles non-Error objects)
- `runStep()` — wrapper around `step.do` with structured error logging

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx tsc --noEmit`
- Test type checking passes: `npm run test:typecheck`
- Linting passes: `npm run lint`
- Build succeeds: `npm run build`
- Non-integration tests pass: `vitest run --exclude 'tests/integration/**'`

#### Manual Verification:

- Trigger manual sync from dashboard for a board with repos
- Workflow instances visible in Cloudflare dashboard: 1 dispatch + N sync-repo + N orchestrate + M prdetails + N reviews chains + classify dispatchers + K classify-chunks
- No "Too many subrequests" errors in logs
- Classify runs after sync-repo completes (check timestamps in Cloudflare Workflow dashboard)
- DB tables populated: `github_pull_requests`, `github_reviews`, `github_review_comments`, `thread_classifications` contain expected data
- `github_repos.last_synced_at` updated for all synced repos

---

## Phase 2: Dead Code Removal

### Overview

Remove `syncBoardGitHubData` and its exclusive dependencies from `github-sync.ts`. This function is not imported anywhere — the dashboard sync button triggers the Workflow, not this function.

### Changes Required:

#### 1. Remove dead function and types

**File**: `src/lib/services/github-sync.ts`

**Intent**: Remove unused code that has the same subrequest bug and adds confusion about the sync path.

**Contract**: Remove the following exports:

- `SyncResult` interface (line 67-73) — only used as return type of `syncBoardGitHubData`
- `SyncOptions` interface (line 75-83) — only used as parameter type of `syncBoardGitHubData`
- `syncBoardGitHubData` function (line 641-675) — dead code, not imported anywhere

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
2. Verify Cloudflare Workflow dashboard shows correct instance chain: dispatch → sync-repo → orchestrate → prdetails + reviews → classify → classify-chunk
3. Check logs for absence of "Too many subrequests" errors
4. Verify classify timestamps are after reviews completion
5. Spot-check DB tables for expected data

### What's NOT Tested:

- Workflow orchestration (`step.do`/`step.sleep` sequencing) — requires workerd runtime, not available in Vitest
- Subrequest budget compliance — verified by arithmetic (documented in plan) and manual workflow run
- First sync of supabase/supabase-scale repo — requires adding as a board repo and triggering sync

## Performance Considerations

- Each phase spawns a new workflow instance (~100ms overhead per spawn). For a board with 3 repos: ~10-15 instances total. Negligible vs the sync time.
- prdetails chunks run concurrently (fire-and-forget from orchestrate). M chunks of 100 PRs each run in parallel, bounded only by Cloudflare's concurrent instance limit.
- Reviews chain sequentially (each 25-page instance spawns the next). For supabase/supabase: ~2 review instances. Acceptable latency.
- Multiple classify instances (one per repo's reviews chain) may redundantly classify some threads. Upsert makes overlap safe.
- classify-chunk instances run concurrently (fire-and-forget from classify dispatcher). Up to 45 chunks per dispatcher; recursive dispatcher handles overflow.

## Subrequest Budget Summary

Each phase runs in its own workflow instance with a fresh 50-subrequest budget.

| Instance                          | Max subreqs/invocation                               | Headroom |
| --------------------------------- | ---------------------------------------------------- | -------- |
| Dispatch                          | **~1** (1 Supabase query + N binding spawns)         | 98%      |
| Sync-repo (list + upsert PRs)     | **≤27** (REST pagination + upsert + token)           | 46%      |
| Orchestrate (read refs + spawn)   | **~2-3** (paginated DB read + binding spawns)        | 94%      |
| Prdetails (per chunk)             | **~4-6** (1 token + 1 GQL + overflow + RPC + upsert) | 88%      |
| Reviews (per 25-page iteration)   | **≤28** (1 token + 25 pages + map + upsert)          | 44%      |
| Reviews (finalize, last instance) | **+2** (update-last-synced + spawn-classify)         | —        |
| Classify dispatcher               | **~2-3** (1 DB query + binding spawns)               | 94%      |
| Classify-chunk                    | **~3** (1 AI call + 1 upsert)                        | 94%      |

No invocation exceeds ~28 subrequests. All phases have ≥44% headroom from the 50-subrequest ceiling.

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

- [x] 1.6 Trigger manual sync from dashboard for a board with repos — 280dd0b
- [x] 1.7 Workflow instances visible in Cloudflare dashboard: dispatch + sync-repo + orchestrate + prdetails + reviews + classify — 280dd0b
- [x] 1.8 No "Too many subrequests" errors in logs — 280dd0b
- [x] 1.9 Classify runs after sync-repo completes (check timestamps in Cloudflare Workflow dashboard) — 280dd0b
- [x] 1.10 DB tables populated correctly — 280dd0b
- [x] 1.11 `github_repos.last_synced_at` updated for all synced repos — 280dd0b

### Phase 2: Dead Code Removal

#### Automated

- [x] 2.1 Type checking passes (`npx tsc --noEmit`)
- [x] 2.2 Linting passes (`npm run lint`)
- [x] 2.3 Build succeeds (`npm run build`)
- [x] 2.4 No import errors (`grep` confirms no references to removed exports)

#### Manual

- [x] 2.5 Dashboard sync button still works

### Phase 3: Hermetic Tests

#### Automated

- [x] 3.1 Hermetic tests pass (`vitest run tests/hermetic/sync-pr-batch.test.ts tests/hermetic/sync-review-comments.test.ts`)
- [x] 3.2 Test type checking passes (`npm run test:typecheck`)
- [x] 3.3 Linting passes on test files (`npm run lint`)
- [x] 3.4 Pre-commit hooks pass

#### Manual

- [x] 3.5 Review test output for clear test names and assertions

#### Automated (scope extension, added during review discussion)

- [x] 3.6 Subrequest-budget hermetic tests for Sync-repo/Prdetails/Reviews/Classify-chunk (`list-and-upsert-prs.test.ts`, `sync-pr-batch.test.ts`, `sync-review-comments.test.ts`, `classification-voting.test.ts`) — each asserts worst-case external-request count stays under the 50-subrequest free-plan limit
- [x] 3.7 AI majority-vote hermetic tests (`classification-voting.test.ts`) — 2-of-3 agreement, 3-way split/invalid-domain drop, out-of-enum category from AI, non-JSON AI response exhausting retries
