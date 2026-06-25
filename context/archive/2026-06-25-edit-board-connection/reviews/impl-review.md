<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Edit Board Connection

- **Plan**: context/changes/edit-board-connection/plan.md
- **Scope**: All Phases (1–6 of 6)
- **Date**: 2026-06-25
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 2 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | WARNING |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

## Findings

### F1 — Missing GITHUB_TOKEN_ENCRYPTION_KEY null guard in 4 endpoints

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/profile/pat.ts:56, src/pages/api/github/repos.ts:49, src/pages/api/github/validate-repo.ts:53, src/pages/api/github/collaborators.ts:61
- **Detail**: GITHUB_TOKEN_ENCRYPTION_KEY is declared `optional: true` in astro.config.mjs. These 4 endpoints pass it directly to RPC calls (set_user_github_pat / get_user_github_pat_by_user_id) without checking for undefined first. In pat.ts, `pgp_sym_encrypt(token, NULL)` silently produces NULL, destroying the token. In the other 3, `pgp_sym_decrypt` with a null key throws a cryptic Postgres error. The existing `createGitHubClient()` in src/lib/github.ts:97-99 already guards correctly: `if (!key) throw new GitHubTokenMissingError()`.
- **Fix**: Add an early guard in each endpoint before the RPC call: `if (!GITHUB_TOKEN_ENCRYPTION_KEY) return json({ error: "Encryption is not configured" }, 503);` Matches the guard pattern in createGitHubClient.
  - Strength: Consistent with the existing guard in github.ts; prevents silent data corruption (pat.ts) and cryptic errors (others).
  - Tradeoff: Minor — four one-line additions.
  - Confidence: HIGH — identical pattern used in createGitHubClient.
  - Blind spot: None significant.
- **Decision**: FIXED — guard added to all 4 endpoints; hermetic test added per endpoint

### F2 — connected_by column dropped instead of loosened

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: supabase/migrations/20260625120000_user_pat_and_expiry.sql:132
- **Detail**: Plan specified loosening `github_repos.connected_by` FK to ON DELETE SET NULL + DROP NOT NULL. Implementation drops the column entirely. The intent (unblock user deletion) is satisfied and the migration comment explains no read/write path uses the column — but this is a more aggressive change than planned.
- **Fix**: Document the deviation as an addendum in the plan. The column is already dropped; re-adding it would be pointless churn. Recording the decision is sufficient.
  - Strength: Preserves the work; keeps the plan as an accurate historical record.
  - Tradeoff: None — documentation-only.
  - Confidence: HIGH — the column is confirmed unused.
  - Blind spot: None significant.
- **Decision**: FIXED — addendum A1 added to plan.md

### F3 — Unplanned 4.4a scope additions

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/components/ChangePasswordForm.tsx, src/pages/api/profile/password.ts, supabase/migrations/20260625140000_user_pat_login.sql, src/lib/services/boards.ts
- **Detail**: Four files not in the original plan. All are documented in Progress step 4.4a as "UX follow-ups from manual review." The github_pat_login migration fixes a real bug (PAT owner vs OAuth identity mismatch). The boards service centralizes inline queries (positive refactoring). Password change fills a natural gap in a profile settings page. All are reasonable and documented.
- **Decision**: SKIPPED

### F4 — Collaborators endpoint repos array unbounded

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/github/collaborators.ts:17
- **Detail**: The repos array in the zod schema has `min(1)` but no max. A direct API call (bypassing the wizard) could pass hundreds of repos, each triggering paginated GitHub API calls. Mitigated by GitHub's own rate limit, but adding `.max(200)` to the schema would match the REPO_LIMIT used in repos.ts.
- **Decision**: SKIPPED
