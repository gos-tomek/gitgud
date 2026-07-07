# Board Settings Management Implementation Plan

## Overview

Transform the board settings page from a read-only display into an editable management interface. Add API routes and React island UI for renaming boards, adding/removing repositories, and managing the contributor roster — reusing the board creation wizard's UX patterns for name validation and contributor selection.

## Current State Analysis

The settings page (`src/pages/board/[id]/settings.astro`) is purely server-rendered with zero interactivity. It displays linked repos and contributors as read-only lists. No mutation API routes exist — the entire `/api/board/` surface is read-only (impact data, sync status, threads) plus the board creation endpoint (`POST /api/board`). The service layer (`src/lib/services/boards.ts`) has only 5 read functions.

The database layer is ready: RLS policies on `boards`, `github_repos`, and `board_contributors` already gate INSERT/UPDATE/DELETE on `is_board_owner(board_id)`. The one gap is that the `expand` change (pending merge) will revoke DELETE on `board_contributors` — this plan includes a migration to re-grant it.

### Key Discoveries:

- RLS policies are fully in place for all needed operations — no new policies required (`src/pages/board/[id]/settings.astro` already checks ownership via `getBoardWithRole`)
- Cascade chain: `github_repos` → `github_pull_requests` → `github_reviews` + `github_review_comments` → `thread_classifications` — repo removal is destructive and irreversible
- Contributor removal is soft: `board_contributors` is a leaf table, no FKs point to it. Historical PR/review data persists; re-adding the same `github_id` restores access
- `impact-metrics.ts:681` builds contributor identity from `board_contributors` — a removed contributor's avatar/login disappears from aggregate views
- The wizard's contributor fetch uses `POST /api/github/collaborators` with `{ repos: [{ owner, name }] }` — directly reusable
- Board name uniqueness is per-owner, case-insensitive (`ilike`) — `check-name.ts` implements this but doesn't support excluding a board ID for rename
- shadcn `dialog` and `alert-dialog` components are not installed — both are needed for the add-contributor modal and repo removal confirmation
- The `expand` change's migration `20260707120000_contract_drop_board_pat.sql` revokes `board_contributors` grants to SELECT+INSERT only, with an explicit note: "UPDATE/DELETE will be re-granted when contributor management ships"

## Desired End State

Board owners can manage their boards post-creation from the settings page:

- **Rename** the board with real-time debounced uniqueness validation (same UX as the creation wizard)
- **Add repos** by owner/name with validation against GitHub API
- **Remove repos** with a type-to-confirm destructive dialog explaining the CASCADE deletion
- **Add contributors** using the same searchable collaborator list from the wizard (fetched from linked repos)
- **Remove contributors** with a simple confirmation, including messaging that the action is reversible

The settings page remains server-rendered for initial data, with three React islands (`client:load`) handling the interactive edit sections. All mutations go through new API routes protected by existing RLS policies.

## What We're NOT Doing

- Bulk import/export of repos or contributors
- Contributor role management (supervisor vs contributor distinction in UI)
- Board deletion from the settings page (separate feature)
- Editing repo metadata (e.g., renaming a tracked repo)
- Re-syncing GitHub data after adding a repo (sync is a separate concern handled by the existing sync pipeline)
- UPDATE operations on `board_contributors` (add/remove via INSERT/DELETE is sufficient per the frame)

## Implementation Approach

Bottom-up: migration → service layer → API routes → UI. Each layer is independently testable. The settings page gets three React islands — one per management section (name, repos, contributors) — each with its own inline edit state. The contributor addition UI reuses the wizard's collaborator fetch and toggle-selection pattern.

## Phase 1: Foundation — Migration, Dependencies, Service Layer

### Overview

Establish the database grants, install missing shadcn components, and add mutation functions to the service layer. This phase has no user-visible changes but unblocks all subsequent phases.

### Changes Required:

#### 1. Migration — Re-grant DELETE on board_contributors

**File**: `supabase/migrations/<timestamp>_regrant_board_contributors_delete.sql`

