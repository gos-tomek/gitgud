# GitHub Ingestion Access Implementation Plan

## Overview

Build the foundation that lets GitGud authenticate to GitHub and read a board's linked repositories' PRs, reviews, and review comments. This is F-02 on the roadmap — it unlocks S-02 (link board to org), S-04 (raw metrics profile), and F-03 (classification batch).

The EM provides a fine-grained GitHub Personal Access Token when linking repos to a board. The token is encrypted at rest using pgcrypto. An Octokit-based client fetches data from the GitHub REST API and persists it into Supabase tables. No UI is built in this foundation — S-02 owns the linking UX.

## Current State Analysis

- **Auth**: Supabase email+password with cookie-based SSR sessions. No OAuth, no GitHub identity.
- **Schema**: `boards` + `board_members` tables with RLS and SECURITY DEFINER helpers (`is_board_member`, `is_board_owner`). No GitHub-related tables or columns.
- **Services**: `src/lib/services/boards.ts` follows async/await pattern — `SupabaseClient` first param, throw on error, snake→camelCase via helper. This pattern is the template for new services.
- **Dependencies**: No Octokit or GitHub-related packages installed.
- **Env vars**: Only `SUPABASE_URL` and `SUPABASE_KEY`. No GitHub token encryption key.
- **Runtime**: Cloudflare workerd with `nodejs_compat` flag enabled (`wrangler.jsonc:6`).

### Key Discoveries:

- `pgcrypto` is pre-installed in Supabase (in `extensions` schema). `pgp_sym_encrypt`/`pgp_sym_decrypt` work without `CREATE EXTENSION`.
- Octokit v22 uses native `fetch` internally — compatible with workerd if instantiated inside request handlers (not module top-level).
- SECURITY DEFINER pattern is established (`supabase/migrations/20260529120000_access_control_and_membership.sql:34-51`) — reuse it for token decryption.
- Board detail page (`src/pages/boards/[id].astro:42-45`) has placeholder stubs for "Linked GitHub org" and "Contribution profiles" — S-02 will replace these.

## Desired End State

After this plan:

1. The `boards` table has an encrypted PAT column; a SECURITY DEFINER function decrypts it for server-side use.
2. A `github_repos` table links specific repositories to a board (1:many).
3. GitHub data tables (`github_pull_requests`, `github_reviews`, `github_review_comments`) store fetched data with RLS.
4. An Octokit factory (`src/lib/github.ts`) creates authenticated, per-request clients with rate-limit awareness and retry logic.
5. A sync service (`src/lib/services/github-sync.ts`) fetches PRs → reviews → comments for all repos linked to a board and upserts them into Supabase.
6. The pipeline has been manually verified on the workerd runtime with a real GitHub PAT.

**Verification**: Run `npm run build` successfully; manually call the sync service from a test API route with a real PAT and confirm data appears in the GitHub data tables.

## What We're NOT Doing

- **No UI** — no form for entering the PAT, no repo picker, no profile view. S-02 owns the linking UX.
- **No org-level linking** — the user decided on repo-level linking (repos specified by exact owner/name). Org-wide fetching and repo search/autocomplete are deferred.
- **No classification** — F-03 owns comment classification. F-02 stores raw comment bodies; F-03 will classify and manage retention.
- **No scheduled sync** — F-03 owns the daily batch. F-02 provides the on-demand fetch capability.
- **No Supabase Vault** — encryption key is an application-layer env var for MVP simplicity. Vault migration is a future improvement.

## Implementation Approach

Three phases, each independently testable:

1. **Schema**: Migration adds encrypted PAT column to `boards`, creates `github_repos` and three GitHub data tables, adds SECURITY DEFINER functions for encryption. Expand-only (ADD COLUMN, new tables) — backward-compatible.
2. **Client**: Install Octokit, build a factory that decrypts the PAT and creates a per-request client with retry/rate-limit logic.
3. **Fetch service**: Paginated fetch of PRs → reviews → comments, upserted into Supabase. Manual verification on workerd.

---

## Phase 1: Schema & Token Infrastructure

### Overview

Create the database foundation: encrypted token column on `boards`, repo connections table, and GitHub data tables. All tables get RLS. A SECURITY DEFINER function handles token decryption without exposing the encryption key to client queries.

### Changes Required:

#### 1. Migration file

**File**: `supabase/migrations/YYYYMMDDHHmmss_github_ingestion_access.sql`

**Intent**: Add all GitHub-related schema in a single migration — encrypted PAT column on `boards`, `github_repos` connection table, and `github_pull_requests` / `github_reviews` / `github_review_comments` data tables. Enable RLS on all new tables with per-operation policies.

