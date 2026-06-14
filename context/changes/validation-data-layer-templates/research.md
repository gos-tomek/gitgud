---
date: 2026-06-14T12:00:00+02:00
researcher: Claude
git_commit: bcf3342498fbf79233f5a0a2d8dfac4350b6f8ea
branch: change/validation-data-layer-templates
repository: GitGud
topic: "Do we need Phase 3 (Validation + Data Layer Templates) tests?"
tags: [research, testing, validation, rls, phase-3, test-plan]
status: complete
last_updated: 2026-06-14
last_updated_by: Claude
---

# Research: Do We Need Phase 3 (Validation + Data Layer Templates) Tests?

**Date**: 2026-06-14T12:00:00+02:00
**Researcher**: Claude
**Git Commit**: bcf3342498fbf79233f5a0a2d8dfac4350b6f8ea
**Branch**: change/validation-data-layer-templates
**Repository**: GitGud

## Research Question

Phase 3 of the test-plan rollout covers Risk #5 (RLS policy gap on new tables) and Risk #6
(server trusts client on API boundaries). Do the existing tests already cover what Phase 3 would
deliver, making it unnecessary?

## Summary

**Phase 3 is not needed.** Both risks it targets are already mitigated:

- **Risk #5 (RLS policy gap)**: Phase 1 tests all 7 tables × all policy-defined CRUD operations.
  The test-fix-gaps change hardened every table with `REVOKE ALL` + policy audit. The pattern
  is documented in cookbook §6.1. No new tables are on the immediate roadmap.
- **Risk #6 (server trusts client)**: All 7 API routes use identical `safeParse → 400` wiring.
  No input reaches Supabase without passing through a Zod schema. No URL params, query params,
  or headers bypass validation. User identity comes from `auth.getUser()`, not client input.

The test-plan's Risk #6 description — "unvalidated URL params, array contents, or nested objects" —
describes a failure mode that does not exist in the current codebase. The risk was well-calibrated
at plan time (hot-spot signal), but the code already follows the convention (CLAUDE.md: "validate
input with zod") uniformly.

## Detailed Findings

### Risk #5: RLS Policy Gap on New Tables

#### What Phase 3 would deliver

Per `test-plan.md §3 row 3`: "RLS regression template for new tables" — a reusable pattern so
that when a new migration adds a table, there's a ready-made test structure for verifying its
RLS policies.

#### What already exists

**Phase 1 delivered complete RLS coverage** (`tests/integration/access-boundary.test.ts`):

| Table | SELECT | INSERT | UPDATE | DELETE | Notes |
| --- | --- | --- | --- | --- | --- |
| boards | ✅ :23 | ✅ :87 | ✅ :162 | ✅ :269 | |
| board_members | ✅ :29 | ✅ :94 | — | ✅ :276 | No UPDATE policy by design |
| github_repos | ✅ :38 | ✅ :101 | ✅ :183 | ✅ :290 | |
| github_pull_requests | ✅ :47 | ✅ :111 | ✅ :204 | ✅ :297 | |
| github_reviews | ✅ :56 | ✅ :126 | ✅ :225 | ✅ :304 | |
| github_review_comments | ✅ :62 | ✅ :138 | ✅ :246 | — | |
| board_contributors | ✅ :71 | ✅ :151 | — | — | No UPDATE/DELETE policies by design |

Line references are to `tests/integration/access-boundary.test.ts`.

**Test-fix-gaps hardened the RLS foundation** (`context/archive/2026-06-11-test-fix-gaps/plan.md`):
- Phase 8 added `REVOKE ALL FROM anon, authenticated` to all 7 tables
  (`supabase/migrations/20260614120000_revoke_all_hardening.sql`)
- Policy completeness audit confirmed no gaps — missing UPDATE on `board_members` and
  `board_contributors` is intentional
- SECURITY DEFINER + `SET search_path = public` pattern reinforced for RPC functions

**The pattern is already a template.** Each test block follows an identical structure:
`fixture.ownerB.client.from("<table>").<operation>(...)` → assert denial. Adding a new table
requires: (a) seed data in `seedTwoBoards()`, (b) copy one test per operation, change table
name and columns. Cookbook §6.1 documents the full pattern with RLS denial assertion shapes per
operation type.

**No imminent consumer.** Deferred risks #7–#11 activate with future slices (S-04, S-10, F-03,
F-04, S-11). The template has no new table to apply to.

