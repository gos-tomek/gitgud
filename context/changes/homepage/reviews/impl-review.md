<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: GitGud Public Homepage

- **Plan**: context/changes/homepage/plan.md
- **Scope**: All Phases (0–4)
- **Date**: 2026-06-29
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 5 warnings, 2 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | WARNING |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

## Findings

### F1 — Unguarded JSON.parse on KV cache read

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/stats.ts:31
- **Detail**: JSON.parse(cached) at line 31 runs BEFORE the try/catch that begins at line 35. If the KV value is corrupted or not valid JSON, this throws an unhandled exception → 500 response. The same pattern in index.astro:29 IS inside the outer try/catch, so only the API endpoint is affected.
- **Fix**: Wrap the early-return cache path in the existing try/catch, or add its own. On parse failure, delete the bad key and fall through to a fresh fetch.
- **Decision**: FIXED — wrapped JSON.parse in try/catch; on parse failure evicts bad key and falls through to fresh fetch

### F2 — Unbounded full-table fetches in stats service

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/homepage-stats.ts:22,25-26
- **Detail**: board_contributors (line 22) fetches every row to deduplicate in JS. thread_classifications (lines 25-26) fetches every row for aggregation. Supabase's default row limit is 1000 — if any table exceeds this, counts silently cap at 1000 and stats become wrong. The rootIds array (line 51) is also passed to .in() calls (lines 54-55) which can hit URL-length limits at scale.
- **Fix A ⭐ Recommended**: Use Postgres RPCs for aggregation
  - Strength: COUNT(_), COUNT(DISTINCT ...), COUNT(_) FILTER (WHERE ...) are single-row results — no row limit, no data transfer, no JS dedup. Eliminates the .in() issue too.
  - Tradeoff: Requires a new migration adding an RPC function + RLS grant for service role.
  - Confidence: HIGH — standard Postgres pattern; service role already has full access.
  - Blind spot: None significant.
- **Fix B**: Add explicit .limit(10000) or paginate
  - Strength: No migration needed — pure client-side fix.
  - Tradeoff: Still transfers all rows over the wire; doesn't fix .in() URL length. Band-aid.
  - Confidence: LOW — defers the real fix.
  - Blind spot: What's the actual max rows expected?
- **Decision**: FIXED via Fix A — replaced all JS-side queries with a single `get_homepage_stats()` Postgres RPC (migration `20260629120000_homepage_stats_rpc.sql`); service rewritten to call `client.rpc("get_homepage_stats").single()`

### F3 — Duplicated cache logic between index.astro and API endpoint

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: src/pages/index.astro:13-34 and src/pages/api/stats.ts:7-49
- **Detail**: Plan specified SSR fetch of /api/stats from index.astro. Implementation instead reads KV + calls service client directly in index.astro (commit 9f6f182: "fetch stats via env directly, remove HTTP self-fetch"). CACHE_KEY, FALLBACK, and the KV read/write/fallback logic are now duplicated verbatim. If the cache key, TTL, or fallback shape changes in one place but not the other, the two paths diverge silently.
- **Fix A ⭐ Recommended**: Extract shared helper
  - Strength: Single source of truth for cache logic. Both index.astro and /api/stats call the same function. No self-fetch overhead.
  - Tradeoff: Minor refactor — a new export in homepage-stats.ts or a dedicated module.
  - Confidence: HIGH — straightforward extraction.
  - Blind spot: None significant.
- **Fix B**: Remove /api/stats endpoint entirely
  - Strength: Eliminates duplication by keeping only the direct-access path in index.astro.
  - Tradeoff: Loses the public JSON endpoint that could be useful for external consumers or debugging.
  - Confidence: MEDIUM — depends on whether anyone calls /api/stats externally.
  - Blind spot: Haven't checked for external callers.
- **Decision**: FIXED via Fix B — removed `src/pages/api/stats.ts` entirely; `index.astro` already had the direct-access path with its own try/catch

