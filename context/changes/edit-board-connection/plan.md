# Edit Board Connection — Implementation Plan

## Overview

Move PAT storage from per-board (`boards.github_pat_encrypted`) to per-user (`user_profiles`), build a full `/profile/settings` page, fix the BoardTopbar avatar, add PAT-expiry capture with a 7-day warning banner, implement full account deletion, and update the PRD to reflect per-user PAT semantics.

## Current State Analysis

- **PAT storage**: `boards.github_pat_encrypted` (bytea) — encrypted via `pgp_sym_encrypt` in `create_board_atomic` RPC, decrypted via `get_board_github_pat` RPC. Called from `createGitHubClient` (`src/lib/github.ts:80`) and indirectly from `src/worker.ts:96`.
- **Avatar**: `user_profiles.avatar_url` exists and is populated by the `handle_new_user` trigger at signup. `BoardTopbar.astro:91-92` renders `userInitial` (a letter) instead of the actual avatar image.
- **Profile page**: `BoardTopbar.astro:99` links to `/profile/settings` — route does not exist (404). No `src/pages/profile/` directory.
- **PAT expiry**: No expiry data is stored anywhere. `validate-pat.ts:52` calls `octokit.rest.users.getAuthenticated()` which returns the `GitHub-Authentication-Token-Expiration` header, but the code only destructures `{ data }`, discarding headers.
- **Route protection**: `PROTECTED_ROUTES = ["/dashboard", "/board"]` in `src/middleware.ts:4`. `/profile` is unprotected.
- **FK issue**: `github_repos.connected_by` references `auth.users(id)` with no cascade — blocks user deletion.

### Key Discoveries:

- `Banner.astro` with `variant="warning"` + `config-status.ts` → `Layout.astro` is the established site-wide notification pattern
- Board settings page (`src/pages/board/[id]/settings.astro`) uses card pattern: `rounded-lg border border-white/10 bg-white/5 px-4 py-3` with uppercase section headers
- `create_board_atomic` accepts `p_raw_token` and encrypts inline — this RPC needs to stop accepting a raw token and instead read from `user_profiles`
- The Worker builds Octokit outside `step.do` at `src/worker.ts:96` — it calls `createGitHubClient(supabase, boardId, encryptionKey)` which must resolve the board's owner to find the user-level PAT
- GitHub's `GitHub-Authentication-Token-Expiration` header uses a non-ISO format: `"2026-06-03 19:52:44 UTC"` or `"2025-09-05 17:55:53 +0500"` — needs a small parsing utility

## Desired End State

- Users have one PAT stored in `user_profiles.github_pat_encrypted`, shared across all boards they own. `token_expires_at` is captured at PAT-save time from the GitHub response header.
- `/profile/settings` is a live, protected page with sections: GitHub identity (read-only), avatar preview, PAT management (status, expiry, update), sign-out, and danger zone (full account + data deletion).
- `BoardTopbar.astro` renders the user's GitHub avatar image instead of an initial letter.
- A site-wide warning banner appears on all pages when the PAT expires within 7 days.
- `boards.github_pat_encrypted` still exists but is unused (expand phase). Its removal is deferred to a future release per expand/contract.
- PRD FR-018/020/022 are updated to reflect per-user PAT semantics.

### Verification:

- All existing tests pass (unit, component, hermetic, integration)
- Type checking passes for both src and tests
- New migration applies cleanly on local Supabase
- Create-board wizard shows stored PAT info and allows override
- Profile page renders all sections and PAT update works
- Account deletion cascades correctly (boards, repos, PRs, reviews, comments, classifications all removed)
- Expiry banner appears when PAT is within 7 days of expiring

## What We're NOT Doing

- Dropping `boards.github_pat_encrypted` — that's a future contract-phase migration
- Per-board PAT override for multi-org users — documented as a known gap
- PAT expiry refresh on every sync call — capture at save time only
- Board transfer on account deletion — boards are deleted with the user
- Email notifications for PAT expiry — in-app banner only

