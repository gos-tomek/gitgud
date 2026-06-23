<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Link GitHub Account

- **Plan**: context/changes/link-github-account/plan.md
- **Mode**: Deep
- **Date**: 2026-06-22
- **Verdict**: REVISE → SOUND (after fixes)
- **Findings**: 1 critical, 2 warnings, 1 observation

## Verdicts

| Dimension             | Verdict                   |
| --------------------- | ------------------------- |
| End-State Alignment   | PASS                      |
| Lean Execution        | PASS                      |
| Architectural Fitness | PASS                      |
| Blind Spots           | PASS (after F1 fix)       |
| Plan Completeness     | PASS (after F3, F4 fixes) |

## Grounding

Grounding: 14/14 paths ✓, 5/5 symbols ✓, brief↔plan ✓

## Findings

### F1 — Signup-to-profile insert is non-atomic with no recovery

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Blind Spots
- **Location**: Phase 2, step 3 (signup API)
- **Detail**: The plan sequenced signUp + admin INSERT as two independent operations. If INSERT failed (duplicate github_id, DB error), the auth user existed but had no profile with no recovery path. Also, no pre-check for duplicate github_id.
- **Fix A ⭐ Recommended**: Validate uniqueness first + cleanup on failure (pre-check github_id + deleteUser rollback)
- **Fix B**: Database trigger on auth.users to populate user_profiles from metadata (atomic)
- **Decision**: FIXED via Fix B (trigger approach). Additionally, `github_id` UNIQUE constraint removed — multiple users may declare the same GitHub identity per user's direction.

### F2 — SUPABASE_SERVICE_ROLE_KEY declared non-optional will break CI build

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2, step 5 (env schema update)
- **Detail**: All existing env fields use `optional: true`. Plan declared new field without it. CI validate job's build step would fail.
- **Fix**: Declare with `optional: true` or add to CI env block.
- **Decision**: DISMISSED — resolved by F1 (trigger approach removed the need for admin client and service role key entirely)

### F3 — Phase 2 signup API contract says "admin client or RPC" — unresolved choice

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2, step 3 (signup API contract)
- **Detail**: Ambiguous "admin client or RPC" left implementer guessing.
- **Fix**: Remove "or RPC" — commit to admin client approach.
- **Decision**: DISMISSED — resolved by F1 (trigger approach replaced both options)

### F4 — No handling for user_profiles INSERT failure surfacing as user error

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2, step 3 (signup API contract)
- **Detail**: With trigger approach, trigger failure rolls back signUp transaction. Plan needed to specify that the API handles this (generic error redirect).
- **Fix**: Add error handling note for trigger failures in signup API contract.
- **Decision**: FIXED — added generic error redirect note to Phase 2 step 3 contract
