# Frame Brief: GitHub Sync Workflow Subrequest Crashes

> Framing step before /10x-plan. This document captures what is _actually_
> at issue, separated from what was initially assumed.

## Reported Observation

GitHub sync workflow (`classification-batch`) crashes with "Too many subrequests by single Worker invocation" on the `sync-review-comments-0` step. The classify workflow completes before sync-repo finishes (seeing empty data). Nine prior incremental fixes (#47–#55) each shifted the crash point without eliminating it. Code complexity has increased with each attempt.

## Initial Framing (preserved)

- **User's stated cause or approach**: The workflow architecture is fundamentally wrong — heavy data operations (PR details, review comments) shouldn't run as monolithic steps within a single workflow instance.
- **User's proposed direction**: Chain-based workflow decomposition with separate workflow instances per data-loading phase, chunked into smaller units.
- **Pre-dispatch narrowing**: Both the subrequest crash and the chain ordering bug are equally important blockers. The user explicitly chose a rebuild approach over another incremental fix.

## Dimension Map

The observation could originate at any of these dimensions:

1. **Per-step subrequest budget math** — `syncReviewCommentsForRepo(maxPages=45)` needs up to 47 subrequests (1 mapPrNumbersToIds + 45 REST pages + 1 upsert) within a single `step.do`. The 50-subrequest budget leaves only 3 headroom.
2. **Missing budget resets between pagination steps** — the review-comments loop at `worker.ts:198-213` runs consecutive `step.do` calls without `step.sleep` between them. All iterations share one invocation's 50-subrequest budget. If step 0 uses 47, step 1 starts with 3 remaining and crashes instantly. ← **proximate cause of the crash**
3. **Workflow decomposition granularity** — heavy data operations (sync-pr-details: ~30 subrequests, sync-review-comments: ~47 each) run as monolithic `step.do` calls within a single sync-repo workflow instance. ← **user's framing**
4. **Chain ordering** — dispatcher (`worker.ts:135-172`) spawns sync-repo AND classify simultaneously. Classify's 3-minute sleep (`worker.ts:229`) is a timing hack, not a real dependency.
5. **GitHub API batch size** — `GQL_PRS_PER_QUERY=500` causes 504 timeouts from GitHub (14+ PRs failed in `sync-pr-details`). Separate from subrequest crashes but causes data gaps.

## Hypothesis Investigation

| Hypothesis                                       | Evidence                                                                                                                                                                                                                                                                   | Verdict                                              |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| 1. Per-step budget math (47/50)                  | `sync-review-comments-0` ran 40s before "Too many subrequests" error — matches ~40 REST pages + overhead exhausting budget. `github-sync.ts:113-115` comments confirm design target of 47.                                                                                 | STRONG                                               |
| 2. No budget reset between pagination iterations | `worker.ts:198-213`: loop has `runStep` (step.do) but no `step.sleep`. After step 0 uses 47, step 1 gets 3. Step-level retries (6 attempts, each 7s) are within same invocation — budget never resets.                                                                     | STRONG                                               |
| 3. Workflow granularity (user's framing)         | Current arch already split into dispatch/sync-repo/classify (#55). But within sync-repo, two heavy phases (PR details + review comments) run sequentially with only 1s sleep budget reset. Adding separate workflow instances per chunk would give each a fresh 50 budget. | MEDIUM — valid direction but not the proximate cause |
| 4. Chain ordering bug                            | Dispatcher output shows `spawned: ["sync-...", "classify-..."]` simultaneously. Classify completed in 3 min (sleep + empty `[]` fetch). sync-repo ran 13 min before crashing. Classify saw no data because sync wasn't done.                                               | STRONG                                               |
| 5. GitHub API batch size (504s)                  | 14+ PRs returned 504 in sync-pr-details. GQL_PRS_PER_QUERY=500 is aggressive. Causes data gaps but sync-pr-details step still completed. Not the cause of the crash.                                                                                                       | WEAK (for crash); MEDIUM (for data completeness)     |

## Narrowing Signals

- **Step-level retries don't reset subrequest budget**: The 6 retry attempts for `sync-review-comments-0` each failed in 7 seconds — proving that retries share the original invocation's exhausted budget. Only a `step.sleep` (or a new workflow instance) resets it.
- **9 prior PRs (#47–#55)**: Each fix added budget-management complexity (batch writes, overflow caps, per-chunk sleeps, chain split). Each shifted the crash point rather than eliminating the constraint. The repo history itself is evidence that incremental patching hasn't stabilized.
- **sync-pr-details works fine**: At ~30 subrequests (6 GQL batches × 5), it has 20 headroom. This phase is not at risk of crashing — only review-comments overflows the budget.

## Cross-System Convention

Cloudflare Workflow's step.do replay returns cached results without external calls — so adding more steps and sleeps doesn't cost subrequests on replay (only time). The standard pattern for budget-constrained workflows is: do bounded work per step, sleep to reset, continue. An alternative pattern is to spawn child workflow instances per work unit (each gets a fresh budget). Both are valid; the choice depends on how predictable the per-step work size is. With variable-length REST pagination, the child-workflow approach is more robust because it doesn't require tuning maxPages to fit exactly under 50.

## Reframed (or Confirmed) Problem Statement

> **The actual problem to plan around is**: Individual workflow steps consume too many subrequests (47/50 with no margin), and the pagination loop lacks budget resets between iterations — causing cascading failures that 9 prior incremental fixes have failed to eliminate because they optimized the budget math rather than restructuring around the hard constraint.

The user's proposed direction (chain decomposition) is a valid solution path, but it addresses a symptom-level framing ("the architecture needs more workflows") rather than the root constraint: **any `step.do` that makes a variable number of external calls cannot safely approach the 50-subrequest ceiling**. Whether the fix is `step.sleep` between iterations (minimal) or separate workflow instances per chunk (rebuild), the principle is the same: each unit of work must have a predictable, bounded subrequest cost with margin.

The chain ordering bug is a separate, confirmed defect: classify must be spawned from sync-repo's final step, not from the dispatcher.

## Confidence

- **HIGH** — strong evidence on dimensions 1, 2, and 4. Budget math is arithmetic, not hypothesis. The 47/50 budget and missing sleep between iterations directly explain the crash. Chain ordering is visible in dispatcher output.

## What Changes for /10x-plan

The plan should address three concrete defects:

1. **Subrequest budget overflow**: Ensure each `step.do` stays well under 50 subrequests (margin ≥ 10). This can be achieved via smaller maxPages + `step.sleep` between iterations, or via separate workflow instances per chunk.
2. **Chain ordering**: Move classify spawning from dispatcher to sync-repo's final step (after `update-last-synced`).
3. **GitHub API timeouts**: Reduce GQL_PRS_PER_QUERY from 500 (causes 504s) to a safer batch size.

The user has chosen a rebuild approach over incremental patching. The plan should respect this while scoping the rebuild to the actual constraints — not adding unnecessary workflow instances where `step.sleep` suffices.

## References

- Source files: `src/worker.ts:135-172` (dispatcher spawning), `src/worker.ts:198-213` (review comments loop), `src/lib/services/github-sync.ts:106-185` (syncReviewCommentsForRepo), `src/lib/services/github-sync.ts:298-481` (syncPrBatch)
- Workflow runs: `sync-8f1aab07-...-2026-06-30` (errored), `board-b411662f-...-2026-06-30-1782811794396` (completed), `classify-b411662f-...-2026-06-30` (completed, empty data)
- Git history: PRs #47–#55 (9 incremental subrequest fixes)
- Related research: none yet (skipped /10x-research — evidence from workflow run logs was sufficient)