### F4 — Unplanned feature: CommentBody markdown rendering

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/components/threads/CommentBody.tsx
- **Detail**: Commit 1ef2744 added CommentBody.tsx with markdown rendering (suggestion block support), plus two new npm dependencies (marked, isomorphic-dompurify). This feature is not described in the homepage plan. It shipped on the same branch, expanding scope.
- **Fix**: Document as an addendum in the plan — the work is done and useful, just needs to be acknowledged as out-of-scope addition.
- **Decision**: FIXED — added addendum to plan.md documenting CommentBody as out-of-scope but shipped

### F5 — Hardcoded hex colors in Homepage.astro diverge from token system

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency
- **Location**: src/components/Homepage.astro (throughout), src/components/HomepageNav.astro:18
- **Detail**: Homepage uses many hardcoded hex values (#1a2e1a, #4a5e4a, #0f1f0f, #6b7e6b, #d1ddd1, #f7fef7, #f8fdf8) and inline style= attributes. All other migrated pages (dashboard, auth, board) consistently use token-based Tailwind classes (text-foreground, bg-background, etc.). The homepage is the only page that bypasses the token system.
- **Fix A ⭐ Recommended**: Map homepage palette to CSS custom properties
  - Strength: Brings homepage into the same system as the rest of the app. Future theme changes propagate automatically.
  - Tradeoff: Non-trivial visual QA pass needed — color mapping may shift some shades slightly.
  - Confidence: MEDIUM — need to map each hex to the closest existing token or add new ones.
  - Blind spot: Some hex values may be intentionally distinct from the token palette.
- **Fix B**: Accept as intentional homepage-specific styling
  - Strength: Zero risk of visual regression. Homepage is a marketing page with its own identity.
  - Tradeoff: Maintenance burden if brand colors change.
  - Confidence: HIGH — many marketing pages use bespoke colors deliberately.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — added 7 `--homepage-*` CSS custom properties to `global.css` `:root` and `@theme inline`; replaced all hex class values in `Homepage.astro` and `HomepageNav.astro` with token-based Tailwind classes

### F6 — Render-blocking Google Fonts import

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/Homepage.astro:13
- **Detail**: @import url("https://fonts.googleapis.com/css2?...") inside `<style is:global>` is render-blocking. Page won't paint until this CSS downloads.
- **Fix**: Move to `<link rel="preconnect">` + `<link rel="stylesheet">` in Layout's `<head>` for better loading performance.
- **Decision**: FIXED — removed `@import` from `<style is:global>` in `Homepage.astro`; added `<slot name="head" />` to `Layout.astro`; injected `<link rel="preconnect">` + `<link rel="stylesheet">` from `index.astro` via `<Fragment slot="head">`

### F7 — text-purple- reference in PrTable.tsx (false positive)

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: src/components/impact/PrTable.tsx:9
- **Detail**: Phase 4 success criterion says "no text-purple- references in src/". PrTable.tsx:9 has bg-purple-100 text-purple-700 for GitHub "merged" PR state badges. This is GitHub convention (purple = merged), not cosmic theme remnant.
- **Fix**: No code change needed. Acknowledge in the success criteria as an intentional exception.
- **Decision**: FIXED — annotated criterion 4.6 in `plan.md` as intentional exception (GitHub merged-PR badge convention)

## Automated Verification

| Check                        | Result                                          |
| ---------------------------- | ----------------------------------------------- |
| `npm run build`              | ✅ PASS                                         |
| `npx tsc --noEmit`           | ✅ PASS                                         |
| `npm run lint`               | ✅ PASS                                         |
| `npm test` (non-integration) | ✅ PASS (21 files, 264 tests)                   |
| `grep bg-cosmic src/`        | ✅ PASS (no results)                            |
| `grep text-purple- src/`     | ⚠️ 1 hit (PrTable.tsx — see F7, false positive) |
