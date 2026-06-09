<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Link Board to GitHub Org

- **Plan**: context/changes/link-board-to-github-org/plan.md
- **Mode**: Deep
- **Date**: 2026-06-01
- **Verdict**: REVISE
- **Findings**: 0 critical · 2 warnings · 1 observation

## Verdicts

| Dimension             | Verdict |
| --------------------- | ------- |
| End-State Alignment   | PASS    |
| Lean Execution        | PASS    |
| Architectural Fitness | PASS    |
| Blind Spots           | WARNING |
| Plan Completeness     | WARNING |

## Grounding

7/7 paths ✓, 4/4 symbols ✓, brief↔plan ✗ (1 contradiction)

## Findings

### F1 — Phase 4 omits GITHUB_TOKEN_ENCRYPTION_KEY for PAT storage RPC

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 4, §1 — Expand board creation API
- **Detail**: The plan's orchestration sequence says `createBoard() → set_board_github_pat RPC → github_repos inserts` but never mentions that `set_board_github_pat` requires a third parameter `p_encryption_key` (migration line 111). The existing call site in `src/lib/github.ts:73` imports `GITHUB_TOKEN_ENCRYPTION_KEY` from `astro:env/server`, but `src/pages/api/boards/index.ts` does not — the implementer would hit a runtime error and need to discover the requirement by reading the RPC signature.
- **Fix**: Add to Phase 4 §1 Contract: "Import `GITHUB_TOKEN_ENCRYPTION_KEY` from `astro:env/server`. Pass as third argument to `set_board_github_pat` RPC (matches the pattern in `src/lib/github.ts:73-76`)."
- **Decision**: FIXED

### F2 — Brief↔Plan contradiction on shadcn/ui installation

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: plan-brief.md "Out of scope" vs plan.md "Implementation Approach"
- **Detail**: `plan-brief.md` line 48 lists "New shadcn/ui component installations" as out of scope. The plan itself requires `npx shadcn@latest add checkbox badge card skeleton input` before Phase 2, and Phases 2–4 depend on Card, Checkbox, Badge, Skeleton, and Input. The plan is authoritative, but the contradiction could confuse a reviewer or implementer reading the brief first.
- **Fix**: Remove "New shadcn/ui component installations" from the brief's Out of scope list.
- **Decision**: FIXED

### F3 — Progress section condenses some manual success criteria

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Progress section — Phases 2 and 4
- **Detail**: Phase 2 has 6 manual SC bullets but only 5 progress items — "Step 2 shows placeholder content" (SC item 3) is merged into 2.5 ("Next advances to step 2, Back returns to step 1"), dropping explicit placeholder verification. Phase 4 has 8 manual SC bullets but 7 progress items — "After creation, redirect to /boards/{id} works" (SC item 7) is merged into 4.9, dropping explicit redirect verification. Neither is likely to cause implementation issues but creates a gap between what success criteria promise and what the checklist tracks.
- **Fix**: Split 2.5 into two items (2.5 "Next advances to step 2, step 2 shows placeholder content" + 2.5b "Back returns to step 1") or add 2.9 "Step 2 shows placeholder + Create Board button". Add 4.11 "After creation, redirect to /boards/{id} works."
- **Decision**: FIXED
