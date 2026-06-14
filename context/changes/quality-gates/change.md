---
change_id: quality-gates
title: Wire vitest into CI and set minimum quality gates
status: implementing
created: 2026-06-14
updated: 2026-06-14
archived_at: null
---

## Notes

Phase 4 of the test-plan rollout (context/foundation/test-plan.md §3, row 4):
wire vitest into CI, set a minimum signal floor, and update project
conventions / §6 cookbook. Cross-cutting — supports the quality gates table
in §5 (unit + integration and component test gates currently marked
"required after §3 Phase 1/2" but not yet wired into `.github/workflows/ci.yml`).
