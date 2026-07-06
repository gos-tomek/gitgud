---
date: "2026-06-30T18:00:00+02:00"
researcher: Claude (10x-research)
git_commit: f62fdf646dddffc2b5b2cf5a43cef70c8b2268d9
branch: bugfix
repository: gitgud
topic: "GitHub API rate limits, GraphQL vs REST trade-offs, Cloudflare Workers/Workflows limits, and sync volume benchmark (supabase/supabase)"
tags:
  [
    research,
    github-api,
    rate-limits,
    graphql,
    rest,
    cloudflare-workers,
    cloudflare-workflows,
    subrequests,
    sync,
    benchmark,
  ]
status: complete
last_updated: "2026-06-30"
last_updated_by: Claude (10x-research)
last_updated_note: "Added §6: forensic analysis of 12 prior fix attempts (#44–#55)"
---

# Research: GitHub & Cloudflare Limits for Sync Workflow Redesign

**Date**: 2026-06-30T18:00:00+02:00
**Researcher**: Claude (10x-research)
**Git Commit**: f62fdf6
**Branch**: bugfix
**Repository**: gitgud

## Research Question

1. What are GitHub's rate limits for the data we sync (PRs, reviews, review comments)? Where should we use GraphQL vs REST to minimize requests?
2. What are ALL Cloudflare Workers/Workflows limits beyond the famous 50-subrequest cap? How can they be worked around on the free plan?
3. How large is a first sync of supabase/supabase (chosen as a "big active repo" benchmark)? What does a typical 2-board × 3-repo instance look like?

## Summary

The current hybrid approach (REST for PR listing + review comments, GraphQL for batch PR details + reviews) is already optimal — no phase benefits from switching. GitHub's rate limits are generous for our use case (~53 points per incremental sync per repo, out of 5,000/hour). The real constraints are Cloudflare's free-plan limits: **50 external subrequests per invocation** (resettable via `step.sleep`), **1,024 steps per workflow**, **1 MiB step result size**, **10ms CPU per step**, **5 cron triggers per account**, and **100 concurrent workflow instances**. A supabase/supabase-scale first sync needs ~114 API requests per repo (with GraphQL-nested reviews), or ~684 for a 6-repo instance — well within GitHub's rate budget but requiring careful subrequest budget management across Cloudflare workflow steps.

---

## 1. GitHub API Rate Limits

### 1.1 Primary Rate Limits (per hour, authenticated PAT)

| API                        | Budget                       | Unit                             |
| -------------------------- | ---------------------------- | -------------------------------- |
| REST                       | 5,000                        | requests/hour                    |
| REST (Enterprise Cloud)    | 15,000                       | requests/hour                    |
| GraphQL                    | 5,000                        | points/hour                      |
| GraphQL (Enterprise Cloud) | 10,000                       | points/hour                      |
| GitHub App installation    | 5,000 base, scales to 12,500 | +50/hr per repo & user beyond 20 |
| GITHUB_TOKEN (Actions)     | 1,000                        | per repository                   |

### 1.2 Secondary Rate Limits

| Limit                                  | Value                                           |
| -------------------------------------- | ----------------------------------------------- |
| Concurrent requests                    | 100 max (shared REST + GraphQL)                 |
| REST points/minute                     | 900                                             |
| GraphQL points/minute                  | 2,000                                           |
| GET/HEAD cost (secondary)              | 1 point                                         |
| POST/PATCH/PUT/DELETE cost (secondary) | 5 points                                        |
| GraphQL query cost (secondary)         | 1 point                                         |
| GraphQL mutation cost (secondary)      | 5 points                                        |
| CPU time budget                        | 90s per 60s real time (60s of that for GraphQL) |
| Content-generating requests            | 80/min, 500/hr                                  |

### 1.3 GraphQL-Specific Limits

| Limit                         | Value                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------ |
| Max nodes per query           | 500,000                                                                              |
| `first`/`last` argument range | 1–100                                                                                |
| Query timeout                 | 10 seconds (returns 502/504, deducts penalty points)                                 |
| Resource limits (Sep 2025)    | Undisclosed thresholds; triggers `RESOURCE_LIMITS_EXCEEDED` on deeply nested queries |

**GraphQL point cost formula**: Sum all connection requests in the query (multiply nested connections), divide by 100, round up. Minimum 1 point.

**Example — our `syncPrBatch` with 500 PR aliases × `reviews(first:100)`**:

- Nodes: 500 PRs + 500 × 100 reviews = 50,500 (under 500k limit)
- Points: ceil(50,500 / 100) = **505 points per query**
- Risk: 500 aliases is aggressive for the 10-second timeout. Backstage project reported `RESOURCE_LIMITS_EXCEEDED` at ~5,000 nested records. Reducing to 50–100 PRs per query is safer (11–51 points each).

