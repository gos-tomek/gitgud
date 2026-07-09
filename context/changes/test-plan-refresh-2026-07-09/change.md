---
change_id: test-plan-refresh-2026-07-09
title: Refresh test plan to reflect 10 features shipped since June 2026
status: implementing
created: 2026-07-09
updated: 2026-07-09
archived_at: null
---

## Notes

Update the existing test plan to reflect 10 features shipped since 2026-06-14.

What changed since last update:

- 4 of 5 deferred risks activated (#7-#10): S-04, S-10, F-03, F-04 all shipped
- New risk surface: workflow chain integrity (user's #1 concern, 58 commits/30d), settings API (7 new endpoints), dashboard metric correctness, account deletion cascade
- Test-base profile changed from "none" to "meaningful" (32 files)
- Risks #3/#4 from original plan now covered by Phase 2 tests — demote

Refreshed risk map (8 risks: R1-R8) and 3 new rollout phases (5-7) are documented in the conversation. The plan update should:

1. Update §2 Risk Map: demote #3/#4, promote deferred #7-#10 to active, add R1 (workflow chain), R5 (settings API), R8 (metric correctness)
2. Update §3 Phased Rollout: replace Phase 5 scope, add Phases 6-7
3. Update §4 Stack: profile → "meaningful", update tool dates
4. Update §6 Cookbook: note which new test files exist but aren't documented
5. Update §7: confirm homepage + static pages still excluded
6. Update §8 Freshness Ledger dates
