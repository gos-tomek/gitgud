# Frame Brief: Do We Need Phase 3 (Validation + Data Layer Templates)?

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.

## Reported Observation

Phase 3 of the test-plan rollout ("Validation + data layer templates") is next in line,
covering risks #5 (RLS policy gap on new tables) and #6 (server trusts client on API
boundaries). The user questions whether this test set is needed at all.

## Initial Framing (preserved)

- **User's stated cause or approach**: "We already have this covered in tests" — existing tests
  may already address what Phase 3 would deliver.
- **User's proposed direction**: Potentially skip or drop Phase 3 from the rollout.
- **Pre-dispatch narrowing**: User sees both halves (RLS + validation) as potentially redundant
  but hasn't separated them; wants to verify coverage before committing effort.

## Dimension Map

The question "is Phase 3 needed?" could resolve along these dimensions:

1. **RLS template is redundant** — Phase 1 already covers all tables with a reusable pattern
2. **Validation tests are missing** — 6/7 API routes have Zod schemas but no tests
3. **Validation gap is low-risk** — all routes use Zod with simple schemas; testing them tests the library, not the app
4. **Phase 3 bundles two unrelated things** — conflating a done item (RLS) with a partially-open one (validation) makes the whole phase feel unnecessary

## Hypothesis Investigation

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| RLS template is redundant | `tests/integration/access-boundary.test.ts` covers all 7 tables × all policy-defined operations (SELECT/INSERT/UPDATE/DELETE). Pattern is copy-friendly — adding a new table takes ~5 min. `tests/helpers/seed.ts:seedTwoBoards()` and `tests/helpers/supabase.ts:createTestUser` provide full scaffolding. Cookbook §6.1 documents the pattern. | **STRONG** |
| Validation tests are missing | Only `POST /api/boards` tested (`tests/hermetic/board-creation.test.ts:118-135`). 6 routes have schemas but no tests: `check-name.ts:5`, `repos.ts:7`, `validate-pat.ts:7`, `validate-repo.ts:7`, `collaborators.ts:7`, `sync.ts:8`. | **STRONG** (gap exists) |
| Validation gap is low-risk | All 7 routes follow identical `safeParse → 400` wiring. Most schemas are `z.string().min(1)` — testing them tests Zod, not the app. Richer schemas: `sync.ts:9` (UUID regex), `collaborators.ts:7-14` (nested array), `check-name.ts:6` / `boards/index.ts:26` (trim+max). These have slightly more regression surface but are still single-line Zod declarations, not custom logic. | **STRONG** |
| Phase 3 bundles two unrelated things | RLS template (done) and validation tests (low-value) are packaged as one phase, creating an all-or-nothing framing that obscures the actual state. | **STRONG** |

## Narrowing Signals

- User confirmed the concern applies to both halves equally — not one driving the doubt.
- User was uncertain whether the validation gap is real or low-value, indicating no known incident or pressure behind Risk #6.
- No new tables are on the immediate roadmap — deferred risks #7–#11 activate with future slices (S-04, S-10, F-03, F-04, S-11). The RLS template has no imminent consumer.

## Cross-System Convention

The board-creation hermetic test (`tests/hermetic/board-creation.test.ts:118-135`) already serves as a
de facto validation template: `it.each` with `[fieldName, mutatedBody, expectedMessage]`, asserting 400
status + message + no side-effect call. Anyone adding a new route can copy this pattern in minutes.
Cookbook §6.3 documents hermetic test patterns. §6.4 ("Adding a unit test — Zod schema / pure function")
is marked TBD for Phase 3, but the hermetic approach already covers the same ground at a higher layer.

## Reframed (or Confirmed) Problem Statement

> **The actual problem to plan around is**: Phase 3 as a standalone rollout phase is unnecessary —
> its RLS half is already fully delivered by Phase 1, and its validation half is low-value because
> all routes already wire Zod schemas in an identical pattern, making the regression risk minimal.

The initial framing was correct: existing tests already cover the substance of what Phase 3 would
deliver. The RLS template is a complete, documented, copy-friendly pattern. The validation gap
(6 untested routes) is real but low-risk — the schemas are simple, the wiring is consistent, and
no incident or business pressure motivates dedicated tests. The 2-3 richer schemas (UUID regex,
nested arrays, trim+max) could receive lightweight tests as part of normal development when those
routes change, rather than as a dedicated rollout phase.

## Confidence

**HIGH** — strong evidence on all four dimensions, no conflicting signals, user's intuition aligns
with investigation findings.

## What Changes for /10x-plan

Phase 3 should be **dropped or collapsed**. Recommended actions:
- Mark Phase 3 as "skipped — covered by Phase 1 + Phase 2 patterns" in `test-plan.md §3`.
- Fill in §6.4 (Zod unit test pattern) with a pointer to the existing hermetic template at `board-creation.test.ts:118-135` rather than creating new infrastructure.
- Advance directly to Phase 4 (Quality gates — wire vitest into CI).

## References

- `tests/integration/access-boundary.test.ts` — full RLS coverage, 7 tables × all operations
- `tests/hermetic/board-creation.test.ts:118-135` — validation template (it.each pattern)
- `tests/helpers/seed.ts`, `tests/helpers/supabase.ts` — test scaffolding
- `context/foundation/test-plan.md §3` — Phase 3 definition
- `context/foundation/test-plan.md §6.1–§6.3` — existing cookbook patterns
- API routes: `src/pages/api/boards/index.ts:25`, `src/pages/api/github/sync.ts:8`, `src/pages/api/github/collaborators.ts:7`
