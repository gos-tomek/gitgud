# GitHub Ingestion Access — Plan Brief

> Full plan: `context/changes/github-ingestion-access/plan.md`

## What & Why

GitGud needs to read PRs, reviews, and review comments from GitHub to build contribution profiles. F-02 creates the foundation: token storage, a GitHub API client, and a fetch service that pulls data into Supabase. Without this, no downstream slice (S-02 board linking, S-04 profiles, F-03 classification) can function.

## Starting Point

The codebase has auth (Supabase email+password), boards, and memberships — but zero GitHub integration. No Octokit, no GitHub-related env vars, no data tables. The board detail page has placeholder stubs for "Linked GitHub org" and "Contribution profiles."

## Desired End State

A board can have an encrypted GitHub PAT and linked repos. A sync service fetches all PRs, reviews, and review comments for those repos via Octokit and stores them in Supabase. The pipeline works on the Cloudflare workerd runtime. S-02 can immediately wire a UI to this foundation.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| GitHub auth mechanism | Fine-grained PAT | Zero infrastructure — no GitHub App registration needed; EM controls scope directly. | Plan |
| Client library | Octokit (@octokit/rest) | Full GitHub API coverage with typed methods and built-in pagination. | Plan |
| Data persistence | Persist into Supabase tables | F-03 and S-04 need local data; avoids rate-limit pressure on page loads. | Plan |
| Token encryption | pgcrypto with app-layer env var key | Encrypted at rest; simpler than Vault for MVP; SECURITY DEFINER functions handle decrypt. | Plan |
| Link granularity | Repo-level (not org-level) | User provides exact repos; one board can span multiple orgs. Departs from PRD FR-002 per user decision. | Plan |
| Token location | Column on boards table | Token is per-board (from the EM); avoids separate user-level token table. | Plan |
| Error handling | Retry with exponential backoff + rate-limit awareness | Robust against transient GitHub failures and rate limits. | Plan |
| Testing approach | Manual verification + typed builds | No mock server; verify types via build, verify pipeline manually with a real PAT. | Plan |

## Scope

**In scope:**
- Encrypted PAT column on `boards` with encrypt/decrypt SECURITY DEFINER functions
- `github_repos` connection table (1:many from board)
- `github_pull_requests`, `github_reviews`, `github_review_comments` data tables with RLS
- Octokit factory (`src/lib/github.ts`) with per-request instantiation, retry, rate-limit handling
- Sync service (`src/lib/services/github-sync.ts`) with paginated fetch and upsert
- Temporary test API route (`POST /api/github/sync`) for manual verification
- New env var: `GITHUB_TOKEN_ENCRYPTION_KEY`

**Out of scope:**
- UI for entering PAT or selecting repos (S-02)
- Contribution profile view (S-04)
- Comment classification (F-03)
- Scheduled/automated sync (F-03 batch)
- Repo search or autocomplete
- Supabase Vault (deferred improvement)

## Architecture / Approach

```
EM provides PAT → encrypted in boards.github_pat_encrypted (pgcrypto)
                                    ↓
             createGitHubClient() decrypts → Octokit instance
                                    ↓
          syncBoardGitHubData() paginates GitHub REST API
                                    ↓
          Upserts into github_pull_requests / github_reviews / github_review_comments
```

Data flows one direction: GitHub → Supabase. All tables have RLS scoped to board membership. Token decryption happens only in SECURITY DEFINER functions — the encryption key never reaches the client.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Schema & Token Infrastructure | Migration with all tables, RLS, encrypt/decrypt functions, env var | pgcrypto function signature or RLS policy errors — caught by `supabase db reset` |
| 2. GitHub API Client | Octokit factory with retry/rate-limit logic, error types | Octokit compatibility with workerd — must verify manually |
| 3. Fetch Service & Integration Verification | Sync service, upsert helpers, test API route, workerd verification | Large repos may exceed workerd request timeout — acceptable for F-02; F-03 handles with durable execution |

**Prerequisites:** Local Supabase running (`npx supabase start`), a real fine-grained GitHub PAT for testing, `.dev.vars` with `GITHUB_TOKEN_ENCRYPTION_KEY` set.
**Estimated effort:** ~2 sessions across 3 phases.

## Open Risks & Assumptions

- Octokit on workerd is reported to work with `nodejs_compat` but hasn't been verified in this project — Phase 2 manual test is the gate.
- Large repos (>500 PRs) may hit the 30s CPU limit on Cloudflare Workers free tier — acceptable for MVP; F-03's Workflows architecture solves this for production.
- Fine-grained PAT scoped to specific repos requires the EM to configure scopes correctly on GitHub's side — UX guidance deferred to S-02.

## Success Criteria (Summary)

- A full sync of a real GitHub repo populates `github_pull_requests`, `github_reviews`, and `github_review_comments` tables with correct data
- The sync works on the workerd runtime (not just Node.js dev mode)
- RLS prevents board non-members from accessing GitHub data
