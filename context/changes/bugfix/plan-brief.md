# Fix GitHub Sync Workflow — Plan Brief

> Full plan: `context/changes/bugfix/plan.md`
> Frame brief: `context/changes/bugfix/frame.md`
> Research: `context/changes/bugfix/research.md`

## What & Why

The sync workflow crashes with "Too many subrequests" because individual workflow steps consume up to 47 of 50 allowed subrequests, and loops lack budget resets between iterations. Additionally, classify runs simultaneously with sync (timing hack), and the dispatcher itself can crash on first sync of multiple large repos. Nine prior incremental fixes (#47–#55) optimized budget math rather than restructuring around the hard constraint.

## Starting Point

Post-PR #55, the workflow is split into dispatch/sync-repo/classify, but three defects remain: (1) review comments loop has no `step.sleep` between iterations — second iteration crashes instantly, (2) classify spawned from dispatcher simultaneously with sync-repo via 3-minute sleep hack, (3) dispatcher lists PRs for ALL repos in one invocation — overflows on first sync of 2+ large repos.

## Desired End State

Every workflow invocation stays under 30 subrequests (40% headroom). The dispatcher makes 1 external call (Supabase). Each sync-repo is fully self-contained: lists PRs, enriches them, syncs review comments with budget resets, and spawns classify after completing. No timing hacks, no shared-budget crashes.

## Key Decisions Made

| Decision                 | Choice                            | Why (1 sentence)                                                                                                                                 | Source   |
| ------------------------ | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| PR listing location      | Move from dispatcher to sync-repo | Dispatcher listing all repos in one invocation crashes at 50 subrequests on first sync of large repos.                                           | Plan     |
| GQL_PRS_PER_QUERY        | Keep at 500 (no change)           | 5 batches × 6 subreqs = 30 fits comfortably; reducing to 50 would require PR details chunking with 10× more queries for no crash-fixing benefit. | Plan     |
| Classify triggering      | Each sync-repo spawns classify    | No "wait for other instances" primitive in CF Workflows; per-repo spawn is simple and idempotent via upsert.                                     | Plan     |
| Review comments maxPages | Reduce from 45 to 25              | 27 subreqs/invocation (54%) vs 47 (94%) — provides 40% headroom matching research recommendation.                                                | Research |
| syncBoardGitHubData      | Remove (dead code)                | Not imported anywhere; dashboard button uses the Workflow, not this function.                                                                    | Plan     |
| Rate limit guards        | Skip                              | 6-14% of GitHub's 5,000/hr budget used worst-case; each check costs a subrequest.                                                                | Research |
| Testing                  | Hermetic tests for sync functions | Workflow orchestration (step.do/step.sleep) can't run in Vitest; sync function logic can.                                                        | Plan     |

## Scope

**In scope:**

- Rebuild dispatcher (lightweight — Supabase only, no GitHub calls)
- Self-contained sync-repo (lists own PRs, spawns classify)
- Budget resets between review comment iterations
- Remove classify 3-minute sleep hack
- Remove dead `syncBoardGitHubData` function
- Hermetic tests for `syncPrBatch` and `syncReviewCommentsForRepo`

**Out of scope:**

- Changing GQL_PRS_PER_QUERY (stays at 500)
- Modifying sync functions in `github-sync.ts`
- Rate limit guards
- Workflow-level integration tests (requires workerd)

## Architecture / Approach

```
Cron/Button → DISPATCH (1 subreq)
                ├── list repos from Supabase
                └── spawn N × SYNC-REPO instances (binding calls)
                      ├── list PRs (≤27 subreqs) → sleep → reset
                      ├── enrich PRs via GQL (~30 subreqs) → sleep → reset
                      ├── review comments loop (≤27 subreqs/iter, sleep between) → reset
                      ├── update last_synced
                      └── spawn CLASSIFY (binding call)
                            ├── fetch unclassified threads
                            └── classify + store in batches (~3-5 subreqs)
```

Sync functions (`syncPrBatch`, `syncReviewCommentsForRepo`, `listAndUpsertPrsForRepo`) are unchanged — only the orchestration in `worker.ts` changes.

## Phases at a Glance

| Phase                             | What it delivers                                                              | Key risk                                                                                                 |
| --------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 1. Rebuild workflow orchestration | All three defects fixed: no crashes, correct ordering, lightweight dispatcher | Largest code change — rewriting `runDispatch` and `runSyncRepo`. Requires manual workflow run to verify. |
| 2. Dead code removal              | Remove `syncBoardGitHubData` + unused types/imports                           | Minimal risk — grep confirms no references.                                                              |
| 3. Hermetic tests                 | Tests for `syncPrBatch` and `syncReviewCommentsForRepo`                       | Stubbing Octokit GraphQL responses requires matching the actual GitHub response shape.                   |

**Prerequisites:** Working Cloudflare Workers dev environment for manual testing of Phase 1.
**Estimated effort:** ~1-2 sessions across 3 phases.

## Open Risks & Assumptions

- Multiple classify instances (one per repo) may redundantly classify some threads if sync-repos finish close together — safe via upsert but wastes AI calls. Acceptable for ≤6 repos.
- `listAndUpsertPrsForRepo` with `Infinity` cap on a repo with >4,800 updated PRs in the since window would overflow the 50-subrequest budget in a single step.do. No known repo approaches this scale.

## Success Criteria (Summary)

- Sync workflow completes without "Too many subrequests" errors for boards with 3 repos
- Classify sees all synced data (runs after sync, not concurrently)
- DB tables populated identically to current behavior (same data, different orchestration)