**Contract**:

The migration adds:

- `boards.github_pat_encrypted bytea` — nullable column for the encrypted PAT. Nullable because not all boards have a GitHub connection.

- `github_repos` table:
  - `id uuid PK DEFAULT gen_random_uuid()`
  - `board_id uuid NOT NULL FK boards(id) ON DELETE CASCADE`
  - `repo_owner text NOT NULL` — GitHub org or user that owns the repo
  - `repo_name text NOT NULL` — repository name
  - `connected_at timestamptz NOT NULL DEFAULT now()`
  - `connected_by uuid NOT NULL FK auth.users(id)` — the user who added this repo
  - `UNIQUE(board_id, repo_owner, repo_name)` — no duplicate repo links per board

- `github_pull_requests` table:
  - `id bigint PK` — GitHub's PR ID (globally unique)
  - `repo_id uuid NOT NULL FK github_repos(id) ON DELETE CASCADE`
  - `number int NOT NULL` — PR number within the repo
  - `title text NOT NULL`
  - `state text NOT NULL` — `open`, `closed`, `merged` (derived: `merged_at IS NOT NULL`)
  - `author_login text NOT NULL`
  - `author_github_id bigint NOT NULL`
  - `is_draft boolean NOT NULL DEFAULT false`
  - `created_at timestamptz NOT NULL`
  - `updated_at timestamptz NOT NULL`
  - `merged_at timestamptz`
  - `fetched_at timestamptz NOT NULL DEFAULT now()` — when this row was last synced

- `github_reviews` table:
  - `id bigint PK` — GitHub's review ID
  - `pull_request_id bigint NOT NULL FK github_pull_requests(id) ON DELETE CASCADE`
  - `reviewer_login text NOT NULL`
  - `reviewer_github_id bigint NOT NULL`
  - `state text NOT NULL` — `APPROVED`, `CHANGES_REQUESTED`, `COMMENTED`, `PENDING`, `DISMISSED`
  - `submitted_at timestamptz NOT NULL`
  - `fetched_at timestamptz NOT NULL DEFAULT now()`

- `github_review_comments` table:
  - `id bigint PK` — GitHub's comment ID
  - `pull_request_id bigint NOT NULL FK github_pull_requests(id) ON DELETE CASCADE`
  - `review_id bigint FK github_reviews(id) ON DELETE SET NULL` — nullable (orphaned comments exist)
  - `commenter_login text NOT NULL`
  - `commenter_github_id bigint NOT NULL`
  - `body text NOT NULL` — raw comment text; F-03 manages retention post-classification
  - `path text` — file path in the diff (nullable for PR-level comments)
  - `position_line int` — line number in the diff
  - `position_side text` — `LEFT` or `RIGHT`
  - `created_at timestamptz NOT NULL`
  - `updated_at timestamptz NOT NULL`
  - `fetched_at timestamptz NOT NULL DEFAULT now()`

RLS for all new tables: REVOKE anon; authenticated can SELECT rows where the repo's board is visible to them (via `is_board_member`). INSERT/UPDATE/DELETE restricted to board owner (via `is_board_owner`). `github_repos` follows the same pattern.

**RLS helper**: Add a SECURITY DEFINER function `get_board_id_for_pr(p_pr_id bigint) RETURNS uuid` (same migration, follows `is_board_member`/`is_board_owner` pattern). Returns the board ID for a given PR, bypassing RLS on intermediate tables. REVOKE from public/anon; GRANT EXECUTE to authenticated.

**Policy shapes** (keep policies one-liner — no inline subqueries):

- `github_repos` SELECT: `USING (public.is_board_member(board_id))`
- `github_pull_requests` SELECT: `USING (EXISTS (SELECT 1 FROM github_repos gr WHERE gr.id = repo_id AND public.is_board_member(gr.board_id)))`
- `github_reviews` SELECT: `USING (public.is_board_member(public.get_board_id_for_pr(pull_request_id)))`
- `github_review_comments` SELECT: `USING (public.is_board_member(public.get_board_id_for_pr(pull_request_id)))`
- INSERT/UPDATE/DELETE for all tables: `WITH CHECK (public.is_board_owner(<board_id resolved via same chain>))`

Indexes: `github_pull_requests(repo_id)`, `github_reviews(pull_request_id)`, `github_review_comments(pull_request_id)`, `github_review_comments(review_id)`, `github_repos(board_id)`.

#### 2. Token encrypt/decrypt functions

**File**: same migration file