**Intent**: Re-grant DELETE on `board_contributors` to `authenticated`, as committed in the `expand` plan. This migration must be sequenced after `20260707120000_contract_drop_board_pat.sql` (from the `expand` change) which revokes to SELECT+INSERT only.

**Contract**: `GRANT DELETE ON public.board_contributors TO authenticated;` — additive grant only, no REVOKE. The `expand` migration sets the baseline (SELECT+INSERT); this adds DELETE back.

#### 2. Install shadcn dialog and alert-dialog

**File**: `src/components/ui/dialog.tsx` (new), `src/components/ui/alert-dialog.tsx` (new)

**Intent**: Add the shadcn `dialog` and `alert-dialog` primitives needed for the contributor addition modal and the repo removal confirmation dialog.

**Contract**: `npx shadcn@latest add dialog alert-dialog` — installs to `src/components/ui/` per `components.json` config.

#### 3. Extend check-name endpoint to support rename

**File**: `src/pages/api/board/check-name.ts`

**Intent**: Allow the existing name uniqueness check to exclude a specific board ID, so renaming a board to its current name doesn't trigger a false duplicate.

**Contract**: Extend the zod schema to accept an optional `boardId: z.string().uuid().optional()`. When present, add `.neq("id", parsed.data.boardId)` to the query. The existing behavior (no `boardId` → check all user boards) is preserved for the creation wizard.

#### 4. Service layer mutation functions

**File**: `src/lib/services/boards.ts`

