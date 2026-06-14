# Frame Brief: Test Fix Gaps

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.

## Reported Observation

During implementation of `board-creation-contract` (Phase 2) and `testing-access-boundary` (Phase 1), 10 known problems were identified, explicitly documented in tests and research as deferred behavior, and parked for later. The tests assert current (broken) behavior with inline comments like `// Known defect S3`. Now is "later."

## Initial Framing (preserved)

- **User's stated cause or approach**: The problems are known and catalogued — they were consciously parked during test-writing phases.
- **User's proposed direction**: Fix all 10 parked items now under one change (`test-fix-gaps`), fixing production code and updating tests.
- **Pre-dispatch narrowing**: User treats all 10 items equally — no category is the leading concern; all should be fixed (code + tests).

## Dimension Map

The observation (10 parked items to fix) could originate at any of these dimensions:

1. **10 independent defects** — each is a standalone bug/gap, fix them individually ← *initial framing*
2. **API endpoint structural fragility** — S3/S4/S6 are symptoms of one root: a non-atomic 4-step sequence (`POST /api/boards` makes 4 separate HTTP requests to PostgREST, each in its own DB transaction, with inconsistent compensation logic)
3. **Wizard state management fragility** — Bugs 1–4 are symptoms of one root: 17 `useState` hooks with no state machine or formal transition rules in `CreateBoardForm.tsx`
4. **Infrastructure hygiene batch** — REVOKE ALL, logger redaction, single-layer RLS are independent convention violations, not coupled to the API or wizard

## Hypothesis Investigation

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| 10 independent defects (initial framing) | All 10 confirmed as still present. But S3/S4/S6 share the same root (non-atomic sequence at `index.ts:60-102`); Bugs 1-4 share the same root (flat useState at `CreateBoardForm.tsx:48-79`). Treating them as independent would mean 10 surgical patches, several of which fix symptoms without addressing recurrence. | WEAK |
| API structural fragility | S3 (PAT failure orphans board, `index.ts:67-69`), S4 (repo failure silently swallowed, `index.ts:80-82`), S6 (cleanup-of-cleanup failure, `index.ts:94-102`) all stem from 4 sequential PostgREST calls with no wrapping transaction. Supabase JS has no `transaction()` API. Archived plan explicitly accepted this as MVP trade-off: "acceptable for MVP — no transaction rollback across RPC + table inserts." | STRONG |
| Wizard structural fragility | Bug 1 (stale contributors, `CreateBoardForm.tsx:225-228`), Bug 2 (PAT validation race, `CreateBoardForm.tsx:86-107`), Bug 3 (warnings discarded, `CreateBoardForm.tsx:172-176`), Bug 4 (empty collaborators dead-end, `CreateBoardForm.tsx:666-671`) all stem from 17 `useState` hooks with ad-hoc transition handlers. Component was already refactored twice (archived S-02/S-03). | STRONG |
| Infrastructure hygiene batch | REVOKE ALL missing on all 7 tables (`access_control.sql:29-30`, `github_ingestion.sql:84-87`, `board_contributors.sql:20`). Logger is bare consola re-export (`logger.ts:1`). Service functions `getBoardWithRole`/`getBoardRepos`/`getBoardContributors` (`boards.ts:61-114`) have zero app-layer userId filtering. All confirmed — currently safe but fragile. | STRONG (as independent category) |

## Narrowing Signals

Decisive observations from the user that narrowed the hypothesis space:

- **User did not know data hits the DB between steps.** Mental model was: wizard collects everything → one submit → one atomic write. The reality (4 sequential HTTP requests, each a separate DB transaction) was surprising. This confirms the API issue is structural, not a set of oversights — the user's correct intuition ("all or nothing") is the target behavior.
- **User chose structural fix for API**: single plpgsql function via `.rpc()` over surgical cleanup patches.
- **User chose structural fix for wizard**: reducer/state machine over 4 surgical patches.
- **User classified infra as future-proofing**, not urgent — currently safe, lower priority than the structural fixes.

## Cross-System Check

Pressure-tested the structural approach against the roadmap:

- **S-08 (edit-board-connection)** is `ready` in the roadmap — it will add PAT editing and re-validation to the wizard, directly extending both the API endpoint and the form. If the 17-useState structure and non-atomic API persist when S-08 ships, the same bug classes will compound.
- **S-10 (delete-board)** is `ready` — relates to CASCADE cleanup, same surface as S6.
- **S-11 (board-pat-expiry-freeze)** extends PAT handling further.
- The wizard was already refactored twice (archived S-02, S-03) — each pass added state without formalizing transitions. A third surgical pass would follow the same pattern.

The structural approach is justified by near-term roadmap items, not just theoretical future-proofing.

## Reframed (or Confirmed) Problem Statement

> **The actual problem to plan around is**: The board creation flow has two structurally fragile systems — a non-atomic API sequence and a flat-state wizard — whose symptoms were documented as 10 individual defects, but which share two distinct roots that will produce the same class of bugs when S-08/S-10/S-11 ship.

The initial framing ("10 items to fix") correctly identified every symptom but treated them as independent. The investigation shows they cluster into two structural problems plus one independent infra batch. Fixing the roots (atomic plpgsql function for the API, state machine for the wizard) eliminates the symptoms and prevents recurrence. The infra items (REVOKE ALL, logger, single-layer RLS) remain valid but are future-proofing — lower priority, independently scoped.

## Confidence

- **HIGH** — strong evidence from code investigation (all 10 items verified at file:line), user's own mental model confirmed the structural diagnosis, and roadmap items (S-08, S-10, S-11) validate that the structural fix is timely.

## What Changes for /10x-plan

The plan should be structured around **two structural fixes + one infra batch**, not 10 independent patches:

1. **API atomicity**: Replace the 4-step sequential endpoint with a single plpgsql function called via `.rpc()`. Update hermetic tests (H1-H8) to assert correct behavior instead of documenting defects.
2. **Wizard state machine**: Replace 17 `useState` hooks with a `useReducer` (or equivalent) with formal step transitions. Update component tests (W1-W9) to assert correct behavior instead of documenting bugs.
3. **Infrastructure hardening** (lower priority): REVOKE ALL migration for all 7 tables, logger redaction wrapper, app-layer userId checks in service functions. Update access-boundary tests to remove "gap verification" framing.

Whether these ship as one change or separate changes is a planning decision — the frame only says they are three independent scopes.

## References

- API endpoint: `src/pages/api/boards/index.ts:33-112`
- Wizard component: `src/components/CreateBoardForm.tsx`
- Logger: `src/lib/logger.ts:1`
- Service functions: `src/lib/services/boards.ts:61-114`
- Migrations: `supabase/migrations/20260529120000_access_control_and_membership.sql`, `20260531100000_github_ingestion_access.sql`, `20260602120000_board_contributors.sql`
- Research (board-creation): `context/changes/board-creation-contract/research.md`
- Research (access-boundary): `context/changes/testing-access-boundary/research.md`
- Roadmap: `context/foundation/roadmap.md` (S-08, S-10, S-11)
- Archived MVP trade-off: `context/archive/2026-06-01-link-board-to-github-org/plan.md`