**Intent**: SECURITY DEFINER functions that encrypt/decrypt the GitHub PAT using pgcrypto, keeping the encryption key as a function parameter (passed from the application layer). Follows the established `is_board_member`/`is_board_owner` pattern.

**Contract**:

- `set_board_github_pat(p_board_id uuid, p_raw_token text, p_encryption_key text) RETURNS void` — encrypts and stores. Checks `is_board_owner(p_board_id)` before writing; raises exception if not owner. SECURITY DEFINER, `SET search_path = public, extensions`.
- `get_board_github_pat(p_board_id uuid, p_encryption_key text) RETURNS text` — decrypts and returns plaintext. Checks `is_board_owner(p_board_id)`. SECURITY DEFINER. Returns NULL if no token is stored.
- Both functions: REVOKE from public/anon, GRANT EXECUTE to authenticated.

#### 3. Env var: GITHUB_TOKEN_ENCRYPTION_KEY

**File**: `astro.config.mjs` (env schema) + `.dev.vars` (local value)

**Intent**: Register the encryption key as a server-side secret so it's available via `astro:env/server`. Add to `.dev.vars` for local development.

**Contract**: New `envField.string({ context: "server", access: "secret", optional: true })` entry in the `env.schema` block of `astro.config.mjs`. Generate a random 32+ character key for `.dev.vars`.

#### 4. Types

**File**: `src/types.ts`

**Intent**: Add TypeScript interfaces for the new entities — `GitHubRepo`, `GitHubPullRequest`, `GitHubReview`, `GitHubReviewComment`.

**Contract**: Interfaces mirror the DB tables with camelCase field names and string timestamps. Export alongside existing `Board`/`UserBoard` types. Do NOT add `githubPatEncrypted` to `Board`/`UserBoard` — the encrypted column is never read back by application code (decryption is SECURITY DEFINER only; `boards.ts` uses explicit column selects that exclude it).

#### 5. Seed data update

**File**: `supabase/seed.sql`

**Intent**: Add a test GitHub repo connection to Board Alpha so the existing seed supports GitHub-related development. No real PAT — encrypted_token set to NULL in seed (PAT provided manually during dev).