## Implementation Approach

Six phases, ordered by dependency:

1. **Avatar fix** (independent, ships first)
2. **Data model expansion** (migration: new columns + RPCs + backfill + FK fix + route protection)
3. **PAT capture & board creation flow** (expiry header capture, save-PAT API, modified create-board, updated read paths)
4. **Profile/settings page** (full account settings including delete-account)
5. **PAT expiry warning banner** (Layout.astro integration)
6. **PRD update** (amend FR-018/020/022)

## Critical Implementation Details

### Timing & lifecycle

The Worker (`src/worker.ts:96`) builds Octokit **outside** `step.do` — on every Workflow `run()` resume it re-calls `createGitHubClient`. After Phase 3, this call must resolve the board's owner (`boards.owner_user_id`) to decrypt the user-level PAT. The `get_user_github_pat` RPC accepts a `p_board_id` parameter and internally joins to `boards.owner_user_id` so the call site stays the same shape — only the RPC name changes.

### State sequencing

`create_board_atomic` currently encrypts the PAT inline. After Phase 3, the PAT is already stored in `user_profiles` before board creation begins. The RPC must stop accepting `p_raw_token` / `p_encryption_key` and instead verify that the owner has a PAT stored. This is a breaking RPC signature change — `POST /api/board` must be updated in the same deploy.

---

## Phase 1: Avatar Fix in BoardTopbar

### Overview

Replace the initial-letter avatar in `BoardTopbar.astro` with the user's actual GitHub avatar from `user_profiles.avatar_url`. This is a render-only change — the data already exists.

### Changes Required:

#### 1. Pass avatar URL to BoardTopbar

**File**: `src/components/BoardTopbar.astro`

**Intent**: Add an `avatarUrl` prop (optional string) and render an `<img>` when present, falling back to the initial-letter circle when absent.

**Contract**: Props interface gains `avatarUrl?: string`. The `<summary>` element at line 89-93 conditionally renders either `<img src={avatarUrl} class="h-8 w-8 rounded-full" />` or the existing purple circle with `userInitial`.

#### 2. Supply avatarUrl from pages that use BoardTopbar

**File**: `src/pages/board/[id]/settings.astro` (and all other pages that render BoardTopbar)

**Intent**: Fetch `avatar_url` from `user_profiles` for the authenticated user and pass it as the `avatarUrl` prop.

**Contract**: Query `user_profiles` for `avatar_url` where `user_id = user.id`. Pass result to `<BoardTopbar avatarUrl={profile?.avatar_url} ... />`. Same change applies to every page that renders `BoardTopbar` (find all with `grep -r "BoardTopbar" src/pages/`).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx tsc --noEmit`
- Linting passes: `npm run lint`
- Existing tests pass: `npm test`

#### Manual Verification:

- Board pages show the user's GitHub avatar in the top-right instead of a letter
- If `avatar_url` is null, the letter fallback still renders correctly

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Data Model Expansion

### Overview

Add PAT and expiry columns to `user_profiles`, create new encrypt/decrypt RPCs, backfill existing PATs from boards, fix the `github_repos.connected_by` FK, and add `/profile` to protected routes.

### Changes Required:

#### 1. Migration: expand user_profiles + new RPCs + FK fix

**File**: `supabase/migrations/YYYYMMDDHHMMSS_user_pat_and_expiry.sql` (new file, timestamp at creation time)

**Intent**: Add `github_pat_encrypted bytea` and `token_expires_at timestamptz` to `user_profiles`. Create `set_user_github_pat` and `get_user_github_pat` RPCs. Backfill PATs from the most recently created board per user. Fix `github_repos.connected_by` FK to add `ON DELETE SET NULL`.

**Contract**:

```sql
-- 1. Add columns
ALTER TABLE public.user_profiles
  ADD COLUMN github_pat_encrypted bytea,
  ADD COLUMN token_expires_at     timestamptz;

