# Deferred Risk Gap Closure — Plan Brief

> Full plan: `context/changes/deferred-risk-gap-closure/plan.md`

## What & Why

Close test coverage gaps for three deferred risks promoted to active on 2026-07-09: IC-vs-EM data parity (#7), board-only deletion cascade (#8), and classification content retention (#9). These risks were originally deferred because their prerequisite feature slices hadn't shipped; now that the code exists, the test plan requires explicit coverage before moving to E2E phases.

## Starting Point

The project has 32 test files across 4 layers. Existing tests partially touch these risks: `impact-access.test.ts` tests auth guards but not payload comparison, `account-deletion.test.ts` tests user-delete cascade but not board-only delete, and `classification-voting.test.ts` tests return value shape but not upsert payload. The shared `seedTwoBoards()` fixture seeds 6 tables but not `thread_classifications`.

## Desired End State

Three new/extended test files that prove: (1) IC and EM see identical data from all impact endpoints, (2) deleting a board as owner clears all 7 child tables, and (3) the classification upsert payload contains only label fields, no raw comment text. All run in CI without additional infrastructure.

## Key Decisions Made

| Decision                  | Choice                          | Why (1 sentence)                                                                                                                 |
| ------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Risk #10 scope            | Defer to E2E Phase 8            | No link-github-account endpoint exists; identity bridge is best tested in the full signup browser flow.                          |
| Parity endpoint scope     | All 6 impact endpoints          | Guards against future role-based filtering being added to any endpoint, not just summary.                                        |
| Board cascade depth       | All 7 child tables              | A missing CASCADE on any intermediate table (e.g. board_contributors) would be invisible if only leaf tables are checked.        |
| Classification test level | Hermetic upsert assertion       | Schema has no body column (structural defense); hermetic assertion guards the code path at minimal cost vs integration overhead. |
| AI Gateway collectLog     | Out of scope                    | Infrastructure config, not code-testable from vitest; documented as open risk.                                                   |
| Seed data strategy        | Extend seedTwoBoards()          | Single fixture serves both parity and cascade tests; avoids duplicate seed logic.                                                |
| Board deletion file org   | New file board-deletion.test.ts | Board-only delete is a different RLS code path than account delete; clean separation.                                            |

## Scope

**In scope:**

- Extend `seedTwoBoards()` with `thread_classifications` row
- New integration test: `impact-parity.test.ts` (risk #7)
- New integration test: `board-deletion.test.ts` (risk #8)
- Extended hermetic test: `classification-voting.test.ts` (risk #9)

**Out of scope:**

- Risk #10 (OAuth identity mismatch) — Phase 8
- AI Gateway content retention — infra review
- Schema snapshot tests
- Integration-level classification test

## Phases at a Glance

| Phase              | What it delivers                                                           | Key risk                                                                         |
| ------------------ | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 1. Seed + parity   | Extended fixture + IC-vs-EM payload comparison across all impact endpoints | Endpoints may return empty data if seed is insufficient — parity holds trivially |
| 2. Board cascade   | Board-only DELETE cascade proof across 7 child tables via RLS              | Cleanup logic must handle the deleted board (no double-delete in afterAll)       |
| 3. Retention guard | Upsert payload shape assertion — no body/content fields                    | Assertion must track ClassificationResult type changes                           |

**Prerequisites:** Local Supabase running (`npx supabase start`) for Phases 1-2; no external deps for Phase 3.
**Estimated effort:** ~1 session across 3 phases.

## Open Risks & Assumptions

- AI Gateway `collectLog: true` means raw comment text may persist in Cloudflare logs — unaddressed until infra review
- Risk #10 (OAuth identity mismatch) remains unprotected until E2E Phase 8
- Parity test assumes the service layer returns non-empty data for the seeded fixture; if endpoints return `[]` for both roles the comparison passes trivially

## Success Criteria (Summary)

- `npm test` passes with 3 new/extended test files covering risks #7, #8, #9
- CI `validate` and `test-integration` jobs remain green
- Test plan §6.7 updated with new file entries referencing the risks covered
