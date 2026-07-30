# Test Plan Refresh — Plan Brief

> Full plan: `context/changes/test-plan-refresh-2026-07-09/plan.md`
> Research: `context/changes/test-plan-refresh-2026-07-09/research.md`

## What & Why

Refresh `context/foundation/test-plan.md` to reflect 10 features shipped since 2026-06-14. The test base grew from zero to 32 files, 4 deferred risks activated, and 4 new risk surfaces emerged — the plan's risk map, rollout phases, and stack profile are stale.

## Starting Point

The test plan was frozen at Phase 4 (Quality Gates, 2026-06-14). Phase 5 ("Slice-ready contracts") was never formally executed — tests grew organically alongside features, leaving specific gaps in coverage for activated risks and no coverage for new risk surfaces (workflow chain, settings API auth, metric edge cases).

## Desired End State

The test plan accurately reflects the current 11-risk landscape, a 7-phase rollout with actionable next phases (5–7) targeting identified gaps, and a stack profile showing the "meaningful" test base. Anyone reading the plan can immediately see what's covered, what's not, and what to build next.

## Key Decisions Made

| Decision                         | Choice                                                         | Why (1 sentence)                                                                                         | Source |
| -------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------ |
| E2E introduction                 | Yes, scoped to workflow chain only (Phase 7)                   | Cloudflare Workflows primitives are untestable in Vitest; E2E against preview is the only automated path | Plan   |
| Phase 5 handling                 | Retire old Phase 5, add Phases 5–7                             | Organic coverage made the original scope partially obsolete; new phases target actual gaps               | Plan   |
| Ghost contributors               | Intended behavior (SET NULL)                                   | board_contributors tracks board config, not user accounts; user_profiles is what gets deleted            | Plan   |
| IC-vs-EM parity testing          | API layer                                                      | Precise, deterministic, fast — tests data contract not rendering                                         | Plan   |
| Classification retention testing | Hermetic with mocked AI binding                                | Tests the retention boundary, not AI quality; fast and deterministic                                     | Plan   |
| New phase ordering               | Deferred risk gaps first (#7–#10), then new surfaces, then E2E | Higher certainty and lower effort to close known gaps before tackling new unknowns                       | Plan   |

## Scope

**In scope:**

- §2 Risk Map: promote #7–#10, add R1/R5/R8, demote #3/#4, update response guidance
- §3 Phased Rollout: retire Phase 5, add Phases 5–7
- §4 Stack: profile → "meaningful", add Playwright row, update dates
- §6 Cookbook: cross-reference new test files to existing patterns
- §7 Exclusions: flag homepage dynamic content
- §8 Freshness Ledger: update to 2026-07-09

**Out of scope:**

- Writing new tests (that's Phases 5–7 execution)
- Changing code, CI config, or test runner
- Revisiting §1 Strategy principles

## Architecture / Approach

Single-file document update with section-by-section edits. Risk Map (§2) is the most complex change (7 new response guidance rows); Phased Rollout (§3) is the most consequential (defines what to build next). All changes preserve existing document conventions.

## Phases at a Glance

| Phase                                        | What it delivers                                   | Key risk                                            |
| -------------------------------------------- | -------------------------------------------------- | --------------------------------------------------- |
| 1. Risk Map Update (§2)                      | Accurate 11-risk active map with response guidance | Risk numbering inconsistency between §2 and §3      |
| 2. Phased Rollout Update (§3)                | Phases 5–7 with clear scopes and retirement note   | Missing a gap from research in phase scopes         |
| 3. Stack/Cookbook/Freshness (§4, §6, §7, §8) | Up-to-date stack profile, cookbook refs, dates     | Stale version numbers if package.json isn't checked |

**Prerequisites:** Research doc complete (done). Current test plan in git (done).
**Estimated effort:** ~1 session, single phase per implementer pass.

## Open Risks & Assumptions

- Hot-spot scope in §2 preamble (80 commits/30d) may need re-counting — the 58-commit workflow churn could shift the numbers
- Homepage dynamic content (get_homepage_stats RPC) is flagged for re-evaluation but not acted on — if stats accuracy becomes a user concern, it enters the risk map

## Success Criteria (Summary)

- All 11 active risks have response guidance rows
- Phases 5–7 collectively cover every gap identified in the research
- Freshness dates are 2026-07-09 and stack profile says "meaningful" (32 files)