**Contract**: Insert a `github_repos` row linking Board Alpha to a well-known public repo (e.g., `octocat/Hello-World`).

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npx supabase db reset`
- Build passes: `npm run build`
- Lint passes: `npm run lint`
- Types compile: `npx astro check` (if applicable) or `npm run build` covers this

#### Manual Verification:

- Connect to local Supabase DB and confirm all tables exist with correct columns
- Confirm RLS policies prevent cross-board data access: query `github_repos` as a user who is not a board member → zero rows
- Confirm `set_board_github_pat` / `get_board_github_pat` round-trip correctly with a test key and token

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: GitHub API Client

### Overview

Install Octokit, create a factory that produces authenticated, per-request GitHub clients with retry and rate-limit awareness. The factory reads the encrypted PAT from Supabase via the SECURITY DEFINER decrypt function.

### Changes Required:

#### 1. Install Octokit

**File**: `package.json`

**Intent**: Add `@octokit/rest` as a production dependency. It includes `@octokit/core`, pagination plugin, and typed REST endpoint methods.

**Contract**: `npm install @octokit/rest`

#### 2. GitHub client factory

**File**: `src/lib/github.ts`

**Intent**: Export a factory function that takes a Supabase client and board ID, decrypts the stored PAT via RPC (`get_board_github_pat`), and returns an authenticated Octokit instance. The instance must be created per-request (not module-level) to comply with workerd constraints.

**Contract**:

- `createGitHubClient(supabase: SupabaseClient, boardId: string): Promise<Octokit | null>` — returns null if no PAT is stored or decryption fails. Reads `GITHUB_TOKEN_ENCRYPTION_KEY` from `astro:env/server`.
- The returned Octokit instance is configured with:
  - `auth` set to the decrypted PAT
  - `userAgent` set to `gitgud/<version>`
  - `request.fetch` set to the global `fetch` (explicit, for workerd clarity)
- Rate-limit handling: after each response, check `x-ratelimit-remaining`. If ≤ 10, log a warning. If 0, compute wait time from `x-ratelimit-reset` and delay.
- Retry logic: transient errors (5xx, network errors) retried up to 3 times with exponential backoff (1s, 2s, 4s).

#### 3. GitHub client error types

**File**: `src/lib/github.ts` (same file)

**Intent**: Define typed error classes for GitHub API failures that downstream consumers can catch.

**Contract**:

- `GitHubTokenMissingError` — no PAT configured for this board
- `GitHubRateLimitError` — rate limit exhausted, includes `resetAt: Date`
- `GitHubAuthError` — 401/403 from GitHub (bad or expired token)

### Success Criteria:

#### Automated Verification:

- Build passes: `npm run build`
- Lint passes: `npm run lint`
- Octokit types resolve correctly (no `any` leaks)

#### Manual Verification:

- In local dev, manually call `createGitHubClient` with a real PAT (set via `set_board_github_pat` in SQL) and confirm the returned Octokit can list repos for the authenticated user: `octokit.rest.repos.listForAuthenticatedUser({ per_page: 1 })`
- Confirm the factory returns `null` when no PAT is stored

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Fetch Service & Integration Verification

### Overview

Build the sync service that fetches PRs, reviews, and review comments for all repos linked to a board, and upserts them into the GitHub data tables. Verify the full pipeline works on the workerd runtime.

### Changes Required:

#### 1. GitHub sync service

**File**: `src/lib/services/github-sync.ts`

**Intent**: Export a function that, given a board ID, fetches all GitHub data for the board's linked repos and persists it to Supabase. This is the entry point that F-03 (batch) and S-02 (on-link fetch) will call.

**Contract**:

- `syncBoardGitHubData(supabase: SupabaseClient, boardId: string): Promise<SyncResult>` where `SyncResult` reports counts: `{ repos: number, pullRequests: number, reviews: number, comments: number }`.
- Flow:
  1. Query `github_repos` for the board to get all connected repos.
  2. Create a GitHub client via `createGitHubClient`.
  3. For each repo, paginate through all PRs (`state: "all"`, `per_page: 100`).
  4. For each PR, fetch reviews and review comments.
  5. Upsert all data into the respective tables (use `ON CONFLICT (id) DO UPDATE` to handle re-syncs).
- The service function takes an optional `since?: Date` parameter — if provided, only fetch PRs updated after that date (uses `sort: "updated"`, `direction: "desc"` on the GitHub API, stops pagination when it hits a PR older than `since`).

#### 2. Upsert helpers

**File**: `src/lib/services/github-sync.ts` (same file)

**Intent**: Internal functions that transform Octokit response objects into DB row format and upsert via Supabase client.

**Contract**:

- `upsertPullRequests(supabase, repoId, prs[])` — maps GitHub PR response to `github_pull_requests` row format, upserts. Derives `state` as `merged` when `merged_at` is not null (GitHub API returns `closed` for merged PRs).
- `upsertReviews(supabase, prId, reviews[])` — maps to `github_reviews` rows, upserts.
- `upsertComments(supabase, prId, comments[])` — maps to `github_review_comments` rows, upserts. Links `review_id` from `pull_request_review_id` in the GitHub response.

#### 3. Test API route

**File**: `src/pages/api/github/sync.ts`

**Intent**: Temporary API endpoint for manual verification. Triggers a full sync for a board. Will be removed or replaced when S-02 builds the real linking flow.

**Contract**:

- `POST /api/github/sync` — accepts `{ boardId: string }` as JSON body. Calls `syncBoardGitHubData`. Returns JSON with sync result counts or error. Requires authenticated user who is the board owner.
- Validate input with zod.

### Success Criteria:

#### Automated Verification:

- Build and type-check passes: `npm run build` (covers TypeScript errors)
- Lint passes: `npm run lint`

#### Manual Verification:

- Set up a test board with a PAT and a linked repo (via SQL):
  1. Store an encrypted PAT on a test board via `set_board_github_pat`
  2. Insert a `github_repos` row pointing to a real public repo
  3. Call `POST /api/github/sync` with the board ID
  4. Confirm `github_pull_requests`, `github_reviews`, `github_review_comments` tables contain data
- Verify pagination: link a repo with >100 PRs and confirm all are fetched
- Verify rate-limit logging: check server logs for rate-limit warnings during a large sync
- Run the sync via `npm run dev` (local workerd runtime via Astro/Cloudflare adapter) — confirm Octokit works on workerd without errors
- Run `npm run build && npm run preview` — confirm the built version also works

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- Not required for MVP. The codebase has no test infrastructure set up. Testing is manual.

### Integration Tests:

- Not required for MVP. The sync service is verified manually against a real GitHub PAT and repo.

### Manual Testing Steps:

1. Reset local Supabase: `npx supabase db reset` — confirm all migrations apply
2. Sign in as `supervisor-1@example.test` (password: `password`)
3. Store a real fine-grained PAT on Board Alpha via SQL: call `set_board_github_pat` with the board ID, a real PAT, and the encryption key
4. Insert a `github_repos` row for Board Alpha pointing to a public repo you control (or `octocat/Hello-World`)
5. Call `POST /api/github/sync` with Board Alpha's ID
6. Query `github_pull_requests`, `github_reviews`, `github_review_comments` — confirm rows exist with correct data
7. Sign in as `contributor-1@example.test` — confirm they can SELECT the GitHub data (they're a board member) but cannot call `set_board_github_pat` (not the owner)
8. Verify on workerd: `npm run build && npm run preview` — repeat the sync call and confirm it works in the production-like environment

## Performance Considerations

- **Pagination**: Always use `per_page: 100` to minimize API calls. For a repo with 500 PRs, each with 2 reviews and 5 comments, expect ~500 + 1000 + 2500 = ~4000 API calls. At GitHub's 5,000/hr rate limit, this is tight for large repos. The `since` parameter on the sync service allows incremental fetches after the first full sync.
- **Upsert batching**: Supabase client supports bulk inserts. Batch upserts per page of results (up to 100 rows at a time) rather than one-by-one.
- **Workerd request timeout**: Cloudflare Workers have a 30-second CPU time limit (higher with paid plans). For large repos, the sync may need to be split across multiple requests. F-03 (Cloudflare Workflows with durable execution) will handle this; F-02 targets repos where a single sync completes within limits.

## Migration Notes

- All schema changes are additive (ADD COLUMN, new tables) — no DROP or ALTER of existing columns. Backward-compatible per the expand/contract rule.
- The `github_pat_encrypted` column on `boards` is nullable — existing boards are unaffected.
- `github_repos` uses ON DELETE CASCADE from `boards` — deleting a board cleans up all GitHub data automatically.
- Seed data adds a repo connection row but no encrypted PAT — PAT must be provided manually during development.

## References

- Roadmap F-02: `context/foundation/roadmap.md` lines 80–92
- PRD FR-002, FR-009–FR-011: `context/foundation/prd.md`
- F-01 migration (RLS/SECURITY DEFINER pattern): `supabase/migrations/20260529120000_access_control_and_membership.sql`
- Existing board service (pattern template): `src/lib/services/boards.ts`
- Octokit compatibility with workerd: requires `nodejs_compat` flag (present in `wrangler.jsonc:6`) and per-request instantiation
- GitHub REST API: `GET /repos/{owner}/{repo}/pulls`, `.../pulls/{number}/reviews`, `.../pulls/{number}/comments`

## Addenda

### Rate-limit handling deviation (Phase 2)

The plan specified: "If remaining = 0, compute wait time from `x-ratelimit-reset` and delay." The implementation instead throws `GitHubRateLimitError` when `remaining === 0`. This is intentional and preferable:

- Sleeping inside a Worker request burns wall-clock time toward the 30s limit.
- Throwing lets callers decide the retry strategy (e.g., F-03 Workflows can reschedule the durable task).
- `GitHubRateLimitError.resetAt` carries the reset timestamp, so callers have everything they need to reschedule.

---

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Schema & Token Infrastructure

#### Automated

- [x] 1.1 Migration applies cleanly: `npx supabase db reset` — cd8e464
- [x] 1.2 Build passes: `npm run build` — cd8e464
- [x] 1.3 Lint passes: `npm run lint` — cd8e464

#### Manual

- [x] 1.4 All tables exist with correct columns in local Supabase — cd8e464
- [x] 1.5 RLS prevents cross-board data access — cd8e464
- [x] 1.6 `set_board_github_pat` / `get_board_github_pat` round-trip correctly — cd8e464

### Phase 2: GitHub API Client

#### Automated

- [x] 2.1 Build passes: `npm run build` — c387f37
- [x] 2.2 Lint passes: `npm run lint` — c387f37

#### Manual

- [x] 2.3 `createGitHubClient` returns authenticated Octokit with a real PAT — c387f37
- [x] 2.4 Factory returns null when no PAT is stored — c387f37

### Phase 3: Fetch Service & Integration Verification

#### Automated

- [x] 3.1 Build passes: `npm run build` — ba56375
- [x] 3.2 Lint passes: `npm run lint` — ba56375

#### Manual

- [x] 3.3 Full sync populates all three GitHub data tables — ba56375
- [x] 3.4 Pagination works for repos with >100 PRs — ba56375
- [x] 3.5 Rate-limit warnings appear in logs during large sync — ba56375
- [x] 3.6 Sync works on workerd runtime (`npm run dev` and `npm run build && npm run preview`) — ba56375
