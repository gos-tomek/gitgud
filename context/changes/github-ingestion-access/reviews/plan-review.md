<!-- PLAN-REVIEW-REPORT -->
# Plan Review: GitHub Ingestion Access Implementation Plan

- **Plan**: `context/changes/github-ingestion-access/plan.md`
- **Mode**: Deep
- **Date**: 2026-05-31
- **Verdict**: SOUND (after triage fixes)
- **Findings**: 0 critical | 3 warnings | 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | WARNING |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding

6/6 paths ✓, 4/4 symbols ✓, brief↔plan ✓

Paths verified: `supabase/migrations/`, `src/lib/services/boards.ts`, `src/types.ts`, `supabase/seed.sql`, `wrangler.jsonc`, `astro.config.mjs`

Symbols verified: `is_board_member` (migration:37), `is_board_owner` (migration:50), `nodejs_compat` (wrangler.jsonc:6), `env.schema` block (astro.config.mjs:21)

## Findings

### F1 — RLS policy join path for deep tables not specified

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: Phase 1 — Migration file, RLS section
- **Detail**: The plan said 'via is_board_member' for all tables, but `github_review_comments` is 3 joins deep. Existing pattern uses one-liner SECURITY DEFINER helpers, not inline subqueries. No template existed for multi-table depth.
- **Fix A ⭐ Applied**: Added `get_board_id_for_pr(p_pr_id bigint) RETURNS uuid` SECURITY DEFINER helper spec to the migration section, plus explicit one-liner policy shapes for all four new tables.
- **Decision**: FIXED via Fix A

### F2 — Rate-limit delay unworkable for full exhaustion on workerd

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 2 — GitHub client factory, rate-limit handling
- **Detail**: 'If ratelimit-remaining is 0, delay' cannot work on workerd (30s CPU limit); GitHub hourly reset can be 30–60 min away. Plan also defined GitHubRateLimitError with resetAt: Date without specifying when to throw vs delay — a contradiction in the contract.
- **Recommended fix**: Replace delay with throw GitHubRateLimitError when remaining == 0. Callers surface the resetAt timestamp.
- **Decision**: ACCEPTED — acceptable for MVP; F-03 Workflows handles production scale.

### F3 — Phase 3 Progress section missing one automated criteria entry

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 Success Criteria + Progress section
- **Detail**: Phase 3 had 3 automated bullets (build, lint, no TS errors) but Progress only had 3.1 and 3.2. Third bullet lacked a matching entry; /10x-implement parser requires 1:1 mapping.
- **Fix Applied**: Merged 'No TypeScript errors' into the 3.1 build bullet wording; removed the orphaned bullet.
- **Decision**: FIXED

### F4 — Board type exclusion of encrypted column not stated

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 — Types section
- **Detail**: Plan said 'interfaces mirror DB tables'; an implementer could incorrectly add `githubPatEncrypted` to `Board`/`UserBoard`. The column is never read back (decryption is SECURITY DEFINER only; boards.ts uses explicit column selects).
- **Fix Applied**: Added explicit exclusion note to the types section contract.
- **Decision**: FIXED