#### Oracle verdict (Risk #5)

The PRD's Access Control section (`prd.md:180-186`) defines role-based scope (IC sees own data,
EM navigates team profiles). This is enforced by RLS policies, which are fully tested. The lesson
"Always REVOKE ALL before relying on RLS" (`lessons.md:22-30`) is now enforced in the migration
chain. **Risk #5 is mitigated.**

### Risk #6: Server Trusts Client on API Boundaries

#### What Phase 3 would deliver

Per `test-plan.md §3 row 3`: "validation test template for API routes" — Zod schema unit tests
verifying that invalid input is rejected at each endpoint.

#### What already exists

**All 7 routes follow identical validation wiring:**

| Route | safeParse | 400 response | Schema complexity |
| --- | --- | --- | --- |
| `boards/index.ts` | :52 | :55 | `trim().max(80)`, nested arrays (repos, contributors) |
| `boards/check-name.ts` | :36 | :39 | `trim().max(80)` |
| `github/repos.ts` | :38 | :41 | `string().min(1)` |
| `github/validate-pat.ts` | :38 | :41 | `string().min(1)` |
| `github/validate-repo.ts` | :40 | :43 | `string().min(1)` × 3 fields |
| `github/collaborators.ts` | :48 | :51 | nested array of `{owner, name}` objects |
| `github/sync.ts` | :39 | :42 | UUID regex |

Every route:
1. Reads JSON body via `await request.json()`
2. Calls `schema.safeParse(body)` (never `parse`)
3. On failure: returns `{ error: firstIssue.message ?? "Invalid input" }` with status 400
4. On success: uses only `parsed.data` fields downstream

The only deviation is cosmetic: `boards/index.ts:54` uses an intermediate variable `firstIssue`
vs. inline chaining in the other 6 routes. Functionally identical.

