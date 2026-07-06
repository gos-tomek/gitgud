# Fix GitHub Sync Workflow — Plan Brief

> Full plan: `context/changes/bugfix/plan.md`
> Frame brief: `context/changes/bugfix/frame.md`
> Research: `context/changes/bugfix/research.md`

## What & Why

The sync workflow crashes with "Too many subrequests" because individual workflow steps consume up to 47 of 50 allowed subrequests, and loops lack budget resets between iterations. Additionally, classify runs simultaneously with sync (timing hack), and the dispatcher itself can crash on first sync of multiple large repos. Nine prior incremental fixes (#47–#55) optimized budget math rather than restructuring around the hard constraint.

## Starting Point

Post-PR #55, the workflow is split into dispatch/sync-repo/classify, but three defects remain: (1) review comments loop has no `step.sleep` between iterations — second iteration crashes instantly, (2) classify spawned from dispatcher simultaneously with sync-repo via 3-minute sleep hack, (3) dispatcher lists PRs for ALL repos in one invocation — overflows on first sync of 2+ large repos.

## Desired End State

Every workflow instance stays well under the 50-subrequest limit (~28 max, 44%+ headroom). Each operation runs in its own instance with a fresh budget. The chain is: dispatch → sync-repo → orchestrate → prdetails + reviews → classify → classify-chunk. No timing hacks, no shared-budget crashes.

## Key Decisions Made

| Decision            | Choice                            | Why (1 sentence)                                                                                     | Source   |
| ------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------- | -------- |
| PR listing location | Own sync-repo instance            | Each instance gets fresh 50-sub budget; listing alone can use 20+ subs on large repos.               | Plan     |
| GQL enrichment      | Separate prdetails instances      | One per GQL_PRS_PER_QUERY (100) chunk — ~4-6 subs each, run concurrently.                            | Plan     |
| Review comments     | Chained reviews instances         | 25 pages per instance; chains via `since` cursor when truncated. Last instance finalizes.            | Plan     |
| Classify triggering | Last reviews instance spawns it   | No "wait for other instances" primitive in CF Workflows; reviews chain knows when sync is done.      | Plan     |
| Classify chunking   | Dispatcher + classify-chunk       | Each chunk of 20 threads gets own instance + Workers AI budget. Recursive dispatcher for >45 chunks. | Plan     |
| syncBoardGitHubData | Remove (dead code)                | Not imported anywhere; dashboard button uses the Workflow, not this function.                        | Plan     |
| Rate limit guards   | Skip                              | 6-14% of GitHub's 5,000/hr budget used worst-case; each check costs a subrequest.                    | Research |
| Testing             | Hermetic tests for sync functions | Workflow orchestration (step.do/step.sleep) can't run in Vitest; sync function logic can.            | Plan     |

## Scope

**In scope:**

- Rebuild dispatcher (lightweight — Supabase only, no GitHub calls)
- Self-contained sync-repo (lists own PRs, spawns classify)
- Budget resets between review comment iterations
- Remove classify 3-minute sleep hack
- Remove dead `syncBoardGitHubData` function
- Hermetic tests for `syncPrBatch` and `syncReviewCommentsForRepo`

**Out of scope:**

- Changing GQL_PRS_PER_QUERY (stays at 100)
- Modifying sync functions in `github-sync.ts`
- Rate limit guards
- Workflow-level integration tests (requires workerd)

## Architecture / Approach

```
Cron/Button → DISPATCH (~1 subreq)
                └── spawn N × SYNC-REPO (~27 subreqs: list + upsert PRs)
                      └── spawn ORCHESTRATE (~3 subreqs: read PR refs from DB)
                            ├── spawn M × PRDETAILS (~4-6 subreqs each, concurrent)
                            └── spawn REVIEWS (~28 subreqs: 25 REST pages)
                                 ├── if truncated → chain next REVIEWS (since=cursor)
                                 └── if done → update last_synced + spawn CLASSIFY
                                       └── CLASSIFY dispatcher (~3 subreqs)
                                            ├── spawn K × CLASSIFY-CHUNK (~3 subreqs each)
                                            └── if >45 chunks → recursive CLASSIFY
```

Sync functions (`syncPrBatch`, `syncReviewCommentsForRepo`, `listAndUpsertPrsForRepo`) are unchanged — only the orchestration in `worker.ts` changes.

## Phases at a Glance

| Phase                             | What it delivers                                                              | Key risk                                                                               |
| --------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 1. Rebuild workflow orchestration | **DONE (280dd0b)** — all three defects fixed via instance-per-operation chain | Verified: no crashes, correct ordering, all DB tables populated.                       |
| 2. Dead code removal              | Remove `syncBoardGitHubData` + unused types/imports                           | Minimal risk — grep confirms no references.                                            |
| 3. Hermetic tests                 | Tests for `syncPrBatch` and `syncReviewCommentsForRepo`                       | Stubbing Octokit GraphQL responses requires matching the actual GitHub response shape. |

**Prerequisites:** Working Cloudflare Workers dev environment for manual testing of Phase 1.
**Estimated effort:** ~1-2 sessions across 3 phases.

## Open Risks & Assumptions

- Multiple classify instances (one per repo) may redundantly classify some threads if sync-repos finish close together — safe via upsert but wastes AI calls. Acceptable for ≤6 repos.
- `listAndUpsertPrsForRepo` with `Infinity` cap on a repo with >4,800 updated PRs in the since window would overflow the 50-subrequest budget in a single step.do. No known repo approaches this scale.

## Success Criteria (Summary)

- Sync workflow completes without "Too many subrequests" errors for boards with 3 repos
- Classify sees all synced data (runs after sync, not concurrently)
- DB tables populated identically to current behavior (same data, different orchestration)