-- 2. set_user_github_pat(p_user_id uuid, p_raw_token text, p_encryption_key text, p_expires_at timestamptz)
--    SECURITY DEFINER, SET search_path = public, extensions
--    Checks auth.uid() = p_user_id, then pgp_sym_encrypt + UPDATE user_profiles
--    Stores p_expires_at alongside the encrypted token

-- 3. get_user_github_pat(p_board_id uuid, p_encryption_key text) RETURNS text
--    SECURITY DEFINER, SET search_path = public, extensions
--    Joins boards.owner_user_id to user_profiles to find the PAT
--    Auth check: auth.role() = 'service_role' OR auth.uid() = boards.owner_user_id
--    (mirrors the service_role bypass from get_board_github_pat)

-- 4. Backfill: for each user, copy github_pat_encrypted from their most recently created board
--    UPDATE user_profiles up
--    SET github_pat_encrypted = b.github_pat_encrypted
--    FROM (SELECT DISTINCT ON (owner_user_id) owner_user_id, github_pat_encrypted
--          FROM boards WHERE github_pat_encrypted IS NOT NULL
--          ORDER BY owner_user_id, created_at DESC) b
--    WHERE up.user_id = b.owner_user_id AND up.github_pat_encrypted IS NULL;

-- 5. Fix github_repos.connected_by FK
ALTER TABLE public.github_repos
  DROP CONSTRAINT github_repos_connected_by_fkey,
  ADD CONSTRAINT github_repos_connected_by_fkey
    FOREIGN KEY (connected_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.github_repos ALTER COLUMN connected_by DROP NOT NULL;

-- 6. REVOKE/GRANT on new functions (standard pattern)
```

#### 2. Add /profile to PROTECTED_ROUTES

**File**: `src/middleware.ts`

**Intent**: Protect `/profile` routes so unauthenticated users are redirected to sign-in.

**Contract**: Add `"/profile"` to the `PROTECTED_ROUTES` array at line 4.

#### 3. Update TypeScript types

**File**: `src/types.ts`

**Intent**: Add `github_pat_encrypted`, `token_expires_at` fields to any UserProfile type if one exists, or create one.

**Contract**: If no `UserProfile` type exists yet, add one matching the `user_profiles` table schema. If queries are done inline (no typed interface), skip this — the type will be inferred from Supabase client.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npx supabase db reset`
- Type checking passes: `npx tsc --noEmit`
- Existing tests pass: `npm test`
- Integration tests pass (if Supabase is running): `npx vitest run tests/integration/`

#### Manual Verification:

- `user_profiles` table has new columns in Supabase Studio
- Backfilled PATs are present for users who had boards
- `connected_by` column is now nullable
- Unauthenticated request to `/profile/settings` redirects to `/auth/signin`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: PAT Capture & Board Creation Flow

### Overview

Modify `validate-pat.ts` to capture the expiry header. Create a `POST /api/profile/pat` endpoint to save/update the user's PAT. Update `create_board_atomic` to read from `user_profiles` instead of accepting a raw token. Update `createGitHubClient` to use the new `get_user_github_pat` RPC. Update `CreateBoardForm` step 1 to show stored PAT info.

### Changes Required:

#### 1. Capture expiry header in validate-pat

**File**: `src/pages/api/github/validate-pat.ts`

**Intent**: Read the `GitHub-Authentication-Token-Expiration` header from the Octokit response and return it alongside login/id/avatarUrl.

**Contract**: Change `const { data }` to `const { data, headers }` at line 52. Read `headers["github-authentication-token-expiration"]`. Parse the non-ISO date string into an ISO timestamp (or `null` if header is absent). Return `{ login, id, avatarUrl, expiresAt, warning? }`.

#### 2. GitHub expiry date parsing utility

**File**: `src/lib/github.ts`

**Intent**: Parse GitHub's non-ISO `GitHub-Authentication-Token-Expiration` header value into a `Date`.

**Contract**: Export `parseGitHubTokenExpiry(raw: string): Date | null`. Handles two known formats: `"2026-06-03 19:52:44 UTC"` and `"2025-09-05 17:55:53 +0500"`. Returns `null` for unparseable values or dates in the past (defensive against the 2025 header bug).

#### 3. Save-PAT API endpoint

**File**: `src/pages/api/profile/pat.ts` (new file)

**Intent**: Authenticated endpoint to save or update the user's PAT in `user_profiles`. Validates the token against GitHub, captures expiry, then calls `set_user_github_pat` RPC.

**Contract**: `POST` route. Accepts `{ pat: string }`. Validates via `octokit.rest.users.getAuthenticated()`, reads expiry header, calls `set_user_github_pat` RPC with the raw token, encryption key, and parsed expiry. Returns `{ login, expiresAt }` on success. Uses the `GITHUB_TOKEN_ENCRYPTION_KEY` from `astro:env/server`.

#### 4. Update create_board_atomic RPC

**File**: `supabase/migrations/YYYYMMDDHHMMSS_create_board_read_user_pat.sql` (new migration)

**Intent**: Replace `create_board_atomic` to stop accepting `p_raw_token` / `p_encryption_key`. Instead, verify that the owner has a PAT stored in `user_profiles` and skip inline encryption.

**Contract**: `CREATE OR REPLACE FUNCTION public.create_board_atomic(p_user_id uuid, p_name text, p_repos jsonb, p_contributors jsonb) RETURNS uuid`. Removes the PAT parameters. The function checks `user_profiles.github_pat_encrypted IS NOT NULL` for `p_user_id` and raises an exception if missing ("No GitHub token configured — save one in Profile Settings first"). Board row is inserted without touching PAT data.

#### 5. Update POST /api/board

**File**: `src/pages/api/board/index.ts`

**Intent**: Remove `pat` from the request schema and stop passing it to `create_board_atomic`.

**Contract**: Remove `pat` from `createBoardSchema`. Remove `p_raw_token` and `p_encryption_key` from the RPC call at line 59-70.

#### 6. Update createGitHubClient to use user-level PAT

**File**: `src/lib/github.ts`

**Intent**: Change `createGitHubClient` to call `get_user_github_pat` (resolves via board → owner → user_profiles) instead of `get_board_github_pat`.

**Contract**: Replace `supabase.rpc("get_board_github_pat", ...)` with `supabase.rpc("get_user_github_pat", { p_board_id: boardId, p_encryption_key: key })`. The function signature stays the same — callers (worker, API routes) are unaffected.

#### 7. Update CreateBoardForm step 1

**File**: `src/components/CreateBoardForm.tsx`

**Intent**: When the user already has a stored PAT, show their GitHub identity (login, expiry) and offer an option to use a different token. The PAT step is still shown (per user choice) but pre-filled with status info.

**Contract**: The form receives a new prop `storedPat?: { login: string; expiresAt: string | null }`. When present, step 1 shows the stored PAT identity with a "Use stored token" default and a "Use a different token" toggle. When the user proceeds with the stored token, step 2+ uses the stored PAT for repo/collaborator fetching (the PAT is already server-side; API routes read it from `user_profiles`). When the user enters a new token, the form saves it via `POST /api/profile/pat` before proceeding.

#### 8. Update wizard reducer

**File**: `src/components/wizard-reducer.ts`

**Intent**: Handle the "stored PAT" state — skip validation when using the stored token.

**Contract**: Add a `USE_STORED_PAT` action that sets the wizard state to PAT-validated with the stored login/expiry, bypassing the debounced validation flow.

#### 9. Update pages that render CreateBoardForm

**File**: `src/pages/board/new.astro` (or wherever CreateBoardForm is rendered)

**Intent**: Fetch the user's stored PAT status from `user_profiles` and pass it as the `storedPat` prop.

**Contract**: Query `user_profiles` for `github_login` and `token_expires_at` where `user_id = user.id` and `github_pat_encrypted IS NOT NULL`. Pass result as `storedPat` prop.

#### 10. Update API routes that accept raw PAT from wizard

**Files**: `src/pages/api/github/repos.ts`, `src/pages/api/github/validate-repo.ts`, `src/pages/api/github/collaborators.ts`

**Intent**: These endpoints currently accept a raw PAT in the request body. When the user uses their stored PAT, the frontend won't send a raw token. These endpoints need to fall back to reading the user's PAT from `user_profiles` when no raw PAT is provided.

**Contract**: Make the `pat` field optional in each endpoint's zod schema. When `pat` is absent, call `get_user_github_pat` to decrypt the stored token (requires the board-creation flow to have a user context but no board yet — may need a `get_user_github_pat_by_user_id` RPC variant that doesn't require a board_id). When `pat` is provided, use it directly (for the "use a different token" flow).

