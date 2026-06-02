---
date: "2026-06-02T15:20:24+02:00"
researcher: Claude Code
git_commit: 7ff366c1bc646569f06a0c354d9259ed0e041c10
branch: main
repository: gos-tomek/gitgud
topic: "GitHub user-to-app account linking: email retrieval feasibility and linking strategies"
tags: [research, codebase, github-api, identity-linking, oauth, supabase-auth]
status: complete
last_updated: 2026-06-02
last_updated_by: Claude Code
---

# Research: GitHub User Email Retrieval & Account Linking Strategies

**Date**: 2026-06-02T15:20:24+02:00
**Researcher**: Claude Code
**Git Commit**: 7ff366c1bc646569f06a0c354d9259ed0e041c10
**Branch**: main
**Repository**: gos-tomek/gitgud

## Research Question

How to link GitHub users with email accounts? Is it possible to get email from GitHub? What strategies exist for connecting GitHub identities to application user accounts?

## Summary

**Email retrieval from GitHub is unreliable for third-party users.** Only ~10-30% of GitHub users have public emails. The collaborators API returns no email field at all. The only reliable way to get a user's email is through OAuth with `user:email` scope — but that requires the user's own consent, so it only works during their sign-in, not when an EM picks collaborators.

**The recommended linking strategy is GitHub OAuth** (either as primary auth or via `linkIdentity` after email/password signup). GitHub's stable numeric user ID becomes the bridge between `board_contributors.github_id` (stored at board setup) and `auth.identities.provider_id` (stored at OAuth sign-in). This aligns with the frame.md conclusion and the existing `*_github_id` pattern in the codebase.

## Detailed Findings

### 1. GitHub API Email Endpoints — Complete Inventory

| Endpoint | Whose Email | Private Emails? | Required Auth/Scope | Reliability |
|----------|-------------|-----------------|---------------------|-------------|
| `GET /user/emails` | Authenticated user only | **Yes**, all emails | `user:email` scope | **HIGH** — canonical approach |
| `GET /user` | Authenticated user only | No, public only | Any auth | LOW — usually null |
| `GET /users/{username}` | Any user | No, public only | None | LOW — majority null |
| `GET /repos/{owner}/{repo}/collaborators` | Repo collaborators | No, public only | Repo admin | LOW — usually null |
| `GET /repos/{owner}/{repo}/commits` | Commit authors | Leaks historical emails | Repo read | MEDIUM — noreply trend |
| GraphQL `user.email` | Any user | No, public only | Any auth | LOW — same as REST |
| GraphQL `organizationVerifiedDomainEmails` | Org members | Yes, verified domain | Enterprise Cloud + org admin | HIGH — very restricted |

**Key findings:**

- **`GET /user/emails`** is the only reliable method and requires the target user's own OAuth token with `user:email` scope. You cannot use it to look up another user's email.
- **`GET /users/{username}`** returns `"email": null` when the user has email set to private (the default for new accounts since 2017).
- **`GET /repos/{owner}/{repo}/collaborators`** returns `login`, `id`, `avatar_url` — **no email field**. This confirms the frame.md finding.
- **Commit-based extraction** (`commit.author.email`) reflects whatever the user configured in `git config user.email`. Increasingly returns `{id}+{username}@users.noreply.github.com` as more users enable privacy settings.

### 2. GitHub User Privacy Settings

- **Default for new accounts (post-2017): email is private.** The `email` field on `/users/{username}` returns null.
- **Noreply format**: `{numeric_id}+{username}@users.noreply.github.com` (stable across renames) or `{username}@users.noreply.github.com` (pre-2017 accounts).
- **"Block command line pushes that expose my email"** — when enabled, GitHub rejects pushes where commit author email is not the noreply address.
- **Estimated public email rate**: 10-30% of active developers (trending downward).

### 3. Linking Strategies Comparison

#### Strategy A: GitHub OAuth as Primary Auth (RECOMMENDED for new users)

| Aspect | Assessment |
|--------|------------|
| **How it works** | User clicks "Sign in with GitHub" → Supabase creates user with GitHub identity |
| **Matching** | Trivial: `auth.identities.provider_id` = GitHub numeric ID matches `board_contributors.github_id` |
| **Reliability** | **HIGHEST** — zero ambiguity, automatic |
| **UX friction** | **LOWEST** — single click, natural for developer audience |
| **Complexity** | LOW-MEDIUM — configure provider, add button, handle callback |
| **Data available** | `sub`/`provider_id` (GitHub numeric ID), `preferred_username` (login), `avatar_url`, `name`, `email` (if public) |

Supabase stores GitHub identity in:
- `auth.identities` → `provider = 'github'`, `provider_id = <GitHub numeric ID as string>`
- `auth.users.raw_user_meta_data` → `{ sub, preferred_username, user_name, name, avatar_url }`

#### Strategy B: OAuth Identity Linking (for existing email/password users)

