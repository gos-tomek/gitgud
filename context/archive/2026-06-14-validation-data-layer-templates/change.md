---
change_id: validation-data-layer-templates
title: RLS regression and Zod validation test templates
status: archived
created: 2026-06-14
updated: 2026-06-14
archived_at: 2026-06-14T13:25:43Z
---

## Notes

Phase 3 of context/foundation/test-plan.md rollout (§3, row 3): "Validation + data layer templates".

Goal: RLS regression template for new tables; validation test template for API routes.

Risks covered: #5 (RLS policy gap on new tables), #6 (server trusts client on API boundaries).

Test types: integration (RLS per-table), unit (Zod schemas).

## Resolution

Frame + research (HIGH confidence) concluded Phase 3 is unnecessary: risk #5 is fully mitigated by
Phase 1's RLS coverage (all 7 tables × all policy-defined operations, plus REVOKE ALL hardening from
test-fix-gaps), and risk #6 is mitigated by consistent `safeParse → 400` Zod wiring across all 7 API
routes — no new test code adds signal beyond what the type system and existing
`board-creation.test.ts` validation test already prove.

No new test infrastructure was written. Instead, `context/foundation/test-plan.md` was updated
directly:
- §3 row 3 marked "skipped — covered by Phase 1 + Phase 2 patterns", linked to this change folder.
- §6.4 (Zod unit test pattern) filled with a pointer to the existing hermetic template
  (`board-creation.test.ts:118-135`).
- §6.6 (RLS test for new migration) filled with a pointer to §6.1's existing per-table pattern.
- §6.5's dangling "Phase 3" reference fixed to point at §6.4.

Next rollout phase is Phase 4 (Quality gates — wire vitest into CI).
