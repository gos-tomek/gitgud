<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Profile Classified Comments

- **Plan**: context/changes/profile-classified-comments/plan.md
- **Scope**: All phases (1–5 of 5)
- **Date**: 2026-06-24
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 4 warnings, 2 observations

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

### F1 — Cross-board thread read via [threadId] endpoint

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/board/[boardId]/threads/[login]/[threadId].ts:57
- **Detail**: The endpoint verifies board membership and contributor access, but getThreadMessages(supabase, threadId) fetches comments by threadRootCommentId alone without verifying the thread belongs to a PR in one of the board's repos. An authenticated user who knows a valid threadRootCommentId from a different board can read its messages by crafting a URL with any boardId and login they do have access to.
- **Fix A ⭐ Recommended**: Add a board-scoped guard in the API handler
  - Strength: Before calling getThreadMessages, query thread_classifications → github_review_comments → github_pull_requests → board_repos to verify the thread belongs to the requested board. One extra query, but it closes the gap at the application layer.
  - Tradeoff: One additional DB round-trip per thread expansion.
  - Confidence: HIGH — the join path already exists in get_board_classified_threads RPC.
  - Blind spot: RLS on github_review_comments may partially mitigate this; haven't verified those policies.
- **Fix B**: Scope the query inside getThreadMessages itself
  - Strength: Keeps the guard in the service layer, reusable if other callers appear.
  - Tradeoff: Requires passing boardId into a function that currently only takes threadId.
  - Confidence: MEDIUM — changes the service function signature.
  - Blind spot: Same RLS caveat.
- **Decision**: FIXED via Fix A — added `isThreadInBoard` guard in `src/lib/services/impact-metrics.ts`, called from the API handler before `getThreadMessages`.

### F2 — "All" role filter omits "joined" threads

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: supabase/migrations/20260624170000_threads_self_role_and_coverage.sql:88-94
- **Detail**: The p_role = 'all' clause in get_board_classified_threads is defined as the union of "started" and "received" but does NOT include the "joined" bucket (threads started by others on others' PRs where the contributor replied). A user who sees threads under the "Joined" filter will find them missing when switching to "All". The plan specified role as "started | received | all" — the implementation added "joined" and "self" as new roles but didn't update "all" to cover them.
- **Fix A ⭐ Recommended**: Add the joined subquery to the 'all' branch
  - Strength: "All" correctly becomes the union of all four role buckets, matching user expectation.
  - Tradeoff: The 'all' query becomes slightly more complex (one additional EXISTS subquery). Should also include 'self' in the union for consistency.
  - Confidence: HIGH — the joined EXISTS clause already exists in the p_role = 'joined' branch; copy it.
  - Blind spot: Performance impact of the additional subquery on 'all' — likely negligible given page-size bounds.
- **Fix B**: Remove "joined" and "self" from the role filter UI
  - Strength: Brings implementation back to plan scope (3 roles).
  - Tradeoff: Loses genuinely useful filtering capability that's already built and working.
  - Confidence: LOW — removing working features feels wasteful.
  - Blind spot: Whether users expect to find joined threads at all.
- **Decision**: FIXED via Fix A — `all` branch in both `get_board_classified_threads` and `get_board_thread_coverage` now unions started/self/received (commenter or author match) with the joined EXISTS subquery. Verified via `supabase db reset`.

### F3 — Plan claims "no migrations" but 5 RPC migrations exist

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: supabase/migrations/ (5 files)
- **Detail**: The plan's "Migration Notes" section states "No database migrations needed." The implementation adds 5 migration files that create/replace RPC functions and add one index. All are backward-compatible (no table schema changes, no column drops). The RPCs were likely discovered as necessary during implementation to keep complex SQL out of the service layer. The plan should be updated to reflect reality.
- **Fix**: Add a plan addendum documenting the 5 migrations.
- **Decision**: FIXED — added addendum to plan.md's Migration Notes section listing all 5 migrations and what each does.

### F4 — REVOKE ALL missing on CREATE OR REPLACE migrations

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: supabase/migrations/20260624160845_threads_started_excludes_self_review.sql, supabase/migrations/20260624190000_classification_aggregates_exclude_self_review.sql
- **Detail**: Project lesson "Always REVOKE ALL before relying on RLS" requires explicit REVOKE ALL + GRANT EXECUTE on every function migration. Two CREATE OR REPLACE migrations omit this stanza. While grants survive from prior migrations (CREATE OR REPLACE preserves privileges), the pattern is inconsistent with other migrations in this same set that do include REVOKE/GRANT, and fragile if migrations are replayed from a clean schema.
- **Fix**: Add REVOKE ALL + GRANT EXECUTE after each CREATE OR REPLACE in a new migration file.
- **Decision**: SKIPPED

### F5 — 7 unplanned files, all reasonable additions

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: (multiple)
- **Detail**: Seven files not described in the plan were added: threads/[login]/[threadId].ts (thread message expansion API), threads/index.astro (redirect to first contributor), last-synced.ts (sync indicator for Threads page), supabase/seed.sql (test fixture data ~540 lines), tests/hermetic/impact-metrics.test.ts, tests/hermetic/threads-api.test.ts, tests/integration/impact-access.test.ts. All are supportive of the planned feature. Tests and seed data are expected. The redirect page mirrors the existing impact index pattern. Thread expansion and sync indicator are minor additive features that improve the Threads page UX.
- **Decision**: ACKNOWLEDGED — no action needed.

### F6 — N+1 correlated subquery for message_count (bounded)

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260624140000_classified_threads_author_and_count.sql:56-59
- **Detail**: message_count uses a correlated subquery per row. Bounded by page size (25-50), so acceptable at current volumes. The in_reply_to_id index (added in same migration) helps. Monitor if thread volumes grow significantly.
- **Decision**: FIXED (beyond original scope, per user follow-up — board threads are expected to scale to thousands, not tens). `EXPLAIN` on the original query showed `message_count`'s correlated subquery and `count(*) OVER()` were evaluated for **every matching row**, not just the page — the window function and Sort forced full materialization before `LIMIT` was applied, so the "bounded by page size" claim in this finding was actually wrong at scale.
  - Added `supabase/migrations/20260624200000_classified_threads_paginate_before_message_count.sql`: restructured `get_board_classified_threads` to sort+paginate in a CTE first, then compute `message_count` only for the resulting page (verified bounded via `EXPLAIN`). Split `total_count` out into a new `get_board_classified_threads_count` RPC (mirrors the existing `get_board_thread_coverage` split), so counting never pays the per-row cost either.
  - Updated `getClassifiedThreads` in `src/lib/services/impact-metrics.ts` to call the new count RPC in parallel instead of reading `total_count` off the first row.
  - Updated `tests/hermetic/impact-metrics.test.ts` mocks/assertions for the new RPC split. Full non-integration suite (191 tests) and typecheck pass.
