<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Invite and Join Board

- **Plan**: context/changes/invite-and-join-board/plan.md
- **Mode**: Deep
- **Date**: 2026-06-02
- **Verdict**: REVISE → SOUND (after triage fixes)
- **Findings**: 1 critical, 2 warnings, 0 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | WARNING |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | FAIL |

## Grounding

6/6 paths ✓, 6/6 symbols ✓, brief↔plan ✓

## Findings

### F1 — Progress section missing checkboxes for 4 success criteria

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: ## Progress — Phases 2, 3, 4
- **Detail**: The Progress section does not have a 1:1 mapping with Success Criteria bullets. /10x-implement parses Progress checkboxes mechanically — missing items mean those criteria won't be tracked or verified. Missing checkboxes: (1) Phase 2 Automated: "Endpoint returns valid JSON matching the response schema" — no 2.3. (2) Phase 2 Manual: "Verify collaborators from multiple repos are merged by github_id (no duplicates)" — no 2.5. (3) Phase 3 Manual: criteria 2 ("deduplicated collaborators") and 3 ("filter narrows list") merged into single 3.5 — should be 2 separate items. (4) Phase 4 Manual: "Contributors match what was selected during board creation" — no 4.5 (current 4.5 should become 4.6).
- **Fix**: Add the 4 missing checkboxes and renumber.
- **Decision**: FIXED — added 4 missing checkboxes and renumbered Phases 2, 3, 4

### F2 — Per-repo 403 unhandled in collaborators endpoint

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 2 — Collaborators API endpoint
- **Detail**: The plan says (plan-brief.md, Open Risks): "The existing PAT validation (which checks `repo` scope) should cover this." But validate-pat.ts:52 only calls getAuthenticated() — it does not inspect scopes at all. More importantly, the repos.ts endpoint calls listForAuthenticatedUser (always succeeds if PAT is alive), but the collaborators endpoint calls listCollaborators per repo. If the PAT owner lacks push/admin access on one repo, that call returns 403. The plan specifies only endpoint-level error mapping (401/500) — a single repo 403 would abort the entire fetch and surface as a generic 500 to the user.
- **Fix A ⭐ Recommended**: Skip repos that 403, return partial results + warnings
  - Strength: Resilient — the EM still sees collaborators from repos they have access to. Matches GitHub UI behavior (some repos may be restricted).
  - Tradeoff: Response schema grows — needs a `warnings` array alongside `collaborators`.
  - Confidence: HIGH — standard partial-success pattern for multi-resource fetches.
  - Blind spot: None significant.
- **Fix B**: Validate listCollaborators access upfront during PAT validation
  - Strength: Fails fast — EM knows at step 1 their PAT won't work.
  - Tradeoff: PAT validation can't know which repos will be selected in step 2, so this check would need to run between step 2 and step 3 — adding a new validation round-trip.
  - Confidence: MEDIUM — increases complexity without fully solving the problem (new repos could be added later via S-09).
  - Blind spot: This validation point doesn't exist in the plan's flow.
- **Decision**: FIXED via Fix A — added per-repo try/catch with warnings array to Phase 2 contract; corrected PAT scope assumption in plan-brief.md

### F3 — Contributor insert is fire-and-forget despite "at least 1" guarantee

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: End-State Alignment
- **Location**: Phase 3.6 — Update board creation API
- **Detail**: Phase 3.6 says: "Log warning on failure but don't block board creation" — copying the repo insert pattern from api/boards/index.ts:73-74. But unlike repos (which are nice-to-have metadata), the wizard explicitly enforces "at least 1 contributor" (Zod .min(1), disabled button). If the DB insert fails silently, the user sees a board with 0 contributors — contradicting the wizard's promise. The repo fire-and-forget pattern makes sense for repos (the board still works without them). For contributors, the plan's own end state says they're required.
- **Fix**: Make contributor insert a blocking error — if it fails, return 500 instead of 201. The board + PAT + repos are already persisted, so the EM can retry creation (or a future S-09 can add ICs later).
- **Decision**: FIXED — changed Phase 3.6 from fire-and-forget to blocking error on contributor insert failure
