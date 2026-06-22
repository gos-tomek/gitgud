<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Classification Batch

- **Plan**: context/changes/classification-batch/plan.md
- **Scope**: All Phases (1–5)
- **Date**: 2026-06-22
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 5 warnings, 3 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | WARNING |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

## Findings

### F1 — Plan not updated after schema narrowing

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/classification-batch/plan.md
- **Detail**: The plan specifies a 5-field schema (intent, domain, constructive, knowledge_direction, confidence) with 6 intent values. The actual implementation ships 2 fields (intent, domain) with 10 intent values (adding praise, joke, self-review, unknown). The change.md Notes section documents this narrowing, and the voting migration (20260621120000) is explicitly justified — but the plan's Phase 2/3 specs and types.ts contract were never retroactively updated.
- **Fix**: Add an addendum section to plan.md (after "Open Risks") noting the empirical narrowing: 5→2 fields, 6→10 intents, majority-vote addition. Reference the change.md note and migration 20260621.
- **Decision**: FIXED — addendum added to plan.md after "Open Risks & Assumptions"

### F2 — Sync decomposed into per-repo durable steps (undocumented)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/worker.ts:96–170
- **Detail**: The plan described a single sync-github-data durable step calling syncBoardGitHubData. The implementation decomposes sync into per-repo steps (list-prs, check-rate-limit, sync-pr-details, sync-review-comments, update-last-synced) with rate-limit-aware sleepUntil gates. This is a strict improvement — partial failures don't lose all sync progress. But the Workflow step map in plan.md Phase 4 §3 no longer matches the code.
- **Fix**: Append an addendum to plan.md Phase 4 noting the per-repo step decomposition and the rate-limit gates. No code change needed.
- **Decision**: FIXED — addendum added to plan.md Phase 4, item 5

### F3 — 13 unplanned files in diff

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Scope Discipline
- **Location**: N/A (multiple files)
- **Detail**: 13 files changed that the plan does not mention: 3 new migrations (unclassified_threads_rpc, service_role_pat_access, github_repos_last_synced_at), 1 schema-narrowing migration (20260621120000), 1 new API endpoint (sync/status.ts), updated UI (SyncIndicator.tsx, CreateBoardForm.tsx), impact-metrics.ts adjustments, CI config (ci.yml, deploy.yml), and 3 test files. All extras are infrastructure discovered during implementation, test coverage, or CI adjustments — none are feature creep.
- **Fix A ⭐ Recommended**: Document in a plan addendum
  - Strength: Preserves the work and updates the source of truth. All extras are justified and necessary.
  - Tradeoff: Plan becomes a post-hoc record, not a pre-hoc guide.
  - Confidence: HIGH — change.md already documents the key pivot.
  - Blind spot: None significant.
- **Fix B**: Leave as-is, plan is effectively frozen
  - Strength: No churn on a closed-out plan.
  - Tradeoff: Future reviewer sees a stale plan.
  - Confidence: MEDIUM — depends on whether anyone re-reads this plan.
  - Blind spot: If a follow-up change references the plan, the gaps could cause confusion.
- **Decision**: FIXED via Fix A — unplanned-files list added to plan.md Addendum section

### F4 — AI Gateway ID differs from plan

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/services/classification.ts:295
- **Detail**: Plan specified gateway id "gitgud-classification" for AI Gateway routing. Implementation uses "default". This affects which AI Gateway dashboard panel shows classification analytics.
- **Fix**: Change the gateway id from "default" to "gitgud-classification" in the ai.run() call, matching the plan's intent for a dedicated classification analytics channel.
- **Decision**: ACCEPTED (no code change) — kept "default" intentionally; GitGud is self-hosted per-user, and a named gateway ID would require every deployer to create it manually before first use. Documented as an addendum in plan.md Phase 3 §3.

### F5 — Sync status endpoint silently swallows errors

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/github/sync/status.ts:75,100
- **Detail**: The GET and DELETE handlers' catch blocks return error responses but don't log the error. Other API routes in the project use logger.error() for unexpected exceptions. The DELETE handler is particularly concerning — a binding misconfiguration would be invisible in logs.
- **Fix**: Add logger.error() in both catch blocks, matching the pattern in src/pages/api/github/sync.ts.
- **Decision**: FIXED — logger.error("[sync-status]", err) added to GET (line 75-76) and DELETE (line 100-102) catch blocks

### F6 — PR listing step not chunked per-repo

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/worker.ts:105–122
- **Detail**: The sync-list-prs step iterates all repos sequentially in one durable step with POSITIVE_INFINITY PR cap. For a first-ever sync of a board with many active repos, this single step could make thousands of API requests. If it fails midway, all listing progress is lost and the step retries from scratch. PR detail enrichment is properly chunked, but the listing phase is not. No fix needed now — rate-limit gates on subsequent steps mitigate the risk. Worth revisiting if boards with 10+ repos become common.
- **Decision**: FIXED (anyway) — split `sync-list-prs` into one durable step per repo (`sync-list-prs-${r}` in src/worker.ts), matching the per-repo pattern already used for rate-limit checks, PR detail sync, review comment sync, and last-synced updates.

### F7 — SyncIndicator poll timeout silently succeeds

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/impact/SyncIndicator.tsx:42–53
- **Detail**: If the 120s polling deadline expires while status is still "running", the code falls through without setting an error state, calling onSyncComplete() with potentially stale data. Edge case — Workflows typically complete well within 120s for normal boards.
- **Decision**: FIXED — `pollUntilDone` now returns whether the sync reached "complete"; `onSyncComplete()` only fires on true. Timeout while still "running" sets a "Sync timed out" error instead of silently succeeding.

### F8 — No timeout on Workers AI calls

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/classification.ts:295
- **Detail**: The ai.run() call has no explicit timeout. A hung Workers AI backend would block the batch until the Worker runtime's own timeout fires. Retry logic handles transient failures but not hangs. The Workflow's durable step timeout is a backstop, so the practical risk is low.
- **Decision**: FIXED — `ai.run()` raced against a 30s timeout (`CLASSIFICATION_AI_RUN_TIMEOUT_MS`) in `callClassificationBatch`; a hang now throws and falls into the existing retry loop instead of blocking until the Worker runtime's own limit fires.