### Success Criteria:

#### Automated Verification:

- New migration applies cleanly: `npx supabase db reset`
- Type checking passes: `npx tsc --noEmit` and `npm run test:typecheck`
- Linting passes: `npm run lint`
- Existing tests pass: `npm test`
- Build succeeds: `npm run build`

#### Manual Verification:

- Creating a board without a stored PAT shows an error prompting to save one first
- Creating a board with a stored PAT shows the stored identity in step 1
- "Use a different token" flow validates and saves the new token
- Saving a PAT via `/api/profile/pat` stores encrypted token + expiry in `user_profiles`
- `validate-pat` response includes `expiresAt` field
- Worker sync still works (decrypts PAT from user_profiles via board → owner join)
- Tokens without expiry return `expiresAt: null`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Profile/Settings Page

### Overview

Create the `/profile/settings` page with full account settings: GitHub identity (read-only), avatar preview, PAT management (status/expiry/update), sign-out, and danger zone (full account deletion).

### Changes Required:

#### 1. Profile settings page

**File**: `src/pages/profile/settings.astro` (new file)

**Intent**: Full account settings page following the board settings card pattern. Sections: GitHub identity, avatar, PAT status, sign-out, danger zone.

**Contract**: Uses `Layout` wrapper. Reads `user_profiles` for identity + PAT status. Card pattern matches board settings (`rounded-lg border border-white/10 bg-white/5 px-4 py-3`). Uses a simplified topbar (no board context — just logo + avatar dropdown). PAT section shows: current status (connected as @login / no token), expiry date or "No expiration", and an "Update token" button/form. Danger zone section: red-bordered card with "Delete account" button and confirmation dialog.

