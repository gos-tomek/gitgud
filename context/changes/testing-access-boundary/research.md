---
date: "2026-06-09T13:46:32+02:00"
researcher: Claude
git_commit: d2618b9f25b57c791f794e8bf6fa187660765050
branch: testing-access-boundary
repository: GitGud
topic: "Phase 1 Bootstrap — Risks #1/#2 access boundary + test runner setup: RLS policy tree, PAT leak vectors, Vitest + Supabase integration test patterns"
tags:
  [research, codebase, pat, security, github, logging, encryption, rls, idor, access-control, vitest, testing, supabase]
status: complete
last_updated: "2026-06-09"
last_updated_by: Claude
last_updated_note: "Added follow-up research for test runner setup (Vitest + Astro 6 + Supabase integration testing)"
---

# Research: Risk #2 — GitHub PAT Exposed to Client

**Date**: 2026-06-09T13:46:32+02:00
**Researcher**: Claude
**Git Commit**: d2618b9f25b57c791f794e8bf6fa187660765050
**Branch**: testing-access-boundary
**Repository**: GitGud

## Research Question

Risk #2 from `context/foundation/test-plan.md`: "GitHub PAT exposed to client — raw or partially-masked PAT surfaces in an API response body, error message, or application log." The test-plan guidance requires grounding: (1) all code paths that decrypt or handle raw PAT, (2) error handling in those paths, and (3) logger configuration and output shape.

## Summary

The PAT has two lifecycles: **pre-storage** (user enters raw PAT during board creation → validated → encrypted via pgcrypto) and **post-storage** (decrypted on-demand for GitHub API calls). Four concrete leak vectors were found:

1. **`sync.ts` outer catch** returns arbitrary `err.message` to client — a non-Octokit error could carry PAT context.
2. **`SyncResult.errors[]`** accumulates raw `err.message` strings from per-PR processing and returns them in the API response.
3. **Six `logger.error(tag, err)` calls** log full error objects near PAT-handling code with **zero sanitization** in the logger — currently safe because consola only prints `.message` + `.stack`, but fragile.
4. **Cloudflare Workers observability is enabled** (`wrangler.jsonc`), persisting all console output — any log leak is stored.

No API route intentionally returns the PAT value. The `Board` TypeScript type excludes the PAT column. All board queries use explicit column selection that skips `github_pat_encrypted`. Pre-storage routes use hardcoded error strings in responses.

## Detailed Findings

### PAT Storage & Encryption Architecture

The PAT is stored in `boards.github_pat_encrypted` (bytea) using PostgreSQL `pgcrypto` symmetric encryption.

- **Migration**: `supabase/migrations/20260531100000_github_ingestion_access.sql`
  - Column: `ALTER TABLE public.boards ADD COLUMN github_pat_encrypted bytea;` (lines 3–6)
  - Encrypt: `set_board_github_pat(p_board_id, p_raw_token, p_encryption_key)` — SECURITY DEFINER, calls `pgp_sym_encrypt()` (lines 108–130)
  - Decrypt: `get_board_github_pat(p_board_id, p_encryption_key)` — SECURITY DEFINER, calls `pgp_sym_decrypt()` (lines 131–150)
  - Both functions check `is_board_owner()` before operating
  - Permissions: REVOKE from public/anon; GRANT EXECUTE to authenticated only (lines 147–150)
- **Encryption key**: `GITHUB_TOKEN_ENCRYPTION_KEY` in `astro.config.mjs:25` — `context: "server", access: "secret"`, imported from `astro:env/server`
- **TypeScript types**: `Board` interface in `src/types.ts:1–9` deliberately excludes the PAT column

### PAT Lifecycle A — Pre-Storage (Board Creation Wizard)

During board creation, the raw PAT is sent from the client in POST bodies to five API routes:

| Route                            | File                                    | PAT in request | Response includes PAT?                  | Error handling                                                            |
| -------------------------------- | --------------------------------------- | -------------- | --------------------------------------- | ------------------------------------------------------------------------- |
| `POST /api/github/validate-pat`  | `src/pages/api/github/validate-pat.ts`  | Yes (body)     | No — returns `{ login, id, avatarUrl }` | Hardcoded: `"Token is invalid or expired"` / `"Failed to validate token"` |
| `POST /api/github/repos`         | `src/pages/api/github/repos.ts`         | Yes (body)     | No — returns repo list                  | Hardcoded: `"Failed to fetch repositories"`                               |
| `POST /api/github/collaborators` | `src/pages/api/github/collaborators.ts` | Yes (body)     | No — returns collaborator list          | Hardcoded: `"Failed to fetch collaborators"`                              |
| `POST /api/github/validate-repo` | `src/pages/api/github/validate-repo.ts` | Yes (body)     | No — returns `{ valid: true }`          | Hardcoded: `"Failed to validate repository"`                              |
| `POST /api/boards`               | `src/pages/api/boards/index.ts`         | Yes (body)     | No — returns `{ id, slug }`             | Hardcoded: `"Failed to store GitHub token"` / `"Something went wrong"`    |

All five routes use hardcoded error strings in responses — **safe for response body exposure**.

Board creation stores the PAT via RPC at `src/pages/api/boards/index.ts:62–66`:

```
supabase.rpc("set_board_github_pat", {
  p_board_id: boardId,
  p_raw_token: parsed.data.pat,
  p_encryption_key: GITHUB_TOKEN_ENCRYPTION_KEY,
})
```

### PAT Lifecycle B — Post-Storage (Sync)

The sync flow decrypts the PAT at request time:

1. `src/pages/api/github/sync.ts` calls `syncBoardGitHubData(supabase, boardId)`
2. `src/lib/services/github-sync.ts` calls `createGitHubClient(supabase, boardId)`
3. `src/lib/github.ts:68–88` — `createGitHubClient()` calls `supabase.rpc("get_board_github_pat", ...)`, receives plaintext token, passes to `makeOctokit(token)`
4. `src/lib/github.ts:42–65` — `makeOctokit()` creates Octokit with `auth: token`, installs rate-limit hook and error hook