### 1.4 Conditional Requests (ETags)

REST supports `If-None-Match` / `If-Modified-Since` headers. **A 304 response does NOT count against the primary rate limit.** This is a free optimization for incremental sync polling of unchanged repos. GraphQL does not support conditional requests.

### 1.5 Rate Limit Error Handling

| Scenario                         | HTTP Status | Key Header                             |
| -------------------------------- | ----------- | -------------------------------------- |
| Primary limit hit                | 403 or 429  | `x-ratelimit-reset` (UTC epoch)        |
| Secondary limit hit              | 403 or 429  | `retry-after` (seconds)                |
| GraphQL timeout                  | 502 or 504  | Penalty points deducted from next hour |
| Continued requests while limited | **Ban**     | —                                      |

### 1.6 GitHub App vs PAT

For self-hosted GitGud instances with 20+ repos, a GitHub App installation token scales to 12,500 req/hr (vs flat 5,000 for PAT). This is a future optimization — current PAT approach is sufficient for the 6-repo scenario.

---

## 2. GraphQL vs REST — Per Sync Phase Analysis

### 2.1 Phase 1: PR Listing (`listPrsForRepo`)

|                               | REST (current)                           | GraphQL (alternative)                              |
| ----------------------------- | ---------------------------------------- | -------------------------------------------------- |
| Endpoint                      | `GET /repos/{o}/{r}/pulls`               | `repository { pullRequests(orderBy: UPDATED_AT) }` |
| `since` filter                | Server-side via sort + early termination | No server-side `since` — client-side only          |
| ETag support                  | Yes (free 304s)                          | No                                                 |
| Points per 100 PRs            | 1                                        | 1                                                  |
| Incremental cost (50 updated) | 1 request                                | 1 query                                            |

**Verdict: Keep REST.** Identical point cost, but REST has native `since` filtering and free ETag 304s on unchanged repos.

### 2.2 Phase 2: PR Details + Reviews (`syncPrBatch`)

|                 | GraphQL (current)                   | REST (alternative)                       |
| --------------- | ----------------------------------- | ---------------------------------------- |
| Approach        | Batched aliases, 500 PRs per query  | 2 REST calls per PR (get + list reviews) |
| For 1,000 PRs   | 2 queries, ~1,010 points            | 2,000 requests, 2,000 points             |
| Wall time       | ~2–4 seconds                        | 10+ minutes (sequential)                 |
| Partial failure | Returns data for successful aliases | Each request independent                 |

**Verdict: Keep GraphQL.** ~50% fewer rate limit points, orders of magnitude faster. Consider reducing batch size from 500 to 50–100 to avoid timeout/resource-limit risks.

### 2.3 Phase 3: Review Comments (`syncReviewCommentsForRepo`)

|                     | REST (current)                                  | GraphQL (alternative)                                                |
| ------------------- | ----------------------------------------------- | -------------------------------------------------------------------- |
| Endpoint            | `GET /repos/{o}/{r}/pulls/comments` (repo-wide) | No repo-wide equivalent — per-PR `reviewThreads` only                |
| `since` filter      | Server-side                                     | Not available                                                        |
| For 50 new comments | 1 request, 1 point                              | Per-PR queries, potentially thousands of points                      |
| Node count risk     | N/A                                             | 100 PRs × 100 threads × 100 comments = 1M nodes (exceeds 500k limit) |

**Verdict: Keep REST. Not even close.** The repo-wide REST endpoint with `since` is purpose-built for this use case. GraphQL would cost 1,000x more.

### 2.4 Rate Budget per Incremental Sync (1 repo, 50 updated PRs)

| Phase                                      | Points            |
| ------------------------------------------ | ----------------- |
| PR listing (1 REST page)                   | 1                 |
| PR details + reviews (1 GQL query, 50 PRs) | 51                |
| Review comments (1–2 REST pages)           | 1–2               |
| **Total**                                  | **~53–54 points** |

At 5,000 points/hour → supports **~90 repo syncs per hour** with comfortable headroom.

---

## 3. Cloudflare Workers/Workflows Limits (Free Plan)

### 3.1 Worker Limits

| Limit                             | Free            | Paid                        |
| --------------------------------- | --------------- | --------------------------- |
| CPU time (HTTP request)           | **10 ms**       | 30s (configurable to 5 min) |
| CPU time (Cron trigger)           | **10 ms**       | 30s / 15 min                |
| Memory                            | 128 MB          | 128 MB                      |
| Request body size                 | 100 MB          | 100 MB                      |
| Worker size (compressed)          | 3 MB            | 10 MB                       |
| Number of Workers                 | 100             | 500                         |
| Environment variables             | 64 (5 KB each)  | 128                         |
| **Cron triggers per account**     | **5**           | 250                         |
| Simultaneous outgoing connections | 6               | 6                           |
| **Daily requests**                | **100,000/day** | Unlimited                   |

