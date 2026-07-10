# Test Plan Refresh Implementation Plan

## Overview

Update `context/foundation/test-plan.md` to reflect the current state of the project after 10 features shipped since 2026-06-14. Four deferred risks activated (#7–#10), four new risk surfaces emerged (R1, R5, R8, account deletion edge cases), and the test base grew from zero to 32 files. The refresh updates §2 (Risk Map), §3 (Phased Rollout), §4 (Stack), §6 (Cookbook), §7 (Exclusions), and §8 (Freshness Ledger).

## Current State Analysis

The test plan was last updated 2026-06-14 during Phase 4 (Quality Gates). Since then:

- **Test base**: 0 → 32 files (6 unit, 6 component, 14 hermetic, 6 integration) + 5 helpers
- **Deferred risks**: 4 of 5 activated (#7 data parity, #8 deletion cascade, #9 classification retention, #10 OAuth identity). #11 (PAT expiry) remains deferred
- **New surfaces**: Workflow chain (58 commits of churn), settings API (6–7 mutation endpoints), metric correctness (1146-line service)
- **Phase 5** ("Slice-ready contracts") never formally executed — tests grew organically alongside features, leaving specific gaps

### Key Discoveries:

- Risks #3 (board wizard) and #4 (board creation partial failure) are now fully covered by Phase 2 tests — safe to demote to "mitigated"
- Workflow chain orchestration (`src/worker.ts`) is untestable in Vitest due to Cloudflare Workflows primitives (`step.do`/`step.sleep`) — E2E is the only automated path for chain-level confidence
- Settings API relies entirely on RLS for authorization — no integration test verifies non-owner rejection
- IC-vs-EM parity (Risk #7) has API-layer tests for individual metrics but no comparative assertion between roles
- Ghost contributors (SET NULL on `user_id` in `board_contributors`) are intended behavior — `board_contributors` tracks board configuration, not user accounts; `user_profiles` is what gets deleted

## Desired End State

After this plan is complete, `context/foundation/test-plan.md` accurately reflects:

- An 11-risk active map (6 original with 2 demoted + 4 promoted from deferred + 3 new) with updated coverage notes
- A 7-phase rollout with Phases 1–4 historically accurate and Phases 5–7 targeting identified gaps
- Stack profile showing the current "meaningful" test base (32 files) with Playwright/E2E as a new planned layer
- Updated cookbook with references to test files added since Phase 4
- Updated freshness ledger dated 2026-07-09

Verification: diff the updated file against the current version; confirm every section mentioned in this plan was modified; spot-check risk numbering consistency; verify Phase 5–7 scopes cover all gaps from the research.

## What We're NOT Doing

- Writing new tests — this plan only updates the test plan document; tests are written in Phases 5–7
- Changing the test runner, CI config, or any code
- Revisiting §1 (Strategy) — the three principles remain valid
- Adding new cookbook sections — only noting which existing test files cover new patterns
- Resolving the TOCTOU race on board rename (R5) — that's a code fix, not a test plan concern

## Implementation Approach

Single-phase document edit. The test plan is one file with clear section boundaries. We'll update each section in sequence, preserving the document's existing structure and conventions. Risk Map changes are the most complex (promotion, demotion, new entries, updated response guidance); Phased Rollout is the most consequential (retiring Phase 5, defining 3 new phases).

## Phase 1: Risk Map Update (§2)

### Overview

Update the active and deferred risk tables to reflect current state: demote 2 mitigated risks, promote 4 activated deferred risks, add 3 new risks, keep 1 deferred.

### Changes Required:

#### 1. Active Risk Table

**File**: `context/foundation/test-plan.md` (§2 Risk Map, active table)

**Intent**: Restructure the active risk table to reflect the current 11-risk landscape. Demote #3 and #4 by adding a "Status: mitigated" annotation (keep them in the table for historical reference but mark coverage). Promote #7–#10 from deferred to active with updated Likelihood based on shipped code. Add R1 (workflow chain integrity), R5 (settings API auth boundaries), R8 (metric correctness edge cases) as new active entries.

**Contract**: The active table gains rows for risks #7–#10 (moved from deferred) and new risks R1, R5, R8. Risks #3 and #4 get a "(mitigated — Phase 2)" suffix in the Risk column. New risks use the same column schema: `#, Risk (failure scenario), Impact, Likelihood, Source (evidence)`.

New risk definitions:

| #   | Risk                                                                                                                                                                            | Impact | Likelihood |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------- |
| R1  | Workflow chain breaks silently — a mid-chain phase (prdetails/reviews/classify) fails, and downstream phases proceed on stale or missing data with no alert                     | High   | High       |
| R5  | Settings API unauthorized mutation — non-owner renames, deletes board, or modifies repos/contributors through API routes that rely solely on RLS                                | High   | Medium     |
| R8  | Dashboard metrics silently wrong — self-review exclusion drift, division-by-zero on empty boards, or date-range boundary errors produce incorrect numbers without visible error | Medium | Medium     |

#### 2. Deferred Risk Table

**File**: `context/foundation/test-plan.md` (§2 Risk Map, deferred table)

**Intent**: Remove #7–#10 from the deferred table (they're now active). Keep #11 (PAT expiry) as the sole deferred risk.

**Contract**: Deferred table retains only row #11. Add a note above: "Risks #7–#10 promoted to active (2026-07-09) — see active table above."

#### 3. Risk Response Guidance Table

**File**: `context/foundation/test-plan.md` (§2 Risk Map, response guidance table)

**Intent**: Add response guidance rows for each new/promoted risk (#7, #8, #9, #10, R1, R5, R8). Follow the existing column schema: `Risk, What would prove protection, Must challenge, Context /10x-research must ground, Likely cheapest layer, Anti-pattern to avoid`.

**Contract**: 7 new rows in the response guidance table. Key entries:

- **#7**: Cheapest layer = Integration (same API, two roles, compare payloads). Anti-pattern = testing only that each role gets data without comparing they get the same data.
- **#8**: Cheapest layer = Integration (delete board, verify cascade via admin client). Anti-pattern = testing only account deletion without board-only deletion.
- **#9**: Cheapest layer = Hermetic (mock AI binding, assert stored output has labels not raw text). Anti-pattern = testing classification accuracy instead of retention boundary.
- **#10**: Cheapest layer = Integration (create user, link GitHub, verify identity bridge). Anti-pattern = testing only the OAuth redirect without verifying the auto-match trigger.
- **R1**: Cheapest layer = Hermetic for mid-chain failure + E2E for full chain. Anti-pattern = testing individual sync functions without chain-level orchestration.
- **R5**: Cheapest layer = Integration (non-owner calls mutation endpoints, assert rejection). Anti-pattern = testing only that the owner can mutate without testing that non-owner is denied.
- **R8**: Cheapest layer = Unit/hermetic (fixture data with edge cases). Anti-pattern = testing only with "normal" data volumes without zero-PR or self-review-only scenarios.

### Success Criteria:

#### Automated Verification:

- Document renders valid markdown: no broken table syntax
- All risk numbers referenced in §3 phases exist in §2 tables
- No duplicate risk numbers

#### Manual Verification:

- Risk descriptions accurately reflect failure scenarios from research
- Impact/Likelihood ratings are reasonable given the evidence
- Response guidance is actionable and follows existing conventions

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Phased Rollout Update (§3)

### Overview

Retire old Phase 5, define three new phases (5–7) targeting the gaps identified in research, and update Phases 1–4 statuses with archive folder references.

### Changes Required:

#### 1. Phases 1–4 Status Updates

**File**: `context/foundation/test-plan.md` (§3 Phased Rollout table)

**Intent**: Update Phase 1–4 rows with accurate status and change folder references pointing to `context/archive/` paths (these phases are all shipped or skipped).

**Contract**: Phase rows 1–4 keep their current structure. Update `Change folder` to `context/archive/` paths where applicable (Phase 1: `context/archive/2026-06-09-testing-access-boundary/`, Phase 2: `context/archive/2026-06-10-board-creation-contract/`, Phase 3: `context/archive/2026-06-14-validation-data-layer-templates/`, Phase 4: `context/archive/2026-06-14-quality-gates/`).

#### 2. Retire Old Phase 5 and Add Phases 5–7

**File**: `context/foundation/test-plan.md` (§3 Phased Rollout table)

**Intent**: Replace the old Phase 5 row with three new phases that target specific gaps identified in the research. Phase 5 closes gaps in activated deferred risks. Phase 6 covers new risk surfaces. Phase 7 introduces scoped E2E testing.

**Contract**: Three new rows in the rollout table:

| #   | Phase name                | Goal                                                                                                                                                             | Risks covered   | Test types                  | Status      | Change folder |
| --- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | --------------------------- | ----------- | ------------- |
| 5   | Deferred risk gap closure | Close coverage gaps in activated deferred risks: IC-vs-EM parity assertion, board-only deletion cascade, classification content retention, OAuth identity bridge | #7, #8, #9, #10 | integration, hermetic       | not started | —             |
| 6   | New risk surfaces         | Cover workflow chain mid-failure recovery, settings API auth boundaries, metric correctness edge cases                                                           | R1, R5, R8      | hermetic, integration, unit | not started | —             |
| 7   | E2E workflow chain        | Prove manual sync trigger → data appears flow via Playwright against deployed Cloudflare preview                                                                 | R1              | e2e (Playwright)            | not started | —             |

Add a note below the table: "Phase 5 was originally 'Slice-ready contracts' — retired 2026-07-09 because organic test coverage was added alongside feature slices. Remaining gaps are now addressed by Phases 5–7 above."

### Success Criteria:

#### Automated Verification:

- All risk numbers in Phase rows exist in §2
- Phase numbers are sequential (1–7)
- No phase references a change folder under `context/archive/` with status "not started"

#### Manual Verification:

- Phase 5–7 scopes collectively cover all gaps from the research
- No gap identified in research is missing from a phase
- Phase ordering reflects the agreed priority (deferred gaps first, new surfaces second, E2E third)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Stack, Cookbook, Exclusions & Freshness Update (§4, §6, §7, §8)

### Overview

Update remaining sections to reflect the current test base, tooling, and coverage state.

### Changes Required:

#### 1. Stack Profile (§4)

**File**: `context/foundation/test-plan.md` (§4 Stack)

**Intent**: Update the test-base profile from "none" to "meaningful" (32 files). Update the tool table with current versions and add Playwright/E2E as a planned layer. Update stack grounding tools with current dates.

**Contract**:

- Profile line: `Test-base profile: **meaningful** — 32 test files (6 unit, 6 component, 14 hermetic, 6 integration) + 5 helpers.`
- Tool table: update unit+integration row to show Vitest as installed with version from package.json, component row shows @testing-library/react as installed, API mocking shows vi.mock/vi.hoisted pattern, e2e row shows "Playwright — planned (Phase 7)", accessibility stays "none yet"
- Stack grounding tools: update `checked:` dates to `2026-07-09`, note Playwright MCP as available

#### 2. Cookbook Notes (§6)

**File**: `context/foundation/test-plan.md` (§6 Cookbook Patterns)

**Intent**: Add a §6.7 note documenting which test files were added organically since Phase 4 and which patterns they follow. This is not writing new cookbook sections — it's cross-referencing existing tests to cookbook patterns.

**Contract**: §6.7 "Per-rollout-phase notes" gets content listing the 32 test files grouped by the cookbook pattern they follow (§6.1 integration, §6.2 component, §6.3 hermetic, §6.4 unit). Include one sentence per notable new test file explaining what risk it covers.

#### 3. Exclusions Check (§7)

**File**: `context/foundation/test-plan.md` (§7 What We Deliberately Don't Test)

**Intent**: Verify the two existing exclusions still hold. Homepage gained dynamic content (`get_homepage_stats` RPC, KV caching) — flag this as a potential re-evaluation trigger.

**Contract**: Keep both exclusions. Add a note to the static pages entry: "Note: homepage (`src/pages/index.astro`) now includes dynamic stats via `get_homepage_stats` RPC — re-evaluate if stats accuracy becomes a risk."

#### 4. Freshness Ledger (§8)

**File**: `context/foundation/test-plan.md` (§8 Freshness Ledger)

**Intent**: Update all dates to 2026-07-09.

**Contract**: All three `last reviewed/verified` dates become `2026-07-09`.

### Success Criteria:

#### Automated Verification:

- `grep -c "2026-07-09" context/foundation/test-plan.md` returns at least 3 (freshness dates)
- §4 mentions "meaningful" and "32"
- §6.7 is non-empty

#### Manual Verification:

- Stack versions match actual `package.json` entries
- Cookbook cross-references point to existing test files
- §7 homepage note accurately reflects current state

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

This plan updates a documentation file, not application code. Testing is manual review.

### Manual Testing Steps:

1. Read the updated test plan end-to-end for internal consistency
2. Verify all risk numbers cross-reference correctly between §2 and §3
3. Spot-check file references against actual filesystem (`ls tests/`)
4. Confirm the Phase 5 retirement note is clear about what happened and why
5. Verify the hot-spot scope in §2 preamble still makes sense (update commit count if needed)

## Performance Considerations

None — this is a document update.

## Migration Notes

None — the test plan is a living document. Previous versions are in git history.

## References

- Research: `context/changes/test-plan-refresh-2026-07-09/research.md`
- Current test plan: `context/foundation/test-plan.md`
- Archived phases: `context/archive/2026-06-09-testing-access-boundary/`, `context/archive/2026-06-10-board-creation-contract/`, `context/archive/2026-06-14-validation-data-layer-templates/`, `context/archive/2026-06-14-quality-gates/`
- Workflow untestability: `context/archive/2026-06-30-bugfix/plan.md`
- Thin RLS wrapper convention: `context/archive/2026-07-07-delete-board/`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Risk Map Update (§2)

#### Automated

- [x] 1.1 Document renders valid markdown (no broken table syntax) — ecb9859
- [x] 1.2 All risk numbers in §3 exist in §2 — ecb9859
- [x] 1.3 No duplicate risk numbers — ecb9859

#### Manual

- [ ] 1.4 Risk descriptions match research findings
- [ ] 1.5 Response guidance is actionable

### Phase 2: Phased Rollout Update (§3)

#### Automated

- [x] 2.1 Risk numbers in Phase rows exist in §2
- [x] 2.2 Phase numbers are sequential (1–7)

#### Manual

- [x] 2.3 Phase 5–7 scopes cover all research gaps
- [x] 2.4 Phase ordering matches agreed priority

### Phase 3: Stack, Cookbook, Exclusions & Freshness (§4, §6, §7, §8)

#### Automated

- [ ] 3.1 Freshness dates updated to 2026-07-09
- [ ] 3.2 Stack profile says "meaningful" and "32"
- [ ] 3.3 §6.7 is non-empty

#### Manual

- [ ] 3.4 Stack versions match package.json
- [ ] 3.5 Cookbook cross-references point to existing files
- [ ] 3.6 §7 homepage note is accurate