| Aspect | Assessment |
|--------|------------|
| **How it works** | Existing user calls `supabase.auth.linkIdentity({ provider: 'github' })` |
| **Matching** | Same as Strategy A after linking completes |
| **Reliability** | **HIGH** — once linked, deterministic |
| **UX friction** | **MEDIUM** — requires explicit "Link GitHub" action |
| **Complexity** | MEDIUM — needs "Enable Manual Linking" in Supabase, callback handling |
| **Prerequisite** | `GOTRUE_SECURITY_MANUAL_LINKING_ENABLED: true` in Supabase Auth settings |

#### Strategy C: Email-Based Matching (NOT RECOMMENDED)

| Aspect | Assessment |
|--------|------------|
| **How it works** | Match app signup email to GitHub user's known email |
| **Reliability** | **LOW** — fundamentally broken |
| **Failure modes** | Private emails (majority), multiple emails, mismatched domains, silent failures |
| **Verdict** | Not viable as primary. Could be a secondary hint ("We think you might be @octocat — confirm?") |

#### Strategy D: Manual Invitation Codes

| Aspect | Assessment |
|--------|------------|
| **How it works** | EM generates per-contributor invite links; IC clicks link and creates account |
| **Reliability** | **HIGH** — deterministic |
| **UX friction** | **HIGH** — EM distributes links out-of-band, doesn't scale |
| **Security** | Tokens in URLs can leak via referrer headers |

#### Strategy E: Webhook Automation (enhances A/B)

| Aspect | Assessment |
|--------|------------|
| **How it works** | Supabase Auth Hook triggers on signup; auto-matches GitHub ID to board_contributors |
| **Best use** | Glue on top of Strategy A/B — not standalone |
| **Implementation** | Database trigger or Edge Function on `auth.identities` INSERT |

### 4. Real-World Patterns in Developer Tools

- **Linear**: GitHub App for repo access + per-user OAuth for identity linking (Settings > Connected Accounts > Connect GitHub). PRs linked to issues via branch naming, not user matching.
- **Sentry**: Detects "missing members" by comparing commit author emails to Sentry org members. Monthly email to org owners suggesting invites. Suffers from email mismatch problems.
- **Common hybrid pattern**: Org-level GitHub App for data ingestion + per-user GitHub OAuth for identity linking + auto-matching via database trigger + graceful degradation (unlinked users show as GitHub avatars).

### 5. Current GitGud Codebase State

#### What exists for GitHub identity:

| Table | GitHub Columns | Pattern |
|-------|---------------|---------|
| `github_pull_requests` | `author_login` (text), `author_github_id` (bigint) | Login + numeric ID |
| `github_reviews` | `reviewer_login` (text), `reviewer_github_id` (bigint) | Login + numeric ID |
| `github_review_comments` | `commenter_login` (text), `commenter_github_id` (bigint) | Login + numeric ID |
| `github_repos` | `connected_by` (uuid → auth.users) | App user UUID only |
| `boards` | `owner_user_id` (uuid → auth.users) | App user UUID only |
| `board_members` | `user_id` (uuid → auth.users) | App user UUID only |

#### Critical gaps:

1. **No GitHub OAuth provider configured** — `supabase/config.toml` has no `[auth.external.github]` enabled
2. **No app-user ↔ GitHub-user bridge** — no table or column links `auth.users.id` to GitHub user ID
3. **PAT owner identity is transient** — `validate-pat.ts` calls `getAuthenticated()` but never persists the result
4. **No email, avatar, or profile data stored** for GitHub users beyond login + ID
5. **All RLS policies use `auth.uid()`** — no GitHub-identity-based access control

#### What the existing pattern supports:

The `*_login` + `*_github_id` pattern in ingestion tables is already GitHub-identity-native. A new `board_contributors` table following this same pattern (as proposed in frame.md) would be consistent. The bridge between app users and GitHub users would come later via OAuth (`auth.identities.provider_id` = `board_contributors.github_id`).

## Code References

- `supabase/migrations/20260529120000_access_control_and_membership.sql:5-18` — `boards` + `board_members` tables with `auth.users` FK
- `supabase/migrations/20260531100000_github_ingestion_access.sql:24-37` — `github_pull_requests` with `author_login` + `author_github_id`
- `supabase/migrations/20260531100000_github_ingestion_access.sql:43-51` — `github_reviews` with `reviewer_login` + `reviewer_github_id`
- `supabase/migrations/20260531100000_github_ingestion_access.sql:57-70` — `github_review_comments` with `commenter_login` + `commenter_github_id`
- `supabase/config.toml:305-389` — OAuth providers all disabled; no GitHub section
- `src/lib/github.ts:34-88` — Octokit client creation from board PAT
- `src/lib/services/github-sync.ts:29-88` — PR/review/comment sync extracting login + ID only
- `src/pages/api/github/validate-pat.ts:50-58` — `getAuthenticated()` returns login, id, avatar_url (not persisted)
- `src/pages/api/auth/signin.ts:13` — email/password only via `signInWithPassword`
- `src/components/CreateBoardForm.tsx:68-112` — PAT validation displays GitHub user info in UI
- `src/types.ts:22-60` — TypeScript types with `authorLogin` + `authorGithubId` pattern

