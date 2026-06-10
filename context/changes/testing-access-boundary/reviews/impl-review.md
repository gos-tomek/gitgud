<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Testing Access Boundary

- **Plan**: context/changes/testing-access-boundary/plan.md
- **Scope**: All Phases (1–4)
- **Date**: 2026-06-09
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 4 warnings, 0 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

## Findings

### F1 — change.md status is "implemented" instead of "done"

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/testing-access-boundary/change.md:4
- **Detail**: Phase 4 contract says "Set status: done". Actual file has "status: implemented". All progress checkboxes are complete and all automated verification passes, so the change is factually done — the status field just wasn't updated.
- **Fix**: Change `status: implemented` to `status: done`.
- **Decision**: FIXED — status set to done in change.md

### F2 — pat-leak.test.ts afterAll cleanup not failure-safe

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: tests/integration/pat-leak.test.ts:94-98
- **Detail**: In afterAll, if server.stop() throws (e.g., process already crashed), cleanupBoard and cleanupUser calls are never reached, leaving orphaned test users and boards in local Supabase. The cleanup steps are independent and should not block each other.
- **Fix A ⭐ Recommended**: Wrap in try/finally
  - Strength: Ensures DB cleanup always runs regardless of server stop outcome. Matches the robustness of seed.ts cleanup.
  - Tradeoff: Minor — a few extra lines.
  - Confidence: HIGH — standard cleanup pattern.
  - Blind spot: None significant.
- **Fix B**: Use Promise.allSettled for independent cleanup
  - Strength: Runs all cleanup concurrently, maximally resilient.
  - Tradeoff: Server must stop before DB cleanup makes sense (server may hold connections), so full parallelism isn't quite right — stop first, then allSettled the rest.
  - Confidence: MEDIUM — mixed sequential+parallel adds complexity.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — wrapped server.stop() in try/finally

### F3 — astro-server.ts proc.unref() creates orphan risk

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: tests/helpers/astro-server.ts:40
- **Detail**: proc.unref() is called immediately after spawn with detached:true. If the test runner is killed (SIGKILL), the detached+unref'd child process group will be orphaned — no parent is waiting for it. The stop() function in afterAll handles normal cleanup, but SIGKILL bypasses afterAll.
- **Fix**: Remove proc.unref(). Vitest exits after tests complete, and afterAll calls stop(). The unref() only helps if you want the runner to exit without waiting — the opposite of what's wanted here.
- **Decision**: FIXED — proc.unref() removed from astro-server.ts

### F4 — smoke.test.ts userId cleanup not guarded

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: tests/integration/smoke.test.ts:7-8
- **Detail**: userId is declared with let but not initialized. If createTestUser fails, afterEach calls cleanupUser(undefined), triggering a Supabase API error. The boardId cleanup on the next line already has an `if (boardId)` guard — userId should follow the same pattern.
- **Fix**: Add `if (userId)` guard before `cleanupUser(userId)` in afterEach, matching the existing boardId guard pattern.
- **Decision**: SKIPPED — guard already present in current code (if (userId) on line 15)

## Notes

- The diff includes 20+ files from Prettier reformatting (commit 13e1e7e) and tooling files (.claude/settings.json, .mcp.json). All benign.
- `tests/tsconfig.json` and root `tsconfig.json` changes were unplanned but necessary infrastructure the plan overlooked.
- `vitest.config.ts` uses `defineConfig` from `vitest/config` instead of the plan's `getViteConfig()` from `astro/config`. Pragmatic simplification — integration tests don't import Astro virtual modules directly. The plan's fallback clause partially anticipated this.
- CLAUDE.md gained a Testing section documenting the new test infrastructure — useful project documentation.