The decrypted PAT lives in memory as long as the Octokit instance exists (duration of the sync request).

### Leak Vector #1: sync.ts Outer Catch Returns `err.message` to Client

**File**: `src/pages/api/github/sync.ts:58–61`

```typescript
} catch (err) {
  logger.error("[github-sync]", err);
  const message = err instanceof Error ? err.message : "Sync failed";
  return json({ error: message }, 500);
}
```

This catch wraps the entire `syncBoardGitHubData()` call. If a non-Octokit error propagates (e.g., a Supabase error from the decrypt RPC, a runtime error), its `.message` is returned verbatim to the client. While Octokit `RequestError` messages typically don't include the token, this relies on a third-party library's behavior as the safety net rather than explicit sanitization.

### Leak Vector #2: SyncResult.errors[] Forwarded to Client

**File**: `src/lib/services/github-sync.ts:157–160`

```typescript
} catch (err) {
  const msg = `PR #${pr.number} (${owner}/${repoName}): ${err instanceof Error ? err.message : String(err)}`;
  result.errors.push(msg);
  logger.warn(`[github-sync] Skipping ${msg}`);
}
```

The `SyncResult` (including `errors: string[]`) is serialized and returned at `sync.ts:57`:

```typescript
const result = await syncBoardGitHubData(supabase, boardId);
return json(result);
```

Per-PR errors — from Octokit calls, Supabase upserts, or unexpected throws — have their `.message` (or `String(err)`) included in the response. The `String(err)` fallback is particularly concerning: for non-Error objects, it could serialize arbitrary data.

### Leak Vector #3: Logger Has Zero Sanitization + Six Catch Blocks Log Raw Errors

**File**: `src/lib/logger.ts:1`

```typescript
export { consola as logger } from "consola";
```

The logger is a bare re-export of `consola` with **no custom reporters, no redaction filters, no sensitive-value scrubbing**. Six catch blocks in PAT-handling code log the full error object:

| Location                                    | Context                                                                                         |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `src/pages/api/github/validate-pat.ts:63`   | `logger.error("[validate-pat]", err)` — raw PAT in closure scope (`parsed.data.pat` at line 44) |
| `src/pages/api/github/repos.ts:71`          | `logger.error("[repos]", err)` — raw PAT in closure scope (line 44)                             |
| `src/pages/api/github/validate-repo.ts:66`  | `logger.error("[validate-repo]", err)` — raw PAT in closure scope (line 46)                     |
| `src/pages/api/github/collaborators.ts:106` | `logger.error("[collaborators]", err)` — raw PAT in closure scope (line 54)                     |
| `src/pages/api/boards/index.ts:109`         | `logger.error("[boards]", err)` — PAT used at line 64                                           |
| `src/pages/api/github/sync.ts:59`           | `logger.error("[github-sync]", err)` — PAT decrypted inside called function                     |

**Current state**: consola's default reporter prints only `err.message` + `err.stack` for Error objects — it does NOT enumerate arbitrary properties like `.request` (which on Octokit errors contains partially-redacted headers). So the PAT does not currently leak through these log calls.

**Fragility**: Octokit's `@octokit/request-error` performs partial redaction (replaces Authorization header value with `[REDACTED]`), but this is an implementation detail. If consola's behavior changes, if a custom reporter is added, or if a non-Octokit error carries the PAT in its message, the PAT would leak to logs.

### Leak Vector #4: Cloudflare Workers Observability Persists All Log Output

**File**: `wrangler.jsonc:12–14`

```jsonc
"observability": {
  "enabled": true,
},
```

All `console.*` output (which is what consola ultimately writes) is captured and stored in Cloudflare's dashboard. Any value that reaches the logger is persisted in Cloudflare's log infrastructure. This amplifies the risk from Vector #3: even a one-time log leak would be stored and accessible.

Cloudflare observability does **not** automatically log request/response bodies — only explicit console output + request metadata (URL, method, status, timing).

### Safe Patterns Confirmed

- **No `SELECT` returns `github_pat_encrypted`**: All board queries in `src/lib/services/boards.ts` use explicit column selection (lines 36, 52, 68) — none include the PAT column.
- **No `console.*` calls in `src/`**: Grep confirms zero `console.log/error/warn` calls — the project uses the centralized logger exclusively.
- **Middleware has no logging**: `src/middleware.ts` contains zero log statements.
- **Client-side PAT input**: `CreateBoardForm.tsx` stores PAT in React state and uses `type="password"` on the input field. The PAT is sent in POST bodies — inherent to the architecture.
- **Rate-limit logger**: `src/lib/github.ts:51` logs only numeric values + timestamp — no PAT data.

### Octokit Error Hook

**File**: `src/lib/github.ts:57–63`

```typescript
octokit.hook.error("request", (error) => {
  const status = (error as { status?: number }).status ?? 0;
  if (status === 401 || status === 403) {
    throw new GitHubAuthError(`GitHub API auth error ${status}: ${error.message}`);
  }
  throw error;
});
```

The `GitHubAuthError` wraps the original Octokit error message. In pre-storage routes, this is caught and replaced with `"Token is invalid or expired"` — safe. In the sync flow, per-PR catch blocks (Vector #2) forward `err.message` to `SyncResult.errors[]`, which includes the wrapped Octokit message. Octokit's `.message` does not include the auth token, but this is not guaranteed.

## Code References

- `supabase/migrations/20260531100000_github_ingestion_access.sql:3–6` — PAT column definition
- `supabase/migrations/20260531100000_github_ingestion_access.sql:108–150` — encrypt/decrypt SECURITY DEFINER functions
- `astro.config.mjs:25` — GITHUB_TOKEN_ENCRYPTION_KEY env schema
- `src/lib/github.ts:42–65` — `makeOctokit()` with error hook
- `src/lib/github.ts:68–88` — `createGitHubClient()` decrypt + Octokit creation
- `src/lib/logger.ts:1` — bare consola re-export, zero sanitization
- `src/pages/api/github/validate-pat.ts:44,63` — PAT validation, error logging
- `src/pages/api/github/repos.ts:44,71` — repo fetch, error logging
- `src/pages/api/github/collaborators.ts:54,106` — collaborator fetch, error logging
- `src/pages/api/github/validate-repo.ts:46,66` — repo validation, error logging
- `src/pages/api/github/sync.ts:57–61` — sync response + outer catch
- `src/pages/api/boards/index.ts:62–66,109` — PAT storage RPC, error logging
- `src/lib/services/github-sync.ts:157–160` — per-PR error accumulation into SyncResult
- `src/lib/services/boards.ts:36,52,68` — board queries with explicit column selection (no PAT)
- `src/types.ts:1–9` — Board interface excludes PAT
- `wrangler.jsonc:12–14` — Cloudflare observability enabled

## Architecture Insights

**Encryption-at-rest ≠ safe-in-transit**: The test-plan's "must challenge" is correct. The PAT is encrypted in the database but decrypted into memory on every sync request and during the entire board creation wizard flow. The transient exposure surface is broader than the storage surface.

**Defense-in-depth gap**: The architecture has one layer of defense (pgcrypto encryption at rest) but lacks a second layer for transient exposure. No sanitization in the logger, no explicit scrubbing of error messages before they reach the client, and no redaction middleware. The safety currently depends on:

- Hardcoded error strings in pre-storage routes (intentional, robust)
- Octokit's RequestError not including the token in `.message` (third-party implementation detail, fragile)
- consola's default reporter not serializing `.request` property on errors (library behavior, fragile)

**Two distinct test surfaces**:

1. **API response bodies** — testable by calling routes and inspecting JSON. Vectors #1 and #2 are in the sync endpoint only; pre-storage routes are safe.
2. **Log output** — testable by capturing console output during route execution. Vector #3 requires intentional error injection. Vector #4 is a deployment concern, not a code concern.

## Historical Context (from prior changes)

- `context/archive/2026-05-30-github-ingestion-access/plan.md` — F-02 foundation: chose pgcrypto for "MVP simplicity", Vault migration deferred. Defined the encrypt/decrypt SECURITY DEFINER functions. Manual verification pause after Phase 1 to confirm round-trip.
- `context/archive/2026-06-01-link-board-to-github-org/plan.md` — S-02 slice: PAT collected at board creation, validated via `validate-pat`, stored via RPC. "Acceptable for MVP if PAT storage fails after board creation: no transaction rollback across RPC + table inserts."
- `context/foundation/infrastructure.md` — Secrets managed via Workers Secrets (`wrangler secret put`), declared in GitHub Actions secrets for CI. Rotation is human-only. "No observability wired" was cited as evidence for Risk #2 likelihood.
- `context/foundation/prd.md` — FR-018 (update PAT), FR-020 (re-validate on PAT change), FR-022 (freeze board on PAT expiry) — future slices that will extend the PAT handling surface.
- `context/foundation/lessons.md` — "Always REVOKE ALL before RLS" applies to GitHub data tables.

## Related Research

No prior research artifacts exist for this change. Related archived plans:

- `context/archive/2026-05-30-github-ingestion-access/plan.md` — PAT encryption design
- `context/archive/2026-06-01-link-board-to-github-org/plan.md` — PAT collection + storage flow

## Open Questions

1. **Should the logger get a redaction layer before tests are written, or should tests assert current behavior and the redaction be a separate change?** The zero-sanitization logger is a systemic risk that affects more than just PAT handling.
2. **What error shapes does Supabase's RPC actually produce when `pgp_sym_encrypt`/`pgp_sym_decrypt` fails?** PostgreSQL PL/pgSQL error messages can include parameter values in DETAIL/CONTEXT fields. This needs empirical verification to determine whether a decrypt failure could leak the encryption key or PAT in the error message.
3. **Should the sync endpoint's `SyncResult.errors[]` be scrubbed before returning to the client?** The current pattern forwards raw error messages. An alternative is to log the full error server-side and return only a sanitized summary to the client.

## Oracle Sources for Test Assertions

Per the test-plan's Risk Response Guidance, what would prove protection:

> "No API response body, error response, or log entry contains a raw PAT value."

The oracle is not "does the code look safe" — it is **observable behavior**: call every route that handles PATs (including error paths), and assert the PAT string does not appear in the response body or captured log output. Specifically:

| Assertion                                           | Oracle source                                        | Route(s)                                       |
| --------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------- |
| Happy-path response body never contains PAT         | PRD: PAT is an input credential, not a display value | All 6 routes                                   |
| Error response body never contains PAT              | test-plan Risk #2 guidance: "error response"         | All 6 routes (especially sync.ts)              |
| Captured log output never contains PAT              | test-plan Risk #2 guidance: "application log"        | All 6 routes (trigger errors, capture console) |
| Supabase RPC error on decrypt does not leak PAT/key | Domain knowledge: PL/pgSQL errors can include params | `sync.ts`, `boards/index.ts`                   |

---

## Follow-up Research: Risk #1 — Cross-Board Data Leakage (IDOR)

**Added**: 2026-06-09T14:05:00+02:00

### Research Question

Risk #1 from `context/foundation/test-plan.md`: "Cross-board data leakage (IDOR) — a user on Board A reads repos, contributors, or profile data belonging to Board B through API routes or direct Supabase queries." The test-plan guidance requires grounding: full RLS policy tree across all tables with board_id FK; SECURITY DEFINER helpers and search_path settings; any API route that constructs queries.

### Summary

The cross-board isolation model is **sound but single-layer**. All 7 board-scoped tables have RLS with policies correctly scoped to `auth.uid()` via `is_board_member()` / `is_board_owner()` helpers. The Supabase client always carries the user's JWT (anon key + cookie sessions; no service-role client exists). However:

1. **Every table is missing `REVOKE ALL FROM authenticated`** — violating the project's own convention in `lessons.md`. This is the most systemic finding.
2. **Service functions rely solely on RLS** — `getBoardWithRole`, `getBoardRepos`, `getBoardContributors` perform zero application-layer userId checks. The defense is single-layer: if RLS is ever bypassed (service-role client, edge function, migration script), these functions leak data silently.
3. **All SECURITY DEFINER functions correctly pin `search_path`** and those that modify data perform explicit `is_board_owner()` checks.

### Complete Table & RLS Policy Inventory

#### Schema Overview

7 tables, all with RLS enabled:

| Table                    | board_id link          | RLS | REVOKE anon | REVOKE authenticated | SELECT policy                                         | Write policies                                  |
| ------------------------ | ---------------------- | --- | ----------- | -------------------- | ----------------------------------------------------- | ----------------------------------------------- |
| `boards`                 | IS the board (PK)      | Yes | Yes         | **No**               | `is_board_member(id)` OR `owner_user_id = auth.uid()` | owner only                                      |
| `board_members`          | direct FK              | Yes | Yes         | **No**               | `user_id = auth.uid()` OR `is_board_owner(board_id)`  | owner inserts; owner or self deletes; no UPDATE |
| `github_repos`           | direct FK              | Yes | Yes         | **No**               | `is_board_member(board_id)`                           | owner only                                      |
| `github_pull_requests`   | indirect (via repo_id) | Yes | Yes         | **No**               | subquery → `is_board_member(gr.board_id)`             | subquery → owner only                           |
| `github_reviews`         | indirect (2 hops)      | Yes | Yes         | **No**               | `is_board_member(get_board_id_for_pr(...))`           | owner only                                      |
| `github_review_comments` | indirect (2 hops)      | Yes | Yes         | **No**               | `is_board_member(get_board_id_for_pr(...))`           | owner only                                      |
| `board_contributors`     | direct FK              | Yes | Yes         | **No**               | `is_board_member(board_id)`                           | owner inserts/deletes; no UPDATE                |

#### Detailed Policies Per Table

**`boards`** — `supabase/migrations/20260529120000_access_control_and_membership.sql`

| Policy                | Op     | USING                        | WITH CHECK                   | Line                                                    |
| --------------------- | ------ | ---------------------------- | ---------------------------- | ------------------------------------------------------- |
| `boards_select`       | SELECT | `public.is_board_member(id)` | —                            | 68–70                                                   |
| `boards_select_owner` | SELECT | `owner_user_id = auth.uid()` | —                            | `20260529140000_boards_unique_name_per_owner.sql:11–12` |
| `boards_insert`       | INSERT | —                            | `owner_user_id = auth.uid()` | 72–74                                                   |
| `boards_update`       | UPDATE | `owner_user_id = auth.uid()` | `owner_user_id = auth.uid()` | 76–79                                                   |
| `boards_delete`       | DELETE | `owner_user_id = auth.uid()` | —                            | 81–83                                                   |

Note: `boards_select` + `boards_select_owner` OR-merge (PostgreSQL permissive policy semantics). The `boards_select_owner` policy exists because the AFTER INSERT trigger that adds the owner to `board_members` fires after INSERT...RETURNING needs to read back the row.

**`board_members`** — same migration

| Policy                 | Op     | USING                                                     | WITH CHECK                        | Line  |
| ---------------------- | ------ | --------------------------------------------------------- | --------------------------------- | ----- |
| `board_members_select` | SELECT | `user_id = auth.uid() OR public.is_board_owner(board_id)` | —                                 | 87–89 |
| `board_members_insert` | INSERT | —                                                         | `public.is_board_owner(board_id)` | 91–92 |
| `board_members_delete` | DELETE | `user_id = auth.uid() OR public.is_board_owner(board_id)` | —                                 | 97–99 |

No UPDATE policy — comment at line 95: "membership rows are immutable after insert."

Design note: a regular member can only see their OWN membership row. Only the board owner sees all membership rows. Non-owner members cannot enumerate other board members.

**`github_repos`** — `supabase/migrations/20260531100000_github_ingestion_access.sql`

| Policy                | Op     | USING                              | WITH CHECK                        | Line    |
| --------------------- | ------ | ---------------------------------- | --------------------------------- | ------- |
| `github_repos_select` | SELECT | `public.is_board_member(board_id)` | —                                 | 154–156 |
| `github_repos_insert` | INSERT | —                                  | `public.is_board_owner(board_id)` | 158–160 |
| `github_repos_update` | UPDATE | `public.is_board_owner(board_id)`  | `public.is_board_owner(board_id)` | 162–165 |
| `github_repos_delete` | DELETE | `public.is_board_owner(board_id)`  | —                                 | 167–169 |

**`github_pull_requests`** — same migration

| Policy                        | Op     | USING/WITH CHECK                                                                                              | Line    |
| ----------------------------- | ------ | ------------------------------------------------------------------------------------------------------------- | ------- |
| `github_pull_requests_select` | SELECT | `EXISTS (SELECT 1 FROM public.github_repos gr WHERE gr.id = repo_id AND public.is_board_member(gr.board_id))` | 173–175 |
| `github_pull_requests_insert` | INSERT | same subquery → `is_board_owner`                                                                              | 177–179 |
| `github_pull_requests_update` | UPDATE | same subquery → `is_board_owner` (both USING + WITH CHECK)                                                    | 181–184 |
| `github_pull_requests_delete` | DELETE | same subquery → `is_board_owner`                                                                              | 186–188 |

**`github_reviews`** — same migration, uses `get_board_id_for_pr()` helper

| Policy                  | Op     | Expression                                              | Line    |
| ----------------------- | ------ | ------------------------------------------------------- | ------- |
| `github_reviews_select` | SELECT | `is_board_member(get_board_id_for_pr(pull_request_id))` | 192–194 |
| `github_reviews_insert` | INSERT | `is_board_owner(get_board_id_for_pr(pull_request_id))`  | 196–198 |
| `github_reviews_update` | UPDATE | same (both USING + WITH CHECK)                          | 200–203 |
| `github_reviews_delete` | DELETE | `is_board_owner(...)`                                   | 205–207 |

**`github_review_comments`** — same migration, same pattern as `github_reviews`

| Policy                          | Op     | Expression                                              | Line    |
| ------------------------------- | ------ | ------------------------------------------------------- | ------- |
| `github_review_comments_select` | SELECT | `is_board_member(get_board_id_for_pr(pull_request_id))` | 211–213 |
| `github_review_comments_insert` | INSERT | `is_board_owner(get_board_id_for_pr(pull_request_id))`  | 215–217 |
| `github_review_comments_update` | UPDATE | same (both)                                             | 219–222 |
| `github_review_comments_delete` | DELETE | `is_board_owner(...)`                                   | 224–226 |

**`board_contributors`** — `supabase/migrations/20260602120000_board_contributors.sql`

| Policy                      | Op     | USING                              | WITH CHECK                        | Line  |
| --------------------------- | ------ | ---------------------------------- | --------------------------------- | ----- |
| `board_contributors_select` | SELECT | `public.is_board_member(board_id)` | —                                 | 22–24 |
| `board_contributors_insert` | INSERT | —                                  | `public.is_board_owner(board_id)` | 26–28 |
| `board_contributors_delete` | DELETE | `public.is_board_owner(board_id)`  | —                                 | 30–32 |

No UPDATE policy (undocumented, unlike `board_members`). `user_id` nullable column reserved for F-04 account linking — when that ships, an UPDATE policy or DELETE+INSERT pattern will be needed.

### SECURITY DEFINER Functions

All 6 SECURITY DEFINER functions, fully audited:

| Function                               | File:Lines                     | search_path          | Auth check                         | Purpose                                           |
| -------------------------------------- | ------------------------------ | -------------------- | ---------------------------------- | ------------------------------------------------- |
| `is_board_member(uuid)`                | `access_control.sql:37–48`     | `public`             | `auth.uid()` in WHERE              | RLS helper: checks board_members for current user |
| `is_board_owner(uuid)`                 | `access_control.sql:50–61`     | `public`             | `auth.uid()` in WHERE              | RLS helper: checks boards.owner_user_id           |
| `add_owner_as_board_member()`          | `board_triggers.sql:28–41`     | `public`             | None (trigger context)             | Auto-enrolls board owner into board_members       |
| `get_board_id_for_pr(bigint)`          | `github_ingestion.sql:92–103`  | `public`             | None (delegates to calling policy) | Resolves board_id from PR → repo chain            |
| `set_board_github_pat(uuid,text,text)` | `github_ingestion.sql:111–125` | `public, extensions` | `is_board_owner()` + RAISE         | Encrypts and stores PAT                           |
| `get_board_github_pat(uuid,text)`      | `github_ingestion.sql:127–145` | `public, extensions` | `is_board_owner()` + RAISE         | Decrypts and returns PAT                          |

1 SECURITY INVOKER function: `set_updated_at()` (`board_triggers.sql:5–14`) — timestamp trigger, no data access.

All SECURITY DEFINER functions pin `search_path` — no search_path injection risk. All function grants: `REVOKE ALL FROM public, anon; GRANT EXECUTE TO authenticated`.

**Edge case worth testing**: `get_board_id_for_pr(non_existent_id)` returns NULL → `is_board_member(NULL)` → `board_id = NULL` in WHERE → `EXISTS` returns false → access denied. Theoretically safe, but should be verified empirically.

### Board Membership Model

- **`board_members`** table: composite PK `(board_id, user_id)`.
- **Owner auto-enrollment**: AFTER INSERT trigger on `boards` fires `add_owner_as_board_member()` (SECURITY DEFINER), which inserts `(NEW.id, NEW.owner_user_id)` into `board_members` with `ON CONFLICT DO NOTHING`.
- **Additional members**: Only board owner can insert (RLS `board_members_insert` policy).
- **All RLS policies** ultimately resolve through `is_board_member()` (reads `board_members` with SECURITY DEFINER to break the RLS recursion cycle) or `is_board_owner()` (reads `boards` with SECURITY DEFINER).

### API Route Access Patterns

**Supabase client**: `src/lib/supabase.ts` creates client with anon key + cookie-based user sessions via `@supabase/ssr`. **No service-role client exists anywhere in the codebase.** Every query runs with the authenticated user's JWT, so RLS is always active.

**Middleware** (`src/middleware.ts`): Authentication only — redirects unauthenticated users from protected routes. No board-level authorization.

| Route                            | board_id source    | App-layer access check                                    | RLS check                                   | IDOR risk              |
| -------------------------------- | ------------------ | --------------------------------------------------------- | ------------------------------------------- | ---------------------- |
| `POST /api/boards`               | Generated (INSERT) | N/A — creates new board                                   | INSERT policy: `owner_user_id = auth.uid()` | None                   |
| `POST /api/boards/check-name`    | N/A (by name)      | Explicit `.eq("owner_user_id", user.id)`                  | SELECT policy                               | None                   |
| `POST /api/github/sync`          | **Request body**   | `getBoardWithRole` → null check + `role !== "supervisor"` | SELECT membership + owner-only writes       | Low — double-gated     |
| `POST /api/github/validate-pat`  | N/A                | N/A                                                       | N/A (no board data)                         | None                   |
| `POST /api/github/repos`         | N/A                | N/A                                                       | N/A (no board data)                         | None                   |
| `POST /api/github/collaborators` | N/A                | N/A                                                       | N/A (no board data)                         | None                   |
| `POST /api/github/validate-repo` | N/A                | N/A                                                       | N/A (no board data)                         | None                   |
| `GET /boards/[id]`               | **URL param**      | `getBoardWithRole` → null → redirect                      | SELECT membership                           | Depends on RLS         |
| `GET /dashboard`                 | N/A                | `getUserBoards(supabase, user.id)`                        | Explicit userId filter + RLS                | None — double-filtered |

### Service Layer Access Patterns

| Function               | File:Lines           | board_id filtering         | userId filtering                                     | Defense layers                                  |
| ---------------------- | -------------------- | -------------------------- | ---------------------------------------------------- | ----------------------------------------------- |
| `createBoard`          | `boards.ts:33–47`    | N/A (INSERT)               | RLS: `owner_user_id = auth.uid()`                    | 1 (RLS)                                         |
| `getUserBoards`        | `boards.ts:49–59`    | RLS: `is_board_member`     | **Explicit**: `.eq("board_members.user_id", userId)` | **2 (explicit + RLS)**                          |
| `getBoardWithRole`     | `boards.ts:61–76`    | `.eq("id", boardId)`       | **None** — userId only used for role computation     | **1 (RLS only)**                                |
| `getBoardRepos`        | `boards.ts:78–95`    | `.eq("board_id", boardId)` | **None**                                             | **1 (RLS only)**                                |
| `getBoardContributors` | `boards.ts:97–114`   | `.eq("board_id", boardId)` | **None**                                             | **1 (RLS only)**                                |
| `addBoardContributors` | `boards.ts:116–140`  | INSERT with boardId        | **None**                                             | **1 (RLS only)**                                |
| `syncBoardGitHubData`  | `github-sync.ts:90+` | `.eq("board_id", boardId)` | **None**                                             | **1 (RLS only)** — caller does supervisor check |

### Findings

#### FINDING 1 (Critical — Convention Violation): No `REVOKE ALL FROM authenticated` on Any Table

Every migration only revokes from `anon`:

```sql
REVOKE ALL ON public.boards FROM anon;
```

But **none** include the lessons.md convention:

```sql
REVOKE ALL ON public.<table> FROM anon, authenticated;
```

**Affected**: All 7 tables. In standard Supabase, RLS is still enforced for the `authenticated` role because PostgREST uses `SET ROLE`, but the project's own convention is violated. This matters as a **test target**: the tests should verify that RLS denies access even though `REVOKE ALL FROM authenticated` is missing — and if it doesn't, that's a real gap.

#### FINDING 2 (Medium — Single-Layer Defense): Service Functions Rely Solely on RLS

`getBoardWithRole`, `getBoardRepos`, `getBoardContributors` perform zero application-layer userId filtering. They trust RLS entirely.

- **Current state**: Safe — the Supabase client always carries the user's JWT.
- **Future risk**: If a service-role client is ever introduced (for webhooks, edge functions, migration scripts), these functions would silently leak cross-board data.
- **Contrast**: `getUserBoards` has both explicit userId filtering AND RLS — the safer pattern.

#### FINDING 3 (Low — Missing Documentation): `board_contributors` No UPDATE Policy

`board_members` explicitly documents "No UPDATE policy: membership rows are immutable after insert" (comment at line 95). `board_contributors` follows the same pattern but has no such comment. Currently safe (RLS with no matching policy = deny), but when F-04 ships (account linking via `user_id` column), an UPDATE policy will be needed.

#### FINDING 4 (Low — Edge Case): `get_board_id_for_pr(NULL)` Behavior

If `pull_request_id` references a non-existent PR, `get_board_id_for_pr()` returns NULL → `is_board_member(NULL)` → `board_id = NULL` → `EXISTS` returns false → access denied. Theoretically correct but should be verified with an integration test.

#### FINDING 5 (Info): `boards_select` + `boards_select_owner` OR-Merge

Two permissive SELECT policies on `boards` combine via PostgreSQL OR-merge. This is intentional and correct — the `boards_select_owner` policy was added to solve a timing issue where INSERT...RETURNING needs to read back the row before the AFTER INSERT trigger enrolls the owner in `board_members`.

### Code References (Risk #1)

- `supabase/migrations/20260529120000_access_control_and_membership.sql:5–99` — boards, board_members tables + all RLS policies + helper functions
- `supabase/migrations/20260529130000_board_triggers.sql:28–47` — owner auto-enrollment trigger
- `supabase/migrations/20260529140000_boards_unique_name_per_owner.sql:11–12` — supplemental boards_select_owner policy
- `supabase/migrations/20260531100000_github_ingestion_access.sql:10–226` — github_repos, github_pull_requests, github_reviews, github_review_comments + all RLS policies + get_board_id_for_pr helper
- `supabase/migrations/20260602120000_board_contributors.sql:6–32` — board_contributors + RLS policies
- `src/lib/supabase.ts` — Supabase client creation (anon key, cookie sessions)
- `src/middleware.ts` — Authentication-only middleware
- `src/lib/services/boards.ts:61–76` — `getBoardWithRole` (single-layer RLS defense)
- `src/lib/services/boards.ts:78–95` — `getBoardRepos` (single-layer RLS defense)
- `src/lib/services/boards.ts:97–114` — `getBoardContributors` (single-layer RLS defense)
- `src/lib/services/boards.ts:49–59` — `getUserBoards` (double-layer: explicit userId + RLS)
- `src/pages/api/github/sync.ts:47–51` — Sync route explicit supervisor check
- `src/pages/boards/[id].astro:7–17` — Board detail page access flow

### Architecture Insights (Risk #1)

**Consistent access pattern**: Every table follows the same model — SELECT for members, writes for owner only. The `is_board_member()` / `is_board_owner()` helpers centralize the logic and break the RLS recursion cycle. This consistency is a strength: a single test template can cover the pattern across all tables.

**Single-layer vs double-layer defense**: The codebase has two patterns. `getUserBoards` is double-filtered (explicit userId + RLS). Everything else is single-layer (RLS only). The test-plan's "must challenge" — "RLS is enabled does not mean RLS is correct" — applies to the single-layer paths. Tests must prove that RLS actually denies cross-board access by running real queries as a non-member user, not by reading migration SQL.

**Indirect board_id resolution**: For deeply nested tables (`github_reviews`, `github_review_comments`), the RLS policy resolves `board_id` through a 2-hop join via `get_board_id_for_pr()`. This is a SECURITY DEFINER function that bypasses RLS on `github_pull_requests` and `github_repos` internally (correctly — it needs to read across the chain). The test should verify that a non-member cannot access reviews even when they know the PR ID.

### Oracle Sources for Test Assertions (Risk #1)

Per the test-plan's Risk Response Guidance:

> "User on Board A cannot SELECT/INSERT/UPDATE/DELETE rows belonging to Board B, regardless of API route."

The oracle is **cross-user behavior against a real database**: create two boards with two different owners, and verify that neither can access the other's data through any operation.

| Assertion                                                                    | Oracle source                                                                        | Tables                                                      |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| Non-member cannot SELECT board rows                                          | PRD Access Control: board membership gates visibility                                | `boards`, `board_members`                                   |
| Non-member cannot SELECT board's repos, PRs, reviews, comments, contributors | test-plan Risk #1: "reads repos, contributors, or profile data belonging to Board B" | All 6 board-scoped tables                                   |
| Non-owner cannot INSERT/UPDATE/DELETE board data                             | RLS policy design: writes restricted to owner                                        | All 7 tables                                                |
| Non-member gets empty result (not an error) from service functions           | Supabase RLS behavior: filtered rows return empty, not 403                           | `getBoardWithRole`, `getBoardRepos`, `getBoardContributors` |
| Cross-board access denied through indirect joins (PR → repo → board)         | Policy design: `get_board_id_for_pr()` resolves board_id for deeply nested tables    | `github_reviews`, `github_review_comments`                  |
| `get_board_id_for_pr(non_existent_id)` denies access                         | Edge case: NULL board_id should never grant access                                   | `github_reviews`, `github_review_comments`                  |
| Missing `REVOKE ALL FROM authenticated` does not create a bypass             | lessons.md convention vs actual migration state                                      | All 7 tables                                                |

---

## Follow-up Research: Test Runner Setup (Vitest + Astro 6 + Supabase Integration)

**Added**: 2026-06-09T14:30:00+02:00

### Research Question

How to bootstrap a test runner for this project: Vitest version compatibility with Vite 7/Astro 6, handling `astro:env/server` virtual module imports in tests, Supabase integration test patterns (user creation, RLS-scoped queries, data lifecycle), and project-specific configuration.

### Summary

Vitest 4.x is the right choice — it explicitly supports Vite 7 and Node 22. The key integration challenge is the `astro:env/server` virtual module, solved by Astro's `getViteConfig()` helper which runs the full Astro plugin pipeline. For integration tests, the most testable code (`src/lib/services/`) is already clean of `astro:env` — service functions accept a Supabase client as a parameter, so tests can bypass the Astro middleware entirely by constructing clients directly with `createClient` from `@supabase/supabase-js`.

### Vitest Version & Installation

| Vitest                | Vite range                         | Node range | Status                     |
| --------------------- | ---------------------------------- | ---------- | -------------------------- |
| 4.1.8 (latest stable) | `^6.0.0 \|\| ^7.0.0 \|\| ^8.0.0`   | `>=20.0.0` | **Recommended**            |
| 3.2.6 (latest 3.x)    | `^5.0.0 \|\| ^6.0.0 \|\| ^7.0.0-0` | `>=18.0.0` | Compatible but not current |

This project: Vite 7.3.2 (overridden), Node 22.14.0. **Install: `npm install -D vitest`** (gets 4.1.8).

Note: Context7 docs for Vitest main branch reference "Vitest 5.0 requires Vite >=6.4.0" — this is the unreleased next version, not current stable.

### `astro:env/server` Virtual Module — Impact Analysis

Only 4 files import from `astro:env/server`:

| File                              | Env vars                       | Imported by (runtime)                        |
| --------------------------------- | ------------------------------ | -------------------------------------------- |
| `src/lib/supabase.ts:3`           | `SUPABASE_URL`, `SUPABASE_KEY` | middleware, all API routes, all .astro pages |
| `src/lib/config-status.ts:1`      | `SUPABASE_URL`, `SUPABASE_KEY` | `Layout.astro` only                          |
| `src/lib/github.ts:4`             | `GITHUB_TOKEN_ENCRYPTION_KEY`  | github API routes, `github-sync.ts`          |
| `src/pages/api/boards/index.ts:5` | `GITHUB_TOKEN_ENCRYPTION_KEY`  | (endpoint, not imported)                     |

**Critical insight**: The service modules under `src/lib/services/` (`boards.ts`, `github-sync.ts`) do **not** import from `astro:env/server`. They accept a `SupabaseClient` as a parameter (type-only import from `supabase.ts`). This means integration tests of RLS behavior can construct Supabase clients directly, sidestepping the virtual module entirely.

Only one other `astro:*` virtual module is used: `astro:middleware` in `src/middleware.ts:1`. Both are resolved by `getViteConfig()`.

### Recommended Vitest Configuration

Use Astro's `getViteConfig()` helper in a separate `vitest.config.ts`:

```typescript
/// <reference types="vitest/config" />
import { getViteConfig } from "astro/config";