#### 2. PAT update form (React island)

**File**: `src/components/PatUpdateForm.tsx` (new file)

**Intent**: Interactive form for updating the user's PAT on the profile page. Validates the token, shows result, and saves.

**Contract**: React component with a PAT input (password toggle), validate button, and status display (same pattern as CreateBoardForm step 1). Calls `POST /api/profile/pat` to save. On success, shows the new login + expiry. Uses `useState` for local form state (not `useFormStatus` — this is a native-POST form pattern per `lessons.md`).

#### 3. Account deletion API endpoint

**File**: `src/pages/api/profile/index.ts` (new file)

**Intent**: `DELETE` endpoint for full account deletion. Deletes all user data and the auth record.

**Contract**: `DELETE` route. Requires authenticated user. Uses `createServiceClient` (service_role) to call `supabase.auth.admin.deleteUser(user.id)`. The FK cascade handles data cleanup: `auth.users` → `boards` (CASCADE) → `github_repos` (CASCADE) → PRs → reviews → comments → classifications. The `github_repos.connected_by` SET NULL (from Phase 2) prevents FK violation. Returns 200 on success. The client-side handler clears cookies and redirects to `/`.

#### 4. Delete account confirmation (React island)

**File**: `src/components/DeleteAccountDialog.tsx` (new file)

**Intent**: Confirmation dialog for account deletion. User must type "DELETE" to confirm.

**Contract**: React component. Renders a button that opens a confirmation form. User types "DELETE" into an input. Submit button is disabled until input matches. Calls `DELETE /api/profile`. On success, redirects to `/`.

