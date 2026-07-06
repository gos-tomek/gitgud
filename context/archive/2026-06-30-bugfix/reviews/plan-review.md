<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Fix GitHub Sync Workflow Subrequest Crashes and Chain Ordering

- **Plan**: context/changes/bugfix/plan.md
- **Mode**: Deep
- **Date**: 2026-06-30
- **Verdict**: SOUND (after triage fixes)
- **Findings**: 2 critical, 1 warning, 0 observations

## Verdicts

| Dimension             | Verdict |
| --------------------- | ------- |
| End-State Alignment   | WARNING |
| Lean Execution        | PASS    |
| Architectural Fitness | PASS    |
| Blind Spots           | PASS    |
| Plan Completeness     | FAIL    |

## Grounding

Grounding: 5/5 paths ✓, 16/16 symbols ✓, brief↔plan ✓

## Findings

### F1 — Import cleanup instruction would break the build

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1, Change 5 — Clean up imports
- **Detail**: The plan says: "Remove getGitHubToken and makeOctokit from the @/lib/github import (dispatcher no longer uses them)." But `runSyncRepo` (worker.ts:186-189) still calls both: `getGitHubToken(supabase, boardId, ...)` and `makeOctokit(githubToken)`. The plan correctly identified the dispatcher no longer needs them, but incorrectly concluded they can be removed from the file — sync-repo (same file) still depends on both. Following this instruction literally produces a tsc error.
- **Fix**: Remove Change 5 entirely. The only actual import cleanup is removing the `RepoTarget` interface (which is inline, not an import). `getGitHubToken` and `makeOctokit` must stay.
- **Decision**: FIXED — Change 5 rephrased: scoped to removing inline `RepoTarget` interface only, imports explicitly kept for `runSyncRepo`.

### F2 — Progress section mismatches plan phases

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: ## Progress (bottom of plan)
- **Detail**: Three categories of mismatch that will break /10x-implement parsing: (a) Title case mismatch — plan body uses title case ("Rebuild Workflow Orchestration"), Progress uses sentence case ("Rebuild workflow orchestration"). Same for Phases 2 and 3. (b) Missing Progress items — Phase 1 Manual has 6 Success Criteria bullets but only 3 Progress items (missing: "Trigger manual sync", "Workflow instances visible", "last_synced_at updated"). Phase 2 Automated has 4 bullets but 3 Progress items (missing: "No import errors"). Phase 3 Automated has 4 bullets but 3 Progress items (missing: "Pre-commit hooks pass"). Phase 3 Manual has 1 bullet but 0 Progress items (no manual subsection). (c) Numbering gap: Phase 2 has no 2.4 Automated for the grep check, but the 2.4 slot is used by the Manual item.
- **Fix**: Align Progress titles to exact plan-body casing. Add one checklist line per Success Criteria bullet. Add Phase 3 Manual subsection with item 3.4.
- **Decision**: FIXED — Titles aligned to title case, missing items added (Phase 1 Manual: 3→6, Phase 2 Automated: +2.4, Phase 3 Automated: +3.4, Phase 3 Manual: added with 3.5).

### F3 — Budget table exceeds Desired End State target

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: End-State Alignment
- **Location**: Desired End State + Subrequest Budget Summary
- **Detail**: Desired End State says "under 30 subrequests (40% headroom)." Budget Summary table shows sync-repo PR details at ~31 subrequests (5 GQL × 6 + token), with 38% headroom. The plan's own math contradicts its stated target — 31 > 30.
- **Fix**: Update Desired End State to say "under 32 subrequests (36% headroom)" to match actual budget math, or note that 30 is the target for new phases while PR details is an accepted exception at 31.
- **Decision**: FIXED — Desired End State updated to "under 32 subrequests (36% headroom)", budget summary footer aligned.
