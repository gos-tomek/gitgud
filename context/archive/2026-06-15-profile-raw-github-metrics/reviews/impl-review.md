<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Contributor Impact Page

- **Plan**: context/changes/profile-raw-github-metrics/plan.md
- **Scope**: All Phases (1–4)
- **Date**: 2026-06-16
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical · 2 warnings · 2 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

## Findings

### F1 — Unbounded .in() clause on PR IDs

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/impact-metrics.ts:101,139-149
- **Detail**: getAllBoardPrs fetches every PR for a board (no limit), then passes all PR IDs into `.in("pull_request_id", boardPrIds)` for reviews and comments queries. PostgREST serializes `.in()` values as URL query params. With UUID IDs (~36 chars each), a board with ~200+ PRs risks exceeding the ~8KB URL length limit on proxies/Cloudflare, causing silent failures or 414 errors. All 4 service functions (getImpactSummary, getAuthorMetrics, getReviewerMetrics, getActivityData) use this pattern.
- **Fix A ⭐ Recommended**: Chunk `.in()` calls into batches of ~300
  - Strength: Pure client-side fix, no DB changes. Extract a helper like `batchIn(query, column, ids, batchSize)` that splits IDs and merges results.
  - Tradeoff: Multiple roundtrips per query on large boards; slightly more complex code.
  - Confidence: HIGH — standard PostgREST workaround.
  - Blind spot: Haven't measured actual Cloudflare URL limit (may be higher than 8KB).
- **Fix B**: Replace with a Supabase RPC (server-side join)
  - Strength: Single roundtrip regardless of board size; no URL limit concern; potentially faster on large datasets.
  - Tradeoff: New DB function + migration; harder to maintain; bypasses the Supabase query builder ergonomics.
  - Confidence: MEDIUM — more robust but higher implementation cost.
  - Blind spot: RPC auth/RLS implications not investigated.
- **Decision**: FIXED via Fix B — added `get_board_reviews_for_reviewer` / `get_board_root_comments_for_commenter` RPCs (`supabase/migrations/20260617120000_board_reviews_comments_rpc.sql`) that join on `repo_id` server-side; replaced the 5 `.in("pull_request_id", boardPrIds)` call sites in `getImpactSummary`, `getReviewerMetrics`, and `getActivityData` with calls to these RPCs. Both functions are plain SQL (`SECURITY INVOKER`), so existing RLS on `github_reviews`/`github_review_comments`/`github_pull_requests` still enforces board membership under the caller's identity. The smaller, naturally-bounded `.in()` queries (e.g. `reviewedPrIdsList`, top-10 `authoredIds`) were left as-is — they weren't the flagged risk.

### F2 — No explicit board membership check in impact API endpoints

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/board/[boardId]/impact/[login]/summary.ts:35-46 (same pattern in author.ts, reviewer.ts, activity.ts)
- **Detail**: The 4 impact API endpoints authenticate the user then look up the contributor via board*contributors, but never verify the requesting user is a board member. Any logged-in user can hit these endpoints for any board. RLS on board_contributors and github*\* tables does enforce membership (the query returns empty for non-members → 404), so this is not exploitable today. However, the Astro page (.astro:22) does call getBoardWithRole explicitly — the API endpoints should mirror this for defense-in-depth.
- **Fix**: Add `getBoardWithRole(supabase, boardId, user.id)` check after auth, returning 404 if null — same pattern as the .astro page.
- **Decision**: FIXED — added `getBoardWithRole(supabase, boardId, user.id)` + 404-if-null to all 4 endpoints (summary.ts, author.ts, reviewer.ts, activity.ts), matching the .astro page pattern. Additionally implemented the user's extended requirement (board-level supervisor-only contributor switching): non-supervisors are now restricted to their own `board_contributors` row via an own-contributor lookup (403 on mismatch); the Astro impact page mirrors this with a redirect guard and filters the `contributors` array passed to `ImpactView` so the contributor-switcher UI only renders for supervisors. This guard is currently a forward-compatible no-op in production — `board_contributors.user_id` isn't populated yet (no account-linking exists until F-04), so no non-owner board member can currently trigger the non-supervisor branch — but is in place as defense-in-depth ahead of that work. Added hermetic test coverage in `tests/hermetic/impact-api.test.ts` for 404 (board not found), 403 (cross-contributor access by non-supervisor), and 200 (own-profile access by non-supervisor). The "show contributor who the board's supervisor is" part of the request was not implemented — it needs new data plumbing (owner display name isn't currently surfaced on `UserBoard`/`BoardTopbar`) and is being treated as separate follow-up work, not blocking this fix.

### F3 — Sync service uses separate detail-fetch instead of mapper

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/lib/services/github-sync.ts:70-76
- **Detail**: Plan said to extend the upsertPullRequests mapper with additions/deletions/changed_files. Implementation adds a separate `updatePullRequestSize` function that calls `pulls.get` (detail endpoint) because the list endpoint doesn't return size fields. Justified deviation — the plan's assumption about data availability was incorrect.
- **Fix**: No fix needed. Document the deviation in the plan as an addendum for traceability.
- **Decision**: FIXED — added addendum to plan.md Phase 1 §2 (Sync service mapper updates) documenting that the list-PRs endpoint lacks the size fields, requiring a separate `updatePullRequestSize` detail-fetch instead of extending the list-based mapper.

### F4 — Unplanned /board/[id]/impact/index.astro redirect

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/pages/board/[id]/impact/index.astro
- **Detail**: This file is not described in the plan. It redirects `/board/[id]/impact` to the first contributor's impact page (or settings if no contributors). Necessary because BoardNav links to `/board/[id]/impact` which needs to resolve somewhere. Reasonable UX addition.
- **Fix**: No fix needed. Document in the plan as a Phase 4 addendum.
- **Decision**: FIXED — added addendum to plan.md Phase 4 §4 (Stub routes) documenting `index.astro` as the resolver for the bare `/board/[id]/impact` nav link.