#### 5. Supabase admin client for service_role

**File**: `src/lib/supabase-admin.ts`

**Intent**: Verify that the existing `createServiceClient` function works in the Astro API route context (it's currently used in `src/worker.ts`). If it requires Worker-specific env, create a variant that reads from `astro:env/server`.

**Contract**: Check if `createServiceClient` accepts explicit URL + key args (it does per worker.ts usage). In the API route, pass `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` from `astro:env/server`. May require adding `SUPABASE_SERVICE_KEY` to `astro.config.mjs` env schema if not already declared.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx tsc --noEmit` and `npm run test:typecheck`
- Linting passes: `npm run lint`
- Build succeeds: `npm run build`
- Existing tests pass: `npm test`

#### Manual Verification:

- `/profile/settings` renders all sections (identity, avatar, PAT, sign-out, danger zone)
- PAT update form validates token and shows login + expiry on success
- PAT update form handles invalid tokens with error message
- "Delete account" requires typing "DELETE" to confirm
- Account deletion removes the user, all boards, and all associated data
- After deletion, user is redirected to `/` and cannot sign in with the old credentials
- Sign-out button works from the profile page

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 5: PAT Expiry Warning Banner

### Overview

Add a site-wide warning banner that appears on all pages when the user's PAT expires within 7 days, following the established `config-status.ts` → `Layout.astro` pattern.

### Changes Required:

#### 1. Token expiry status module

**File**: `src/lib/token-status.ts` (new file)

**Intent**: Server-side function that checks whether the authenticated user's PAT is expiring soon. Returns warning info for Layout.astro to render.

**Contract**: Export `async function getTokenWarning(supabase, userId): Promise<{ message: string; expiresAt: string } | null>`. Queries `user_profiles.token_expires_at`. Returns a warning object if expiry is within 7 days, `null` otherwise. Returns `null` when `token_expires_at` is null (no expiry set — token doesn't expire).

#### 2. Render token warning in Layout.astro

**File**: `src/layouts/Layout.astro`

**Intent**: Show a `Banner variant="warning"` when the user's PAT is expiring soon. Requires access to the Supabase client and user from the request context.

**Contract**: Import `getTokenWarning` from `@/lib/token-status`. In the frontmatter, check if `Astro.locals.user` exists, create Supabase client, call `getTokenWarning`. If result is non-null, render a `Banner variant="warning"` with the message and a link to `/profile/settings`. Render after the existing `missingConfigs` banners, before `<slot />`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx tsc --noEmit`
- Linting passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- When PAT expires within 7 days, warning banner appears on all pages (dashboard, board, profile)
- Banner links to `/profile/settings` for token update
- When PAT has no expiry (`token_expires_at IS NULL`), no banner appears
- When PAT expires in more than 7 days, no banner appears
- Banner does not appear for unauthenticated users

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 6: PRD Update

### Overview

Amend PRD functional requirements FR-018, FR-020, and FR-022 to reflect per-user PAT semantics. Document `boards.github_pat_encrypted` as deprecated.

### Changes Required:

#### 1. Update PRD

**File**: `context/foundation/prd.md`

**Intent**: Rewrite FR-018/020/022 to replace "Board's GitHub PAT" with "user's GitHub PAT" and note that PAT is now shared across all boards owned by that user.

**Contract**:

- FR-018 (line 98): change "a Board's GitHub connection settings (PAT, linked org)" to "their GitHub connection settings (PAT) via Profile Settings; PAT is shared across all boards they own"
- FR-020 (line 106): change "Board-creation or Board-edit form" to "Profile Settings page or Board-creation flow" and adjust re-validation scope to user-level
- FR-022 (line 114): change "a Board's GitHub PAT" to "the user's GitHub PAT" and "the Board enters a frozen state" to "all boards owned by that user enter a frozen state"
- Add a note below FR-022 documenting the known gap: multi-org users who need different PATs per board are not supported; this is an intentional simplification

#### 2. Document deprecated column

**File**: `context/changes/edit-board-connection/change.md`

**Intent**: Record that `boards.github_pat_encrypted` is deprecated and scheduled for removal in a future contract-phase migration.

**Contract**: Add a note in the Notes section documenting: column is unused after this change, kept for rollback safety per expand/contract convention, drop migration will be a separate change.

### Success Criteria:

#### Automated Verification:

- No automated checks needed — documentation-only changes

#### Manual Verification:

- PRD FR-018/020/022 read correctly with per-user semantics
- Known gap (multi-org) is documented
- `change.md` notes the deprecated column

**Implementation Note**: This phase is documentation-only and does not require pausing for manual testing.

---

## Testing Strategy

### Unit Tests:

- `parseGitHubTokenExpiry`: both date formats, absent header (null), past-date rejection
- `getTokenWarning`: returns warning at 7 days, null at 8 days, null for no-expiry tokens
- Wizard reducer: `USE_STORED_PAT` action sets correct state

### Integration Tests:

- `POST /api/profile/pat`: saves encrypted PAT, returns login + expiry, handles invalid tokens
- `DELETE /api/profile`: full cascade — user, boards, repos, PRs, reviews, comments, classifications all removed
- `POST /api/board` (updated): rejects when no stored PAT, succeeds when PAT exists in user_profiles
- `createGitHubClient` via `get_user_github_pat`: resolves PAT through board → owner → user_profiles join

### Manual Testing Steps:

1. Sign up, link GitHub account, verify avatar appears in BoardTopbar
2. Save a PAT via profile settings, verify expiry is captured
3. Create a board using the stored PAT (step 1 shows stored identity)
4. Create a second board — verify stored PAT is reused without re-entry
5. Update PAT via profile settings — verify new expiry is shown
6. Set a PAT that expires within 7 days — verify warning banner appears
7. Delete account — verify redirect to `/` and all data is gone
8. Verify Worker sync still works after PAT migration

## Performance Considerations

- `getTokenWarning` adds one `user_profiles` query per page load for authenticated users. This is lightweight (PK lookup) and the result could be cached in `Astro.locals` if needed, but likely unnecessary given SSR response times.
- The `get_user_github_pat` RPC adds one join (boards → user_profiles) compared to the current direct lookup. Negligible overhead — both tables are small and indexed on PK/FK.

## Migration Notes

- **Backfill**: the migration copies `github_pat_encrypted` from the most recently created board per user. Users with no boards get no PAT (expected — they have nothing to sync).
- **Expand/contract**: `boards.github_pat_encrypted` column remains in place. All read/write paths are switched to `user_profiles`. The column drop is a separate future migration.
- **Rollback**: if the Worker deploy is rolled back, `boards.github_pat_encrypted` still has data. The old `get_board_github_pat` RPC is replaced but can be re-added. The migration is backward-compatible (additive columns + RPC replacement).

## References

- Frame brief: `context/changes/edit-board-connection/frame.md`
- Research: `context/changes/edit-board-connection/research.md`
- Board settings page pattern: `src/pages/board/[id]/settings.astro`
- Current PAT flow: `src/pages/api/github/validate-pat.ts` → `src/pages/api/board/index.ts` → `create_board_atomic` RPC
- PAT decryption: `src/lib/github.ts:68-95` → `get_board_github_pat` RPC
- Worker: `src/worker.ts:96`
- Layout + banner pattern: `src/layouts/Layout.astro` + `src/lib/config-status.ts`
- Lessons: `context/foundation/lessons.md` (useFormStatus, consola, REVOKE ALL)

## Addenda

### A1 — connected_by dropped instead of loosened (Phase 2 deviation)

Phase 2 planned `ON DELETE SET NULL` + `DROP NOT NULL` on `github_repos.connected_by`. During implementation it was confirmed that no read/write path uses `connected_by` (the column was a legacy artefact), so the migration drops it entirely instead. The intent (unblocking user deletion) is fully satisfied. Re-adding and then loosening the column would be pointless churn.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Avatar Fix in BoardTopbar

#### Automated

- [x] 1.1 Type checking passes — 4cdb8b1
- [x] 1.2 Linting passes — 4cdb8b1
- [x] 1.3 Existing tests pass — 4cdb8b1

#### Manual

- [x] 1.4 Board pages show GitHub avatar instead of letter — 4cdb8b1
- [x] 1.5 Letter fallback works when avatar_url is null — 4cdb8b1

### Phase 2: Data Model Expansion

#### Automated

- [x] 2.1 Migration applies cleanly — 63260c5
- [x] 2.2 Type checking passes — 63260c5
- [x] 2.3 Existing tests pass — 63260c5
- [x] 2.4 Integration tests pass — 63260c5

#### Manual

- [x] 2.5 user_profiles has new columns in Supabase Studio — 63260c5
- [x] 2.6 Backfilled PATs present for users with boards — 63260c5
- [x] 2.7 connected_by is nullable — 63260c5
- [x] 2.8 Unauthenticated /profile/settings redirects to sign-in — 63260c5

### Phase 3: PAT Capture & Board Creation Flow

#### Automated

- [x] 3.1 New migration applies cleanly — b80f2eb
- [x] 3.2 Type checking passes (src and tests) — b80f2eb
- [x] 3.3 Linting passes — b80f2eb
- [x] 3.4 Existing tests pass — b80f2eb
- [x] 3.5 Build succeeds — b80f2eb

#### Manual

- [x] 3.6 Board creation without stored PAT shows error — b80f2eb
- [x] 3.7 Board creation with stored PAT shows identity in step 1 — b80f2eb
- [x] 3.8 "Use a different token" flow validates and saves — b80f2eb
- [x] 3.9 POST /api/profile/pat stores encrypted token + expiry — b80f2eb
- [x] 3.10 validate-pat response includes expiresAt — b80f2eb
- [x] 3.11 Worker sync works with user-level PAT — b80f2eb
- [x] 3.12 No-expiry tokens return expiresAt: null — b80f2eb

### Phase 4: Profile/Settings Page

#### Automated

- [x] 4.1 Type checking passes (src and tests) — f40e013
- [x] 4.2 Linting passes — f40e013
- [x] 4.3 Build succeeds — f40e013
- [x] 4.4 Existing tests pass — f40e013
- [x] 4.4a UX follow-ups from manual review: visible back-to-dashboard link, PAT-owner-login bug fix (`github_pat_login` migration), expiry visibility badge, classic-PAT scopes hint on profile page, password-change feature (endpoint + form) — f40e013

#### Manual

- [x] 4.5 Profile page renders all sections — f40e013
- [x] 4.6 PAT update validates and shows login + expiry — f40e013
- [x] 4.7 PAT update handles invalid tokens — f40e013
- [x] 4.8 Delete account requires typing DELETE — f40e013
- [x] 4.9 Account deletion removes user + all data — f40e013
- [x] 4.10 After deletion, redirected to / and can't sign in — f40e013
- [x] 4.11 Sign-out works from profile page — f40e013

### Phase 5: PAT Expiry Warning Banner

#### Automated

- [x] 5.1 Type checking passes — 1d570f9
- [x] 5.2 Linting passes — 1d570f9
- [x] 5.3 Build succeeds — 1d570f9

#### Manual

- [x] 5.4 Warning banner appears when PAT expires within 7 days — 1d570f9
- [x] 5.5 Banner links to /profile/settings — 1d570f9
- [x] 5.6 No banner for no-expiry tokens — 1d570f9
- [x] 5.7 No banner when expiry > 7 days — 1d570f9
- [x] 5.8 No banner for unauthenticated users — 1d570f9

### Phase 6: PRD Update

#### Manual

- [x] 6.1 FR-018/020/022 reflect per-user PAT semantics — deaa7f9
- [x] 6.2 Multi-org known gap is documented — deaa7f9
- [x] 6.3 change.md notes deprecated column — deaa7f9