### 3.2 Workflow-Specific Limits

| Limit                        | Free         | Paid                            |
| ---------------------------- | ------------ | ------------------------------- |
| **Steps per instance**       | **1,024**    | 10,000 (configurable to 25,000) |
| **Step result size**         | **1 MiB**    | 1 MiB                           |
| **Event payload size**       | **1 MiB**    | 1 MiB                           |
| CPU time per step            | 10 ms        | 30s (configurable to 5 min)     |
| **Concurrent instances**     | **100**      | 50,000                          |
| Instance creation rate       | 100/sec      | 300/sec                         |
| Queued instances             | 100,000      | 2,000,000                       |
| Persisted state per instance | 100 MB       | 1 GB                            |
| **State retention**          | **3 days**   | 30 days                         |
| step.sleep max duration      | 365 days     | 365 days                        |
| step.do timeout max          | 30 minutes   | 30 minutes                      |
| Max retries per step         | 10,000       | 10,000                          |
| createBatch max              | 100 per call | 100 per call                    |

**`step.sleep` does NOT count toward the step limit.**

### 3.3 Subrequest Details

**Two separate caps on free plan:**

- **50 external subrequests** per invocation (fetch to GitHub, Supabase, etc.)
- **1,000 Cloudflare service subrequests** per invocation (KV, D1, R2, bindings)

**Paid plan:** 10,000 total (configurable to 10M via `[limits] subrequests`).

**Per-invocation, NOT per-instance:** The limit applies to a single Worker invocation. `step.sleep` forces hibernation → new invocation → fresh budget. This is the key workaround.