export default getViteConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.{test,spec}.{ts,tsx}", "tests/**/*.{test,spec}.{ts,tsx}"],
  },
});
```

**Why `getViteConfig`**: It runs Astro's full Vite plugin pipeline — resolves `astro:env/server`, `astro:middleware`, path aliases (`@/*`), and all integrations. This is Astro's officially documented approach.

**Why `environment: "node"`**: Astro 6 breaking change — components can no longer be rendered in `jsdom`/`happy-dom`. Also, the integration tests call Supabase over HTTP, which works natively in Node 22.

**Path aliases**: `getViteConfig()` picks up `@/*` → `./src/*` from the Astro config pipeline. If it doesn't resolve correctly, add explicit alias:

```typescript
resolve: {
  alias: {
    "@/": new URL("./src/", import.meta.url).pathname,
  },
},
```

Never use bare relative strings — Vitest resolves them relative to the test file, not the config.

**Alternative approaches to `astro:env`** (if `getViteConfig` causes issues):

| Approach                           | Pros              | Cons                                              |
| ---------------------------------- | ----------------- | ------------------------------------------------- |
| `vi.mock("astro:env/server", ...)` | Per-test control  | Needs resolveId plugin; must repeat in every file |
| `resolve.alias` → shim module      | Simple, fast      | Must maintain shim when env vars change           |
| Refactor to single `env.ts`        | Single mock point | Unnecessary indirection for 4 import sites        |

### Cloudflare Workers Considerations

No Cloudflare-specific APIs used in `src/`. Confirmed by searching for `crypto.subtle`, `caches.default`, `waitUntil`, `context.env`, `platform.env`, `locals.runtime`, `getRuntime`. Zero hits.

`wrangler.jsonc` has only the `ASSETS` binding (from `@astrojs/cloudflare`) and `compatibility_flags: ["nodejs_compat"]`. No KV, D1, R2, or Durable Objects.

**Conclusion**: Run tests in Node.js. No `workerd` or `miniflare` needed.

### Supabase Integration Test Patterns

#### Two-Client Pattern

| Client               | Key                                        | RLS          | Use                                                  |
| -------------------- | ------------------------------------------ | ------------ | ---------------------------------------------------- |
| Admin (service-role) | `SUPABASE_SERVICE_ROLE_KEY`                | **Bypassed** | Setup/teardown: create users, seed data, cleanup     |
| User (anon + auth)   | `SUPABASE_ANON_KEY` + `signInWithPassword` | **Enforced** | Test assertions: verify what the user can/cannot see |

```typescript
import { createClient } from "@supabase/supabase-js";

// Admin — bypasses RLS
const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// User — RLS applies after signInWithPassword
const userClient = createClient(SUPABASE_URL, ANON_KEY);
await userClient.auth.signInWithPassword({ email, password });
```

Use `createClient` from `@supabase/supabase-js` directly — **not** `createServerClient` from `@supabase/ssr` (which requires Astro's cookie middleware). The API surface is identical; the only difference is session storage (memory vs cookies).

#### Creating Test Users

```typescript
const { data, error } = await adminClient.auth.admin.createUser({
  email: "owner-a@test.local",
  password: "test-password-123",
  email_confirm: true, // critical: skip email verification
});
```

`email_confirm: true` auto-confirms the user. Local Supabase config has `enable_confirmations = false` (`supabase/config.toml:209`), but the explicit flag is the safe choice.

#### RLS Denial Behavior (critical for assertions)

| Operation                     | RLS denial                   | How to assert                       |
| ----------------------------- | ---------------------------- | ----------------------------------- |
| **SELECT**                    | Returns empty `[]`, no error | `expect(data).toEqual([])`          |
| **INSERT** (WITH CHECK fails) | Error code `42501`           | `expect(error?.code).toBe("42501")` |
| **UPDATE** (USING fails)      | Silently updates 0 rows      | Verify row unchanged via admin      |
| **DELETE** (USING fails)      | Silently deletes 0 rows      | Verify row still exists via admin   |

This is fundamental: **SELECT/UPDATE/DELETE denials are silent**. Only INSERT violations produce an explicit error. Tests must use the admin client to verify state after silent denials.

#### Data Lifecycle

- **Seed**: Use admin client to INSERT boards, members, repos. The CASCADE chain (board → board_members → github_repos → PRs → reviews/comments) means seeding only needs to start at the board level.
- **Cleanup**: DELETE boards via admin (CASCADE handles all children). Delete test users via `adminClient.auth.admin.deleteUser(userId)`.
- **Full reset**: `npx supabase db reset` recreates DB + re-applies migrations + re-runs `seed.sql`. Use between full suite runs, not between individual tests.

Existing `supabase/seed.sql` creates 3 users (password: "password"), 2 boards, board memberships, and 1 GitHub repo. Can be used as a baseline or skipped with `--no-seed`.

#### Recommended Test Lifecycle

```
beforeAll:
  - Verify local Supabase is running (supabase status)
  - Create admin client with service-role key

beforeEach:
  - Create ephemeral test users (unique emails per test)
  - Seed test-specific boards/members via admin

afterEach:
  - DELETE test boards (CASCADE handles children)
  - DELETE test users via admin

afterAll:
  - (optional) supabase db reset
```

### Test Helper Module — Recommended Shape

```typescript
// tests/helpers/supabase.ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? "<local-anon-key>";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "<local-service-role-key>";

export const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

export async function createTestUser(email: string, password = "test-password-123") {
  const { data, error } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw new Error(`Failed to create ${email}: ${error.message}`);
  const client = createClient(SUPABASE_URL, ANON_KEY);
  await client.auth.signInWithPassword({ email, password });
  return { client, userId: data.user.id };
}
```

The local anon/service-role keys are stable across `supabase start` invocations (generated from the project config). They can be hardcoded in the helper or read from `npx supabase status --output json`.

### What the Integration Tests Do NOT Need

- **No `workerd`/`miniflare`**: No Cloudflare-specific APIs in tested code
- **No `@supabase/ssr`**: Tests bypass the Astro cookie middleware entirely
- **No `astro:env` mocking for service tests**: `boards.ts` and `github-sync.ts` accept Supabase client as parameter
- **No seed.sql dependency**: Tests create their own ephemeral data
- **No Astro dev server**: Tests call Supabase directly, not through HTTP routes

### Code References (Test Runner)

- `package.json` — no test dependencies; Vite 7.3.2 override at line 63
- `astro.config.mjs:21–27` — env schema (`SUPABASE_URL`, `SUPABASE_KEY`, `GITHUB_TOKEN_ENCRYPTION_KEY`)
- `tsconfig.json:8–9` — path alias `@/*` → `./src/*`
- `src/lib/supabase.ts:3` — `astro:env/server` import (leaf module)
- `src/lib/github.ts:4` — `astro:env/server` import (leaf module)
- `src/lib/services/boards.ts` — clean of `astro:env`; accepts `SupabaseClient` parameter
- `src/lib/services/github-sync.ts` — clean of `astro:env`; accepts `SupabaseClient` parameter
- `supabase/config.toml:209` — `enable_confirmations = false`
- `supabase/seed.sql` — existing seed: 3 users, 2 boards, 1 repo
- `wrangler.jsonc:12–14` — observability enabled; line 5: `nodejs_compat` flag