## Architecture Insights

1. **GitGud's identity model is cleanly split**: app users (UUID/email-based) and GitHub users (login/numeric-ID-based) run on parallel tracks. This was the right design for the current scope but creates a gap when features require linking the two.

2. **The `*_github_id` (bigint) pattern is the correct anchor** for future linking. GitHub's numeric user ID is:
   - Immutable (survives username changes)
   - Always available from any GitHub API response involving users
   - What Supabase stores as `provider_id` after GitHub OAuth

3. **The matching SQL** after GitHub OAuth is enabled would be:
   ```sql
   UPDATE board_contributors
   SET user_id = NEW.user_id
   FROM auth.identities
   WHERE auth.identities.user_id = NEW.user_id
     AND auth.identities.provider = 'github'
     AND board_contributors.github_id = auth.identities.provider_id::bigint
     AND board_contributors.user_id IS NULL;
   ```

4. **Supabase stores GitHub identity** (from GoTRUE source) as:
   - `auth.identities.provider_id` = GitHub numeric ID as string
   - `auth.identities.identity_data` = `{ sub, preferred_username, user_name, name, avatar_url }`
   - `auth.users.raw_user_meta_data` merges the same fields

## Historical Context (from prior changes)

- `context/changes/invite-and-join-board/frame.md` — Identified that GitHub collaborators API doesn't return email (Hypothesis 2: "STRONG"). Concluded email matching is unreliable. Proposed GitHub OAuth linking for S-05 scope, not S-03.
- `context/changes/invite-and-join-board/change.md` — Deferred 2026-05-30: "EM should select ICs from GitHub contributor list rather than typing email addresses manually."

## Recommended Approach for GitGud

### S-03 (invite-and-join-board) — No changes to auth

Store GitHub collaborators as `board_contributors` keyed on `(board_id, github_id)` with `github_login` and `avatar_url`. No FK to `auth.users`. ICs are GitHub identities only.

### S-05 (when ICs need to log in) — Add GitHub OAuth

1. **Configure GitHub OAuth provider** in `supabase/config.toml`:
   ```toml
   [auth.external.github]
   enabled = true
   client_id = "env(GITHUB_OAUTH_CLIENT_ID)"
   secret = "env(GITHUB_OAUTH_CLIENT_SECRET)"
   ```

2. **Offer dual auth paths**: "Sign in with GitHub" (Strategy A) + "Link GitHub account" for existing users (Strategy B).

3. **Auto-match on OAuth signup/link** via database trigger on `auth.identities` INSERT:
   - Match `provider_id::bigint` against `board_contributors.github_id`
   - Populate `board_contributors.user_id` with the Supabase user UUID

4. **Graceful degradation**: Unlinked contributors display as GitHub avatars/logins (already the S-03 pattern). Features requiring app identity prompt "Connect your GitHub account."

## Open Questions

1. **GitHub App vs OAuth App?** GitHub Apps offer finer-grained permissions and higher rate limits. Worth evaluating for S-05 whether a GitHub App (installed on the org) would be better than individual OAuth tokens.

2. **Should the PAT owner's GitHub identity be persisted at board creation?** Currently discarded after validation. Storing it would let you pre-link the EM's GitHub account to their app user without requiring separate OAuth.

3. **What happens when a GitHub user changes their username?** The numeric `github_id` is stable, but `github_login` stored in `board_contributors` becomes stale. Need a refresh strategy (periodic sync or on-access check).

4. **Multiple GitHub accounts?** A developer might have personal and work GitHub accounts. If they OAuth-link the wrong one, the match fails silently. Consider showing a confirmation: "Link as @octocat to board X?"

## Sources

- [GitHub REST API — Users](https://docs.github.com/en/rest/users/users)
- [GitHub REST API — Emails](https://docs.github.com/en/rest/users/emails)
- [GitHub REST API — Collaborators](https://docs.github.com/en/rest/collaborators/collaborators)
- [GitHub OAuth Scopes](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps)
- [GitHub Email Privacy Reference](https://docs.github.com/en/account-and-profile/reference/email-addresses-reference)
- [GitHub Rate Limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)
- [Supabase Identity Linking](https://supabase.com/docs/guides/auth/auth-identity-linking)
- [Supabase linkIdentity API](https://supabase.com/docs/reference/javascript/auth-linkidentity)
- [Supabase Login with GitHub](https://supabase.com/docs/guides/auth/social-login/auth-github)
- [Supabase GoTRUE GitHub Provider Source](https://github.com/supabase/auth/blob/4bb48144368a5636abd05c6f0078382968eb10c0/api/provider/github.go)