**No bypass paths exist.** Verified across all 7 routes:
- No route reads URL params, query params, or raw headers for business data
- User identity comes from `supabase.auth.getUser()` (server-side session), not client input
- All downstream calls (`supabase.rpc`, `supabase.from()`, `octokit.*`, service functions`)
  receive only `parsed.data` fields or `user.id`

**One route is already tested.** `tests/hermetic/board-creation.test.ts:118-135` covers
`POST /api/boards` with an `it.each` pattern testing 4 empty-field cases. This serves as a de
facto template for the other 6 routes.

#### What testing the remaining 6 routes would prove

Testing the 6 untested routes would prove that:
1. `safeParse` is called (it is — verified at specific lines above)
2. The 400 response is returned on failure (identical pattern across all routes)
3. The Zod schema rejects specific invalid inputs (testing Zod, not the app)

None of these assertions would catch a regression that isn't already caught by:
- The type system (removing a safeParse call would break the typed flow from `parsed.data`)
- The existing `boards/index.ts` test (proves the pattern works; others are copies)
- Manual testing (any route without validation would fail immediately on first bad request)

#### The real Risk #6 question

Test-fix-gaps (`context/archive/2026-06-11-test-fix-gaps/plan.md:63-64`) explicitly noted:
"App-layer userId filtering in service functions — deferred; RLS is the access control layer by
design." The frame (`context/archive/2026-06-11-test-fix-gaps/frame.md:32`) classified this as
"currently safe but fragile."

This is the real Risk #6 question: not "are Zod schemas tested?" but "is relying solely on RLS
for access control sufficient, or should service functions also filter by userId?" That's a
design decision, not a test gap — and it's explicitly accepted in the current architecture.

#### Oracle verdict (Risk #6)

The test-plan's Risk #6 description cites "unvalidated URL params, array contents, or nested
objects to Supabase." Investigation confirms this failure mode does not exist:
- No URL params are used for business data
- Array contents (repos, contributors) pass through Zod schemas with `.min(1)` on sub-fields
- Nested objects are validated by composed schemas (`repoSchema`, `contributorSchema`)

CLAUDE.md's convention ("validate input with zod") is uniformly followed. **Risk #6 is mitigated
by consistent implementation, not by tests.**

### What About §6.4 (Cookbook Gap)?

`test-plan.md §6.4` reads "TBD — see §3 Phase 3 for validation template and Zod schema patterns."
This is the only concrete artifact Phase 3 was expected to produce that doesn't exist yet.

However, §6.3 (hermetic API test patterns) already covers the same ground at a higher layer.
The `board-creation.test.ts:118-135` validation section IS the validation template — it just
lives in a hermetic test rather than a unit test. Filling §6.4 with a pointer to this existing
pattern completes the cookbook without new test infrastructure.

## Code References

- `tests/integration/access-boundary.test.ts` — full RLS coverage, 7 tables × all ops
- `tests/hermetic/board-creation.test.ts:118-135` — validation template (it.each pattern)
- `tests/helpers/seed.ts:seedTwoBoards()` — two-board test fixture
- `tests/helpers/supabase.ts` — admin client, test user factory
- `src/pages/api/boards/index.ts:25-29,52-55` — richest Zod schema + validation wiring
- `src/pages/api/github/sync.ts:8-9,39-42` — UUID regex schema
- `src/pages/api/github/collaborators.ts:7-14,48-51` — nested array schema
- `supabase/migrations/20260614120000_revoke_all_hardening.sql` — REVOKE ALL on all tables

## Architecture Insights

The validation architecture has a useful property: **every route is structurally identical.**
The `safeParse → 400` pattern is mechanical, not creative. This uniformity is itself a form of
protection — a developer copying an existing route to create a new one will naturally include the
validation wiring because it's part of the boilerplate they're copying.

The RLS architecture has the same property: every table uses `is_board_member()` /
`is_board_owner()` helpers, breaking the recursion cycle and centralizing access logic. A new
table following the same FK pattern (board_id → boards) would naturally receive the same policy
shape.

Both architectures are "pit of success" designs — the default path includes the protection.
Phase 3's templates would formalize what's already the natural development path.

## Historical Context (from prior changes)

- `context/archive/2026-06-09-testing-access-boundary/plan.md:41` — Phase 1 explicitly listed
  "Zod validation schema tests (Phase 3)" as out of scope, deferring to the rollout sequence.
- `context/archive/2026-06-11-test-fix-gaps/plan.md:63-64` — test-fix-gaps explicitly deferred
  app-layer userId filtering, accepting RLS as the sole access control layer.
- `context/archive/2026-06-11-test-fix-gaps/plan.md:471-491` — REVOKE ALL hardening + policy
  audit applied to all 7 tables, directly addressing Risk #5's "missing REVOKE" scenario.
- `context/archive/2026-06-09-testing-access-boundary/research.md:473` — Phase 1 research noted
  the consistent `is_board_member()`/`is_board_owner()` pattern enables "a single test template
  [to] cover the pattern across all tables" — which it now does.

## Related Research

- `context/archive/2026-06-09-testing-access-boundary/research.md` — RLS architecture deep-dive
- `context/archive/2026-06-10-board-creation-contract/research.md` — Board creation flow analysis
- `context/changes/validation-data-layer-templates/frame.md` — Frame brief (precedes this research)

## Open Questions

1. **Should §6.4 be filled with a pointer to the existing hermetic template, or left as TBD
   until a pure unit-test need arises?** The hermetic pattern at `board-creation.test.ts:118-135`
   covers validation at a slightly higher layer than a pure Zod schema unit test. For the current
   schemas (simple, no custom refinements or transforms), this is sufficient. If future schemas
   add `.refine()` or `.transform()` with custom logic, a pure unit-test pattern may become
   worthwhile.

2. **Should the test-plan be updated to mark Phase 3 as skipped, or should it be collapsed into
   Phase 4 (quality gates) as a minor task?** The only deliverable is filling §6.4 — which is
   a documentation update, not a test-writing task.