**`workflow.create()` likely counts against the 1,000 Cloudflare-service cap**, not the 50 external cap (it's a binding call). Not officially documented.

### 3.4 Critical Constraints for GitGud

| Constraint                  | Impact                                                        | Workaround                                                                     |
| --------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 50 external subrequests     | Each step.do shares this budget within one invocation         | `step.sleep` between groups to reset; spawn child workflows                    |
| 1,024 steps per workflow    | Limits total step.do calls per instance (sleep doesn't count) | Chain child workflow instances for large repos                                 |
| 1 MiB step result size      | Cannot return large PR arrays from steps                      | Return only `PrRef[]` (id + number), not full `PrItem[]` — already implemented |
| 5 cron triggers per account | Only 5 scheduled sync triggers across ALL workers             | Single cron that fans out to per-board workflows                               |
| 10ms CPU per step           | JSON parsing of large payloads can hit this                   | Network I/O doesn't count; keep CPU work minimal per step                      |
| 100 concurrent instances    | Fan-out to per-repo workflows limited                         | 2 boards × 3 repos = 6 sync instances + 2 classify = 8 — well within limit     |
| 100,000 daily requests      | Shared between Workers HTTP + Workflow executions             | Each step.do counts; a 1,024-step workflow uses 1,024 of the budget            |

### 3.5 Step Result Size: 1 MiB vs 32 MiB

The Cloudflare docs specify **1 MiB (2²⁰ bytes)** as the step result size limit. The codebase comment (`github-sync.ts:213–217`) references a "32MiB Workflows RPC serialization limit" — this discrepancy may reflect an older or undocumented limit, or a different layer (e.g., V8 serialization overhead). Either way, returning minimal `PrRef[]` instead of full `PrItem[]` is the correct approach.

---

## 4. Benchmark: supabase/supabase (90-day backfill)

### 4.1 Raw Numbers

| Metric                           | Value  |
| -------------------------------- | ------ |
| Total PRs (all time)             | 22,222 |
| PRs in last 90 days              | 2,307  |
| Average PRs/month (6-month)      | ~754   |
| Average PRs/day                  | ~25.6  |
| Total review comments (all time) | 28,686 |
| Review comments in last 90 days  | ~4,250 |
| Review comments/day              | ~47    |
| Average reviews per PR           | ~1.8   |
| Estimated reviews in 90 days     | ~4,153 |

### 4.2 API Requests for First Sync (single repo, 90-day window)

| Operation                                | Calculation       | Requests |
| ---------------------------------------- | ----------------- | -------- |
| PR listing (REST, 100/page)              | ceil(2,307 / 100) | 24       |
| PR details + reviews (GraphQL, 50/query) | ceil(2,307 / 50)  | 47       |
| Review comments (REST, 100/page)         | ceil(4,250 / 100) | 43       |
| **Total per repo**                       |                   | **~114** |

Using the current GQL_PRS_PER_QUERY=500: ceil(2,307 / 500) = 5 queries → total ~72 requests. But the timeout/resource-limit risk at 500 is high.

### 4.3 Subrequest Budget for First Sync (single repo)

With `step.sleep` resets between phases:

| Phase                                        | Subrequests per invocation             | Invocations needed                                                  |
| -------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------- |
| PR listing (24 REST pages)                   | 24 + 1 upsert = 25                     | 1 (fits in 50)                                                      |
| PR details (47 GQL batches × 3 subreqs each) | 3 per batch                            | 47 batches ÷ ~8 per invocation = ~6 invocations (with sleep resets) |
| Review comments (43 REST pages)              | 1 mapPrNumbersToIds + pages + 1 upsert | ~2 invocations (maxPages=45 fits in 50)                             |

**Total steps for one repo sync**: ~10–15 step.do calls + ~8 step.sleep calls = ~10–15 against the 1,024 step limit. Well within budget.

### 4.4 Scale Projection: 2 boards × 3 repos

**Initial sync (90-day backfill), all repos supabase/supabase-scale:**

| Metric                   | Per repo                 | 6 repos                                        |
| ------------------------ | ------------------------ | ---------------------------------------------- |
| API requests             | ~114                     | **~684**                                       |
| GitHub rate limit points | ~114                     | ~684 (14% of 5,000/hr)                         |
| Workflow instances       | 1 dispatch + 1 sync-repo | 2 dispatch + 6 sync-repo + 2 classify = **10** |
| Steps per sync-repo      | ~10–15                   | ~60–90 total                                   |

**Daily ongoing sync (incremental):**

| Metric              | Per repo/day | 6 repos/day           |
| ------------------- | ------------ | --------------------- |
| New PRs             | ~26          | ~154                  |
| New review comments | ~47          | ~282                  |
| API requests        | ~29          | **~174**              |
| Rate limit points   | ~53          | ~318 (6% of 5,000/hr) |

### 4.5 Constraint Headroom

| Constraint                 | Budget   | Usage (6 repos)                  | Headroom       |
| -------------------------- | -------- | -------------------------------- | -------------- |
| GitHub rate limit (PAT)    | 5,000/hr | ~684 (initial) / ~318 (daily)    | 87–94%         |
| Subrequests per invocation | 50       | Managed via step.sleep           | OK with resets |
| Steps per workflow         | 1,024    | ~15 per sync-repo instance       | 98%            |
| Concurrent instances       | 100      | 10                               | 90%            |
| Cron triggers              | 5        | 1 (single cron fans out)         | 80%            |
| Daily requests             | 100,000  | ~200 workflow executions + steps | >99%           |

---

## 5. Architecture Insights

### 5.1 The Current Hybrid API Strategy Is Optimal

- **REST for PR listing**: native `since` filter + ETag 304s for free polling
- **GraphQL for PR details + reviews**: 50% fewer rate points, 100x faster wall time vs per-PR REST calls
- **REST for review comments**: repo-wide endpoint with `since` has no GraphQL equivalent; GraphQL would cost 1,000x more

No phase benefits from switching.

### 5.2 GQL_PRS_PER_QUERY Should Be Reduced

The current value of 500 PRs per GraphQL query:

- Costs 505 points per query (10% of hourly budget in one call)
- Risks 10-second timeout on GitHub's side (502/504 with penalty points)
- Risks `RESOURCE_LIMITS_EXCEEDED` error (undisclosed threshold)
- At 50 PRs/query: 51 points, much safer, and 10 queries for 500 PRs = 510 points total (same budget)

**Recommendation**: Reduce GQL_PRS_PER_QUERY from 500 to 50. Same total rate cost, dramatically lower risk.

### 5.3 Key Cloudflare Constraints to Design Around

1. **50 subrequests per invocation** — the proximate cause of crashes. `step.sleep` resets it.
2. **1,024 steps per workflow (free)** — not currently at risk (15 steps per sync-repo), but would become relevant if review-comment pagination is split into many small steps.
3. **5 cron triggers** — forces a single cron → fan-out architecture (already implemented).
4. **1 MiB step result size** — `PrRef[]` pattern already handles this; full `PrItem[]` would overflow.
5. **10ms CPU per step** — network I/O is excluded, so this is generous for our use case (mostly fetch + light JSON mapping).

### 5.4 ETag Optimization (Future)

Storing and replaying ETags for REST endpoints (`pulls.list`, `pulls.listReviewCommentsForRepo`) would make unchanged-repo polling free against GitHub's rate limit. For a 6-repo instance syncing hourly where typically 4 repos are quiet, this saves ~4 requests/hour (modest but zero-effort once implemented).

---

## Code References

- `src/lib/services/github-sync.ts:9` — `MAX_PRS_PER_REPO = 200`
- `src/lib/services/github-sync.ts:13` — `GQL_PRS_PER_QUERY = 500` (recommend reducing to 50)
- `src/lib/services/github-sync.ts:19` — `MAX_OVERFLOW_ROUNDS = 2`
- `src/lib/services/github-sync.ts:106-185` — `syncReviewCommentsForRepo` (REST, repo-wide)
- `src/lib/services/github-sync.ts:265-269` — `buildBatchPrDetailsQuery` (GraphQL batched)
- `src/lib/services/github-sync.ts:298-481` — `syncPrBatch` (GraphQL enrichment)
- `src/worker.ts:131` — `step.sleep("budget-reset-before-spawn")` — subrequest reset
- `src/worker.ts:195` — `step.sleep("budget-reset-before-reviews")` — subrequest reset
- `src/worker.ts:198-213` — review comments loop (missing sleep between iterations — proximate crash cause from frame.md)

## Historical Context

- `context/archive/2026-06-18-classification-batch/research.md` — LLM integration research; chose Workers AI for classification. Workflow architecture decisions predate the subrequest crash investigation.
- `context/changes/bugfix/frame.md` — frames the subrequest crash root cause: 47/50 budget with no `step.sleep` between review-comment pagination iterations. 9 prior PRs (#47–#55) attempted incremental fixes.

## 6. Forensic Analysis: What Was Tried and Why It Failed (#44–#55)

Twelve PRs over ~18 hours (2026-06-29 15:43 → 2026-06-30 09:24) attempted to fix the sync workflow. Each fix addressed the immediate symptom but exposed the next constraint, creating a whack-a-mole pattern. This section documents every attempt, what it fixed, what it broke, and what false assumptions drove it.

### 6.1 Timeline & Dependency Chain

```
PR #44  (15:43) — GraphQL batching for PR details
  ↓ fixed timeout, exposed subrequest limit
PR #45  (16:46) — merge commit (no code changes)
  ↓
PR #47  (17:42) — batch Supabase writes + error serialization
  ↓ fixed per-PR subrequest cost, exposed GQL batch size
PR #48  (19:00) — GQL batch 10→500 + limits.subrequests=1000
  ↓ fixed GQL efficiency, introduced invalid paid-plan config
PR #49  (19:21) — remove limits block + add review comment pagination
  ↓ fixed deploy, exposed review comments exceeding 50 subreqs
PR #50  (19:59) — batch review overflow pages (N×M → M GQL calls)
  ↓ fixed overflow subrequest cost, left unbounded overflow loop
PR #51  (20:11) — remove limits.subrequests again (missed in #49?)
  ↓ deploy fix
PR #52  (20:43) — cap MAX_OVERFLOW_ROUNDS=44 + try-catch Supabase writes
  ↓ capped worst case to 47 subreqs/step, but 47/50 = no margin
PR #53  (07:24+1d) — step.sleep between listing and chunk phases
  ↓ first correct understanding of per-invocation budget
PR #54  (07:53+1d) — step.sleep between PR detail chunks
  ↓ fixed chunk-to-chunk budget, left review comments without sleep
PR #55  (09:24+1d) — split into dispatch → sync-repo → classify
  ↓ eliminated replay overhead, but review comments loop STILL has no sleep between iterations
```

### 6.2 Per-PR Analysis

#### PR #44 — Replace per-PR REST with GraphQL batching

**Problem**: `syncPrBatch` made 2 sequential REST calls per PR (detail + reviews). For 150 PRs = 300 REST calls → `WorkflowTimeoutError` after 10 min, then `Worker exceeded CPU time limit`.

**Fix**: GraphQL aliased batching — 10 PRs per query. 150 PRs = 15 queries (~15s vs >10min).

**What it got right**: GraphQL batching was the correct architectural choice (confirmed by our research — 50% fewer rate points, 100x faster).

**What it got wrong**: GQL_PRS_PER_QUERY=10 was too conservative (later raised to 500 in #48). The Supabase writes were still per-PR (2×N calls), which immediately hit the 50-subrequest limit for large batches.

**False assumption**: "Reducing GitHub API calls is enough." The Supabase writes were the other half of the subrequest budget.

---

#### PR #47 — Batch Supabase writes + error serialization

**Problem**: After #44 reduced GitHub calls, the per-PR Supabase writes (one `UPDATE` + one `upsert` per PR) exhausted the 50-subrequest budget. 150 PRs = 300 Supabase calls.

**Fix**: Defer all writes to end of loop — 1 `batch_update_pr_sizes` RPC + 1 batch review upsert = 2 Supabase calls instead of 300. Added `describeError()` for `PostgrestError` objects (not `Error` instances, so `String(err)` returned `[object Object]`).

**What it got right**: Batching writes was correct. The `describeError()` helper survived to the final codebase.

**What it got wrong**: Deferring all writes to end-of-loop meant if the GQL calls exhausted the subrequest budget, the deferred Supabase writes also failed — losing all data from that batch, including already-fetched reviews. This was later fixed in #48 by writing per-GQL-batch instead of per-PR or end-of-loop.

**False assumption**: "If I reduce Supabase writes to 2, the total fits in 50." Correct for the Supabase side, but didn't account for GQL calls also consuming subrequests.

---

#### PR #48 — GQL batch 10→500 + limits.subrequests=1000

**Problem**: GQL_PRS_PER_QUERY=10 meant 15 GQL queries per 150-PR chunk. Each query = 1 subrequest. 15 GQL + 2 Supabase = 17 subrequests — fits in 50, but leaves no margin for overflow pagination.

**Fix**: Two changes:

1. Raised GQL_PRS_PER_QUERY from 10→100→500 (500 PRs × 100 reviews = 50k nodes, under 500k limit).
2. Added `limits.subrequests: 1000` to `wrangler.jsonc` to bypass the 50-cap.
3. Changed writes from end-of-loop to per-GQL-batch (3 subrequests per batch: 1 GQL + 1 RPC + 1 upsert).

**What it got right**: Per-GQL-batch writes were the correct granularity (survived to final code). GQL_PRS_PER_QUERY=500 works mathematically against GitHub's node limit.

**What it got wrong**: `limits.subrequests` requires a **paid Cloudflare plan**. Deploy failed with error code 100328. The entire `limits` block is paid-only — this was discovered empirically, not from docs.

**False assumption**: "The `limits` config in wrangler.jsonc works on the free plan." It doesn't.

---

#### PR #49 — Remove limits block + review comment pagination

**Problem**: Deploy blocked by `limits.subrequests` (paid-only). Also, `syncReviewCommentsForRepo` fetched ALL review comments in one step.do — for supabase/supabase (~4,250 comments in 90 days = 43 REST pages), this used 43+2=45 subrequests. Adding the prior step's carry-over = crash.

**Fix**:

1. Removed `limits` block from `wrangler.jsonc`.
2. Added `maxPages` parameter to `syncReviewCommentsForRepo`. Changed sort to `asc` so `updated_at` of the last comment serves as a resumable cursor (`nextSince`).
3. Worker loops `sync-review-comments-{r}-{p}` steps with maxPages=45 (47 subrequests max: 45 REST + 1 mapPrNumbersToIds + 1 upsert).

**What it got right**: Date-based cursor pagination for review comments was correct and survived to final code. The maxPages=45 budget math (47/50) was accurate per-step.

**What it got wrong**: Budget math was correct for ONE step in isolation, but the loop ran multiple iterations WITHOUT `step.sleep` between them. All iterations shared one invocation's 50-subrequest budget. If step 0 used 47, step 1 started with 3 remaining → instant crash. **This is the proximate cause of the crash that persists in the current code.**

**False assumption**: "Each `step.do` gets its own subrequest budget." It doesn't — the budget is per Worker invocation, not per step.

---

#### PR #50 — Batch review overflow pages (N×M → M GQL calls)

**Problem**: The per-PR review overflow loop in `syncPrBatch` made N GQL calls for N PRs with >100 reviews. For 11 PRs with overflow = 11 extra subrequests.

**Fix**: Batch all PRs needing the same overflow page depth into one GQL call using field aliases + typed cursor variables. N PRs × M overflow depths = M queries instead of N×M.

**What it got right**: Elegant batching pattern. For 11 PRs × 1 overflow page: 1 GQL call instead of 11. Survived to final code.

**What it got wrong**: The overflow loop was still unbounded — a PR with 1,000 reviews could cause 10 overflow rounds. Combined with the per-invocation budget, this was a ticking bomb.

---

#### PR #51 — Remove limits.subrequests (again)

**Problem**: The `limits.subrequests: 1000` config reappeared (possibly from a merge conflict with #48/#49 ordering). Deploy failed again.

**Fix**: Removed it again.

**Pattern**: This is a symptom of rapid-fire fixes landing out of order. Two PRs (#49 and #51) both removed the same config.

---

#### PR #52 — Cap overflow rounds + guard Supabase writes

**Problem**: `sync-pr-details-0-4-1` (a **retry** of step `sync-pr-details-0-4`) reported "GraphQL batch failed: Too many subrequests" for ALL 150 PRs. The `-1` suffix = retry.

**Root cause discovered**: Step retries share the original invocation's subrequest counter. First attempt ran overflow loop until hitting 50 → Supabase write threw uncaught → step failed → Cloudflare retried → retry started with budget already exhausted → first GQL call in the retry immediately crashed.

**Fix**:

1. Cap `MAX_OVERFLOW_ROUNDS = 44` (1 GQL + 44 overflow + 1 RPC + 1 upsert = 47 ≤ 50).
2. Wrap Supabase writes in try-catch; re-throw "Too many subrequests" so the step fails cleanly and Cloudflare retries in a new invocation.

**What it got right**: The try-catch pattern for subrequest errors was correct (survived to final code). Understanding that retries share the budget was a key insight.

**What it got wrong**: MAX_OVERFLOW_ROUNDS=44 gave only 3 subrequests of headroom (47/50). Any additional subrequest from rate-limit checks, Octokit initialization, or Cloudflare internal overhead would still crash. This was "optimizing the budget math" — the frame.md pattern.

**False assumption**: "47 out of 50 subrequests is safe." It's not — there's no margin for overhead.

---

#### PR #53 — step.sleep between listing and chunk phases (BREAKTHROUGH)

**Problem**: Even with MAX_OVERFLOW_ROUNDS=44, chunks crashed. `sync-list-prs` alone used ~28 subrequests (27 REST pages for 2,700 PRs + 1 upsert). This left only ~22 for the first chunk → crash by chunk 5–6.

**Key insight**: Subrequests are per **invocation**, not per step. All steps in one invocation share one 50-subrequest budget. `step.sleep` forces hibernation → new invocation → fresh budget.

**Fix**: Added `step.sleep("budget-reset-after-listing", "1 second")` between the PR listing phase and the chunk processing phase.

**What it got right**: First PR to correctly understand the per-invocation budget model. `step.sleep` as a budget reset was the correct pattern.

**What it got wrong**: Only added sleep between listing→chunks. Chunks still ran back-to-back without sleep. Review comments also had no sleep between iterations.

---

#### PR #54 — step.sleep between PR detail chunks

**Problem**: After #53 reset budget before chunks, chunks still shared budget with each other. Chunk 0 used ~6 subrequests (1 rate-limit check + 1 GQL + 2 overflow + 1 RPC + 1 upsert), chunk 1 started with ~44 remaining, chunk 5 started with ~20 remaining → crash.

**Fix**: Added `step.sleep` between each PR detail chunk. Also added `step.sleep("budget-reset-before-reviews-{r}")` before the review comments phase.

**What it got right**: Each chunk now gets a fresh budget.

**What it got wrong**: Review comments loop STILL has no `step.sleep` between iterations. `sync-review-comments-0` uses 47/50 subrequests. `sync-review-comments-1` starts with 3 remaining → crash. **This is the bug that persists in the current code (worker.ts:198–213).**

---

#### PR #55 — Split into dispatch → sync-repo → classify

**Problem**: Completed Workflow steps cost subrequests to **replay** on restart. With 20+ steps (listing + rate checks + chunks + review comments), the replay alone exhausted the 50-subrequest budget before any real work began.

**Fix**: Split the monolithic workflow into 3 chained instances:

- **dispatch** — lists repos, spawns per-repo sync instances
- **sync-repo** — handles one repo (PR details + review comments)
- **classify** — classifies unprocessed threads (waits 3 minutes for sync to finish)

Each instance starts fresh — no replay overhead from prior phases.

**What it got right**: Architectural decomposition was correct. Each instance starts with zero replay. Extracted `getGitHubToken()` for per-instance token caching.

**What it got wrong**:

1. The review comments loop within `sync-repo` still lacks `step.sleep` between iterations.
2. Classify is spawned from the dispatcher simultaneously with sync-repo (via `spawn-children` step), not after sync completes. The 3-minute `step.sleep` is a timing hack, not a real dependency.
3. The `check-rate-limit` steps were removed (no longer in worker.ts), losing the rate-limit guard.

---

### 6.3 Pattern Analysis: Why 12 PRs Didn't Fix the Problem

**Root cause of the whack-a-mole pattern**: The fundamental constraint — **50 subrequests per invocation, shared across all steps** — was not understood until PR #53 (the 9th fix attempt). Prior fixes optimized individual step costs without realizing they were drawing from a shared pool.

| False belief                                    | Held during PRs | Correct understanding                                             |
| ----------------------------------------------- | --------------- | ----------------------------------------------------------------- |
| "Each `step.do` gets its own subrequest budget" | #44–#52         | Budget is per invocation; all steps in one invocation share it    |
| "Step retries get a fresh budget"               | #44–#51         | Retries share the original invocation's remaining budget          |
| "`limits.subrequests` works on free plan"       | #48             | The entire `limits` block requires a paid plan                    |
| "47/50 subrequests is safe margin"              | #49, #52        | No margin for Octokit init, rate-limit checks, or CF overhead     |
| "Replay of completed steps is free"             | #44–#54         | Each replayed step.do result costs subrequests to deserialize     |
| "step.sleep between phases is sufficient"       | #53             | Every loop iteration that does external calls needs its own sleep |

**Complexity escalation**: Each fix added code without removing the assumptions of the prior fix:

| PR        | Lines changed | Net complexity                                      |
| --------- | ------------- | --------------------------------------------------- |
| #44       | +143 / -50    | Introduced GraphQL batching + rate-limit checks     |
| #47       | +75 / -22     | Added batch RPC + describeError                     |
| #48       | +40 / -35     | Restructured writes, added limits config            |
| #49       | +65 / -16     | Added maxPages, nextSince cursor, pagination loop   |
| #50       | +105 / -65    | Added buildBatchReviewPageQuery + overflow batching |
| #52       | +39 / -6      | Added MAX_OVERFLOW_ROUNDS + try-catch guards        |
| #53       | +23 / -8      | Added 1 step.sleep                                  |
| #54       | +17 / -1      | Added 2 more step.sleeps                            |
| #55       | +144 / -120   | Full architectural split (most invasive)            |
| **Total** | ~+651 / -323  | Net +328 lines of complexity                        |

### 6.4 Surviving Defects in Current Code (post-#55)

1. **Review comments loop has no `step.sleep` between iterations** (`worker.ts:198–213`). Each iteration uses up to 47 subrequests (maxPages=45 + mapPrNumbersToIds + upsert). Second iteration starts with ≤3 remaining → crash. This is the **same class of bug** that #53/#54 fixed for PR detail chunks.

2. **Classify spawned simultaneously with sync-repo** (`worker.ts:160–169`). The `spawn-children` step creates both sync and classify instances at the same time. Classify uses a 3-minute sleep as a timing hack. If sync takes longer (13 minutes on supabase/supabase), classify sees empty data.

3. **No rate-limit guards** — the `check-rate-limit` steps from #44 were removed in #55's refactor. A burst sync of 6 repos could theoretically exhaust the 5,000/hr GraphQL budget (though our analysis shows it would use only ~684 points — well within budget).

4. **GQL_PRS_PER_QUERY=500 risks GitHub timeout** — at 500 PRs × 100 reviews, queries approaching 50k nodes risk the 10-second timeout (502/504 with penalty points). Reducing to 50 is safer with identical total rate cost.

### 6.5 Lessons for the Rebuild

1. **Understand the constraint model FIRST, then code.** The 50-subrequest budget, its per-invocation scope, and `step.sleep` as the reset mechanism should have been researched before the first fix attempt. Instead, this understanding was discovered empirically over 12 PRs.

2. **Every loop that makes external calls needs a budget strategy.** Either: (a) bound the iteration count so total subrequests fit in 50, OR (b) insert `step.sleep` between iterations to reset the budget.

3. **Don't optimize budget math with no margin.** 47/50 leaves 3 for overhead. Design for 30/50 max per invocation — 40% headroom absorbs retries, Octokit init, and Cloudflare internals.

4. **Chain ordering must be explicit, not timing-based.** Classify should be spawned from sync-repo's final step, not from the dispatcher with a 3-minute sleep.

5. **Test against the actual constraint.** The supabase/supabase repo is the stress test. Any fix that works on a small repo but hasn't been verified against 2,307 PRs and 4,250 review comments hasn't been tested.

---

## Open Questions

1. **Step result size: 1 MiB or 32 MiB?** — Cloudflare docs say 1 MiB; codebase comment says 32 MiB. Need to empirically verify which limit applies to Workflow step returns.
2. **Does `workflow.create()` count as a subrequest?** — Likely against the 1,000 Cloudflare-service cap, but not documented. If it counts against the 50 external cap, spawning 3+ child workflows in one step would need a sleep.
3. **GitHub App vs PAT for self-hosted users** — GitHub Apps scale to 12,500 req/hr for large orgs. Worth considering for future but adds onboarding complexity.
4. **ETag storage** — Where to persist ETags between syncs? Options: Supabase column on `github_repos`, Cloudflare KV, or workflow instance state.
