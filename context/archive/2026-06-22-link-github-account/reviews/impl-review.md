<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Link GitHub Account

- **Plan**: context/changes/link-github-account/plan.md
- **Scope**: All phases (1–5)
- **Date**: 2026-06-23
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 4 warnings, 1 observation

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | WARNING |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | WARNING |

## Findings

### F1 — Missing contributor write-denial tests

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: tests/integration/access-boundary.test.ts:76
- **Detail**: The "cross-board write denial" section only tests ownerB (a completely unauthorized user) trying to write to ownerA's board. It never tests that the contributor user — who HAS read access via `is_board_member()` — CANNOT write (INSERT/UPDATE/DELETE) to board child tables. The current RLS is correct: all WRITE policies use `is_board_owner()`, not `is_board_member()`. But without a test, a future regression that widens a WRITE policy from `is_board_owner()` to `is_board_member()` would go undetected.
- **Fix**: Add a "contributor write denial" describe block using `fixture.contributor.client` to attempt INSERT/UPDATE/DELETE on boards, github_repos, board_contributors, etc., asserting 42501 or 0-row effect — mirroring the existing ownerB write denial tests.
  - Strength: Catches the exact regression where a WRITE policy is broadened to `is_board_member()`.
  - Tradeoff: ~6 more test cases, adding ~15s to integration test runtime.
  - Confidence: HIGH — same pattern as existing ownerB tests.
  - Blind spot: None significant.
- **Decision**: FIXED — added "contributor write denial" describe block (INSERT/UPDATE/DELETE) to tests/integration/access-boundary.test.ts

### F2 — handle_new_user trigger has no null guard

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260622130000_user_profiles_trigger.sql:16
- **Detail**: The trigger casts `(raw_user_meta_data->>'github_id')::bigint` without checking for NULL. If a user is ever created without github metadata (Supabase admin API, password reset flow, any future auth pathway), this cast throws an exception and aborts the ENTIRE `auth.users` INSERT. In the current system there's only one signup path (the form, which always sets metadata), but the trigger fires on ALL `auth.users` inserts globally.
- **Fix A ⭐ Recommended**: Add a null guard: `IF NEW.raw_user_meta_data->>'github_id' IS NULL THEN RETURN NEW; END IF;`
  - Strength: Resilient to any user creation path without breaking the happy path. Zero risk to existing behavior.
  - Tradeoff: Users created without github metadata won't have a `user_profiles` row — they'd see an empty dashboard, which is acceptable.
  - Confidence: HIGH — standard Postgres trigger guard pattern.
  - Blind spot: None significant.
- **Fix B**: Document as intentional constraint and accept the crash.
  - Strength: Simplest, no code change.
  - Tradeoff: Any future auth pathway that skips metadata causes a confusing failure.
  - Confidence: MEDIUM — relies on future devs reading the comment.
  - Blind spot: Supabase internal flows (email change, etc.) that may INSERT into auth.users.
- **Decision**: FIXED via Fix A — added null guard to handle_new_user() in supabase/migrations/20260622130000_user_profiles_trigger.sql

### F3 — Unplanned impact API ownership guard refactor

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/pages/api/board/[boardId]/impact/[login]/\*.ts
- **Detail**: Seven files not mentioned in the plan were modified: 4 impact API endpoints, 1 Astro page, and 2 new test files (hermetic/impact-api.test.ts, integration/impact-access.test.ts). These files used `board_contributors.user_id` for the non-supervisor ownership guard — a column dropped in Phase 5. The refactor was necessary to avoid runtime breakage AND fixed a pre-existing bug (user_id was always null, so the guard always denied). The new guard correctly uses `getUserProfile().githubId`.
- **Fix**: Document as a plan addendum — the work is correct, complete, and well-tested.
- **Decision**: FIXED — added "Addendum: Impact API ownership guard refactor" to plan.md after Phase 5

### F4 — No server-side input validation in signup API

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/auth/signup.ts:24-26
- **Detail**: The signup endpoint casts `form.get("email")` and `form.get("password")` as string without null/format checks. A direct POST bypassing the form can submit null or empty values. Line 26 calls `.trim().toLowerCase()` on github_login which would throw if the field is missing. The impact API endpoints in this same change use zod validation, but signup doesn't. CLAUDE.md specifies: "API routes: validate input with zod."
- **Fix**: Add a zod schema for `{email, password, github_login}` with `.string().min(1)` checks at the top of the handler, returning specific error messages per field.
- **Decision**: FIXED — added `signupSchema` (zod) and `safeParse` guard to src/pages/api/auth/signup.ts

### F5 — Stale comment in create_board_atomic migration

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: supabase/migrations/20260611120000_create_board_atomic.sql:38
- **Detail**: Comment says "boards_insert_owner_as_member fires here" but Phase 5 dropped that trigger. The RPC still works correctly (owner access derives from `boards.owner_user_id`) but the comment is misleading.
- **Fix**: Update the comment to reflect the current access model.
- **Decision**: FIXED — updated comment in supabase/migrations/20260611120000_create_board_atomic.sql:38

## Notes

- Plan adherence is excellent across all 5 phases. The only drifts are positive: `AtSign` icon (better UX than planned `Github`), "Supervisor" label (matches app terminology), extra `REVOKE ALL ON FUNCTION` in trigger migration (follows project security convention).
- 7 files changed outside the plan (F3). All justified — `board_contributors.user_id` was dropped in Phase 5, requiring the impact API ownership guard refactor. The plan should have identified this dependency.
- `board_members` cleanup is complete: zero references remain in `src/`, `tests/`, or `seed.sql`.
- Conscious design decisions verified: no UNIQUE on `github_id` (self-hosted trust model), unauthenticated GitHub API (60 req/hr sufficient for single team).

## Access Control Summary

All board access paths route through `is_board_member()` via RLS. Impact API endpoints add an extra application-layer guard (non-supervisors see only own profile). The derived access model (`owner_user_id` + `board_contributors⟕user_profiles`) is correctly implemented.

Tested scenarios:

- ✅ Owner can read own boards
- ✅ Contributor (matching github_id) can read Board A
- ✅ Contributor cannot read Board B (no entry)
- ✅ OwnerB cannot read/write/delete OwnerA's board data (6 tables)
- ✅ Cross-board isolation on all child tables
- ✅ user_profiles: read own only, no cross-user access
- ✅ Impact API: contributor can view own profile (200)
- ✅ Impact API: contributor cannot view another's (403)
- ✅ Impact API: hermetic tests for all error paths (503, 401, 400, 404, 403, 200, 500)
- ✅ Contributor write-denial tested (F1 fixed)

## Verification Results

- ✅ `npx tsc --noEmit` — PASS
- ✅ `npm run test:typecheck` — PASS
- ✅ `npm run lint` — PASS
- ✅ `npx vitest run --exclude 'tests/integration/**'` — PASS (152/152)
- ⏭️ Integration tests not run (require local Supabase)
