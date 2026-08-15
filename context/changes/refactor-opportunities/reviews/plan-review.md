<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Refactor opportunities — Implementation Plan

- **Plan**: `context/changes/refactor-opportunities/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-15
- **Verdict**: REVISE → SOUND (after fixes)
- **Findings**: 0 critical 2 warnings 1 observation

## Verdicts

| Dimension             | Verdict |
| --------------------- | ------- |
| End-State Alignment   | PASS    |
| Lean Execution        | PASS    |
| Architectural Fitness | PASS    |
| Blind Spots           | PASS    |
| Plan Completeness     | WARNING |

## Grounding

12/12 paths ✓, 4/4 symbols ✓, brief↔plan ✓

New files (workflow-contract.ts, api-routes.ts, src/db/) correctly absent — to be created.

## Findings

### F1 — parseBoardInstanceId parsing algorithm unspecified

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §1 — New: workflow-contract module
- **Detail**: The plan specified the public contract but not the parsing algorithm. The format `board-${boardId}-${dateStamp}` has hyphens in both parts (UUID boardIds, YYYY-MM-DD dateStamps), making a naive implementation silently wrong. The parse is unambiguous when anchored to `/^board-(.+)-(\d{4}-\d{2}-\d{2})$/` — but the plan didn't say this.
- **Fix**: Added the regex spec and rationale to §1 of the workflow-contract module section.
- **Decision**: FIXED (via single fix — regex spec added to plan §1)

### F2 — Phase 3 URL-to-path normalization strategy not specified

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Phase 3 §3 — New hermetic test: URL contract enforcement
- **Detail**: The plan said to "replace path segments matching the route param with `[param]`" but didn't say how the test identifies which segments are dynamic vs. literal. A heuristic approach could false-negative on a renamed route — the exact failure mode the test is meant to prevent (PR #32).
- **Fix A ⭐ Applied**: Replaced the implementation spec with an inside-out approach — enumerate actual route files first from `src/pages/api/**`, convert their filenames to URL patterns, then match helper URLs against those patterns using `fs.readdirSync` (no extra dep).
- **Decision**: FIXED via Fix A

### F3 — fast-glob availability as a dep unverified

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 §3 — New hermetic test
- **Detail**: The plan suggested fast-glob as an option ("already an indirect dep via Vitest") unverified. Resolved as a side effect of F2's fix — the spec now uses `fs.readdirSync`.
- **Decision**: FIXED (side effect of F2 fix)