**Intent**: Add mutation functions for board rename, repo add/remove, and contributor add/remove. All functions take a `SupabaseClient` (which carries the user's auth context for RLS) and return the mutated data or throw on error — matching the existing read function pattern.

**Contract**: Five new exports:

- `renameBoard(supabase, boardId, name)` → `Promise<void>` — `.update({ name }).eq("id", boardId)`
- `addBoardRepo(supabase, boardId, repoOwner, repoName)` → `Promise<{ id: string }>` — `.insert({ board_id, repo_owner, repo_name }).select("id").single()`
- `removeBoardRepo(supabase, boardId, repoOwner, repoName)` → `Promise<void>` — `.delete().match({ board_id, repo_owner, repo_name })`
- `addBoardContributors(supabase, boardId, contributors[])` → `Promise<void>` — `.upsert([...], { onConflict: "board_id,github_id", ignoreDuplicates: true })`
- `removeBoardContributor(supabase, boardId, githubId)` → `Promise<void>` — `.delete().match({ board_id, github_id })`

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly against local Supabase: `npx supabase db reset`
- Type checking passes: `npx tsc --noEmit`
- Lint passes: `npm run lint`
- Existing tests pass: `npm test`

#### Manual Verification:

- Confirm `board_contributors` grants include DELETE after migration: query `information_schema.role_table_grants`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: API Routes

### Overview

Add five mutation endpoints under `/api/board/[boardId]/` for board rename, repo add/remove, and contributor add/remove. All endpoints follow the existing pattern: `json()` helper, Supabase client from request, auth guard, zod validation, service layer call.

### Changes Required:

#### 1. Board rename endpoint

**File**: `src/pages/api/board/[boardId]/settings.ts` (new)

**Intent**: PATCH endpoint for renaming a board. Validates the new name with zod, checks uniqueness (excluding current board), calls `renameBoard`.

**Contract**: Export `PATCH` as `APIRoute`. Zod schema: `{ name: z.string().trim().min(1).max(80) }`. On unique violation (Supabase error code `23505`), return 409. On success, return 204.

#### 2. Repo management endpoint

**File**: `src/pages/api/board/[boardId]/repos.ts` (new)

**Intent**: POST to add a repo, DELETE to remove a repo. POST validates the repo exists on GitHub (reusing the `/api/github/validate-repo` pattern). DELETE triggers CASCADE deletion of all downstream data.

**Contract**: Export `POST` and `DELETE` as `APIRoute`.

- POST schema: `{ owner: z.string().min(1), name: z.string().min(1) }`. Calls `addBoardRepo`. On unique violation (`23505`), return 409. On success, return 201 with `{ id }`.
- DELETE schema: `{ owner: z.string().min(1), name: z.string().min(1) }`. Calls `removeBoardRepo`. On success, return 204.

Both validate `boardId` from `context.params` and verify ownership via the service layer call (RLS enforces `is_board_owner`).

#### 3. Contributor management endpoint

**File**: `src/pages/api/board/[boardId]/contributors.ts` (new)

**Intent**: POST to add contributors (batch, matching wizard pattern), DELETE to remove a single contributor.

**Contract**: Export `POST` and `DELETE` as `APIRoute`.

- POST schema: `{ contributors: z.array(contributorSchema).min(1).max(200) }` where `contributorSchema` matches the creation endpoint's (`{ githubId, githubLogin, avatarUrl? }`). Calls `addBoardContributors`. On success, return 201.
- DELETE schema: `{ githubId: z.number().int().positive() }`. Calls `removeBoardContributor`. On success, return 204.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx tsc --noEmit`
- Lint passes: `npm run lint`
- Existing tests pass: `npm test`

#### Manual Verification:

- Test each endpoint with `curl` or similar against local dev server with a valid auth cookie
- Verify RLS enforcement: non-owner requests return 0 rows affected (effectively 404)
- Verify repo DELETE cascades: check that `github_pull_requests`, `github_reviews`, `github_review_comments` rows are deleted

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Settings Page UI

### Overview

Transform the settings page from read-only to editable by adding three React island components — one for board name editing, one for repo management, and one for contributor management. Each section uses inline editing with Edit/Save/Cancel controls. The contributor addition UI reuses the wizard's collaborator fetch and toggle-selection pattern. Repo removal uses a type-to-confirm destructive dialog.

### Changes Required:

#### 1. Board name editor component

**File**: `src/components/BoardNameEditor.tsx` (new)

**Intent**: Inline edit component for the board name. Shows current name with an Edit button. On edit, reveals an input with real-time debounced uniqueness check (reusing `POST /api/board/check-name` with `boardId` to exclude self), Save, and Cancel. On save, calls `PATCH /api/board/[boardId]/settings`.

**Contract**: Props: `{ boardId: string, currentName: string }`. Uses `useState` for edit mode, input value, checking/error state. Debounced fetch to `check-name` on input change (500ms). Save button calls PATCH endpoint. On success, updates displayed name and exits edit mode.

#### 2. Repo manager component

**File**: `src/components/RepoManager.tsx` (new)

**Intent**: Lists linked repos with a remove button per repo and an add-repo form. Remove shows a type-to-confirm AlertDialog explaining the CASCADE deletion. Add uses the manual entry pattern from the wizard (owner/name input, validates via `POST /api/github/validate-repo`).

**Contract**: Props: `{ boardId: string, initialRepos: { repoOwner: string, repoName: string }[] }`. Local state manages the repo list, add-form visibility, and confirmation dialog. Remove calls `DELETE /api/board/[boardId]/repos`. Add calls `POST /api/board/[boardId]/repos`. The confirmation dialog requires the user to type `owner/name` to enable the confirm button.

#### 3. Contributor manager component

**File**: `src/components/ContributorManager.tsx` (new)

**Intent**: Lists contributors with a remove button per contributor and an add-contributor dialog. Add opens a Dialog that fetches collaborators from the board's linked repos (reusing `POST /api/github/collaborators`), shows a searchable/filterable list with checkbox toggle selection (same UX as wizard step 3), and a Save button that calls `POST /api/board/[boardId]/contributors`. Remove shows a simple confirmation explaining the action is reversible.

**Contract**: Props: `{ boardId: string, initialContributors: BoardContributor[], repos: { repoOwner: string, repoName: string }[] }`. The add dialog fetches collaborators, filters out already-added contributors, and allows toggle selection. Save posts the selected contributors in batch. Remove calls `DELETE /api/board/[boardId]/contributors`.

#### 4. Update settings page to mount React islands

**File**: `src/pages/board/[id]/settings.astro`

**Intent**: Replace the read-only repo and contributor lists with the new React island components, and add the board name editor. Gate edit controls on `board.role === "supervisor"` — contributors see read-only view.

**Contract**: Import and mount `BoardNameEditor`, `RepoManager`, and `ContributorManager` with `client:load`. Pass server-fetched data as props. Wrap each in a card section matching the existing layout (`border-border bg-card rounded-lg border px-4 py-3`). Keep the read-only rendering for non-supervisor roles.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx tsc --noEmit` and `npm run test:typecheck`
- Lint passes: `npm run lint`
- Build succeeds: `npm run build`
- Existing tests pass: `npm test`

#### Manual Verification:

- Board rename: edit name, see debounced uniqueness check, save, verify page title updates
- Repo add: add a valid repo by owner/name, verify it appears in the list
- Repo remove: click remove, see type-to-confirm dialog with CASCADE warning, confirm, verify repo and its data are gone
- Contributor add: open dialog, see collaborator list from linked repos, select and save, verify they appear in the list
- Contributor remove: click remove, see reversibility message, confirm, verify contributor is removed
- Non-owner view: verify edit controls are hidden for contributor role
- Empty states: verify correct messaging when no repos or contributors exist

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Testing

### Overview

Add integration tests for all mutation API routes (real Supabase, RLS enforcement, CASCADE behavior) and hermetic tests for the UI components. Integration tests cover the data layer correctness; hermetic tests cover the UI interaction logic.

### Changes Required:

#### 1. Integration tests for board settings API

**File**: `tests/integration/board-settings.test.ts` (new)

**Intent**: Test all five mutation endpoints against a real local Supabase instance. Cover happy paths, RLS enforcement (non-owner denied), validation errors, unique constraint violations, and CASCADE behavior for repo removal.

**Contract**: Use the existing test helpers (`createTestUser`, `adminClient`, `cleanupBoard`, `cleanupUser`). Test cases:

- PATCH rename: success, duplicate name (409), empty name (400), non-owner (RLS denial)
- POST add repo: success (201), duplicate repo (409), non-owner (RLS denial)
- DELETE remove repo: success (204), verify CASCADE deletes downstream data, non-owner (RLS denial)
- POST add contributors: success (201), duplicate contributor (idempotent via upsert), non-owner (RLS denial)
- DELETE remove contributor: success (204), re-add restores access, non-owner (RLS denial)

#### 2. Hermetic tests for settings UI components

**File**: `tests/hermetic/board-settings.test.ts` (new)

**Intent**: Test the three React island components with mocked API calls. Cover edit mode toggling, form validation, API call arguments, optimistic updates, error state rendering, and the type-to-confirm dialog flow.

**Contract**: Mock `fetch` globally. Test cases:

- BoardNameEditor: edit mode toggle, debounced check-name calls, save success/error, cancel resets
- RepoManager: add repo form submission, remove with type-to-confirm (dialog open, input matching, confirm enabled/disabled), API error handling
- ContributorManager: add dialog open, collaborator list rendering, filter, toggle selection, save batch, remove with confirmation

### Success Criteria:

#### Automated Verification:

- All new tests pass: `npm test`
- Integration tests pass with local Supabase: `npx vitest run tests/integration/board-settings.test.ts`
- Test type checking passes: `npm run test:typecheck`
- No regressions in existing tests

#### Manual Verification:

- Review test coverage: ensure all API routes and UI interaction paths are covered
- Verify RLS denial tests actually test denial (not just absence of data)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Integration Tests:

- Board rename with uniqueness enforcement
- Repo add/remove with CASCADE verification (count downstream rows before/after)
- Contributor add/remove with re-add restoring access
- RLS enforcement: two-client pattern (owner + non-owner) per operation
- Error code handling: 23505 (unique violation), 401 (unauth), 400 (validation)

### Hermetic Tests:

- Component render with initial data
- Edit mode state transitions
- API call verification (correct endpoint, method, body)
- Error state rendering
- Type-to-confirm dialog interaction
- Filter and search behavior in contributor addition

### Manual Testing Steps:

1. Create a board with repos and contributors via the wizard
2. Navigate to settings, rename the board — verify name updates across the app (topbar, dashboard)
3. Add a new repo — verify it appears in the settings list
4. Remove a repo — confirm via type-to-confirm, verify all PRs/reviews/comments for that repo are deleted
5. Add a contributor from the collaborator list — verify they appear in settings and impact pages
6. Remove a contributor — verify they disappear from the settings list but their historical data is still in the DB (verify via admin query)
7. Re-add the removed contributor — verify their impact data is accessible again
8. Test as a non-owner (contributor role) — verify all edit controls are hidden

## Performance Considerations

- Contributor collaborator fetch (`/api/github/collaborators`) can be slow for repos with many collaborators — the wizard already handles this with a loading state; reuse the same pattern
- Repo removal CASCADE can be slow for repos with many PRs — the DELETE endpoint should not time out for typical boards (< 1000 PRs per repo)

## Migration Notes

- The migration to re-grant DELETE on `board_contributors` must land AFTER the `expand` change's `20260707120000_contract_drop_board_pat.sql`. Timestamp the new migration accordingly (e.g., `20260708XXXXXX`).
- The migration is purely additive (GRANT, not REVOKE+GRANT) — if the `expand` migration hasn't landed yet, the existing grants already include DELETE, so the GRANT is a no-op. Safe to apply in either order.

## References

- Frame brief: `context/changes/manage-ic-roster/frame.md`
- Settings page: `src/pages/board/[id]/settings.astro`
- Board creation wizard: `src/components/CreateBoardForm.tsx`, `src/components/wizard-reducer.ts`
- Board API: `src/pages/api/board/index.ts` (POST), `src/pages/api/board/check-name.ts`
- Service layer: `src/lib/services/boards.ts`
- Types: `src/types.ts` (Board, GitHubRepo, BoardContributor)
- Migrations: `20260529120000_access_control_and_membership.sql`, `20260531100000_github_ingestion_access.sql`, `20260602120000_board_contributors.sql`
- Expand change dependency: `GitGud/supabase/migrations/20260707120000_contract_drop_board_pat.sql`
- Profile settings page (React island pattern): `src/pages/profile/settings.astro`
- Test helpers: `tests/helpers/supabase.ts`, `tests/helpers/setup.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Foundation — Migration, Dependencies, Service Layer

#### Automated

- [x] 1.1 Migration applies cleanly: `npx supabase db reset` — 0f6e315
- [x] 1.2 Type checking passes: `npx tsc --noEmit` — 0f6e315
- [x] 1.3 Lint passes: `npm run lint` — 0f6e315
- [x] 1.4 Existing tests pass: `npm test` — 0f6e315

#### Manual

- [x] 1.5 Confirm board_contributors grants include DELETE after migration — 0f6e315

### Phase 2: API Routes

#### Automated

- [x] 2.1 Type checking passes: `npx tsc --noEmit`
- [x] 2.2 Lint passes: `npm run lint`
- [x] 2.3 Existing tests pass: `npm test`

#### Manual

- [x] 2.4 Test each endpoint with curl against local dev server
- [x] 2.5 Verify RLS enforcement: non-owner requests denied
- [x] 2.6 Verify repo DELETE cascades downstream data

### Phase 3: Settings Page UI

#### Automated

- [ ] 3.1 Type checking passes: `npx tsc --noEmit` and `npm run test:typecheck`
- [ ] 3.2 Lint passes: `npm run lint`
- [ ] 3.3 Build succeeds: `npm run build`
- [ ] 3.4 Existing tests pass: `npm test`

#### Manual

- [ ] 3.5 Board rename with debounced uniqueness check
- [ ] 3.6 Repo add and remove with type-to-confirm CASCADE dialog
- [ ] 3.7 Contributor add via collaborator list and remove with reversibility message
- [ ] 3.8 Non-owner view: edit controls hidden
- [ ] 3.9 Empty states display correctly

### Phase 4: Testing

#### Automated

- [ ] 4.1 All new tests pass: `npm test`
- [ ] 4.2 Integration tests pass: `npx vitest run tests/integration/board-settings.test.ts`
- [ ] 4.3 Test type checking passes: `npm run test:typecheck`
- [ ] 4.4 No regressions in existing tests

#### Manual

- [ ] 4.5 Review test coverage for API routes and UI paths
- [ ] 4.6 Verify RLS denial tests assert actual denial
