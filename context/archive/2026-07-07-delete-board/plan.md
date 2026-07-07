# Delete Board Implementation Plan

## Overview

Add a "Delete board" capability to the board settings page. The database already supports cascade deletion with an owner-only RLS policy — the work is purely API + UI: a `DELETE /api/board/[boardId]` endpoint and an owner-gated confirmation component on the settings page.

## Current State Analysis

- **DB cascade**: `boards → board_members`, `board_contributors`, `github_repos → github_pull_requests → github_reviews`, `github_review_comments → thread_classifications` — all `ON DELETE CASCADE`. Deleting the `boards` row removes the entire tree.
- **RLS**: `boards_delete` policy exists (`USING (owner_user_id = auth.uid())`), so only the owner can delete via the Supabase client.
- **API**: No DELETE route exists under `/api/board/[boardId]/`. The `[boardId]` folder structure is in place (contains `last-synced.ts`, `threads/`, `impact/`).
- **UI**: `settings.astro` has `board.role` available (`"supervisor"` = owner) but doesn't use it for conditional rendering. `DeleteAccountDialog.tsx` is the established destructive-action pattern.

### Key Discoveries:

- `DeleteAccountDialog.tsx` (`src/components/DeleteAccountDialog.tsx`) — inline expand, type-to-confirm, fetch DELETE, redirect. Direct model for the new component.
- `src/pages/api/profile/index.ts:14` — existing DELETE route pattern: auth check → Supabase call → JSON response.
- `src/pages/api/board/index.ts` — board API uses a local `json()` helper and `createClient` for auth.
- `board.role === "supervisor"` is the owner check (`src/lib/services/boards.ts:22`).

## Desired End State

Board owners can delete their boards from the settings page. A "Danger zone" card at the bottom of the page contains a "Delete board" button that expands into a confirmation flow requiring the user to type the board name. On successful deletion, the user is redirected to `/dashboard`. Non-owner members do not see the danger zone section.

To verify: as a board owner, navigate to board settings, click "Delete board", type the board name, confirm, and verify redirect to dashboard + board no longer listed.

## What We're NOT Doing

- No DB migration — cascade and RLS already exist.
- No soft-delete / archive — this is a permanent, hard delete.
- No bulk delete — one board at a time.
- No contributor notification — silent deletion.
- No changes to contributor visibility on settings page beyond hiding the danger zone (broader read-only enforcement for contributors is a separate concern).

## Implementation Approach

Three files, one phase. Follow the existing `DeleteAccountDialog` pattern exactly, adapted for board-specific confirmation (type the board name instead of "DELETE"). The API route mirrors the `DELETE /api/profile` pattern but uses the user's Supabase client (RLS handles authorization) instead of the admin client.

## Phase 1: API Route + Delete Component + Settings Integration

### Overview

Deliver all three pieces together — they're tightly coupled and only testable as a unit.

### Changes Required:

#### 1. DELETE API Route

**File**: `src/pages/api/board/[boardId]/index.ts` (new file)

**Intent**: Create a DELETE endpoint that deletes the board row. RLS enforces that only the owner can delete — no application-level authorization check needed beyond authenticating the user.

**Contract**: Export `DELETE: APIRoute`. Extract `boardId` from `context.params`. Authenticate via `createClient` + `getUser()`. Call `supabase.from("boards").delete().eq("id", boardId)`. Return `{ ok: true }` on success, appropriate error JSON on failure. Use the same `json()` helper pattern as `src/pages/api/board/index.ts`.

#### 2. Delete Board Component

**File**: `src/components/DeleteBoardDialog.tsx` (new file)

**Intent**: An inline-expand confirmation component modelled on `DeleteAccountDialog.tsx`. The user types the board name (not "DELETE") to confirm. On success, redirect to `/dashboard`.

**Contract**: `DeleteBoardDialog({ boardId, boardName }: { boardId: string; boardName: string })`. Same state machine as `DeleteAccountDialog`: `open` toggle → confirm input (match against `boardName`, case-sensitive) → fetch `DELETE /api/board/${boardId}` → `window.location.href = "/dashboard"` on success. Same error display pattern. Same Tailwind classes for the destructive styling. Use `useState` for local form state (not `useFormStatus` — this is a fetch-based action, not a Server Action form).

#### 3. Settings Page Integration

**File**: `src/pages/board/[id]/settings.astro` (existing)

**Intent**: Add a "Danger zone" card at the bottom of the settings page, rendered only when `board.role === "supervisor"`. Contains the `DeleteBoardDialog` React island.

**Contract**: After the Contributors card, conditionally render a new card when `board.role === "supervisor"`. The card has the "Danger zone" header styling and contains `<DeleteBoardDialog client:load boardId={board.id} boardName={board.name} />`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx tsc --noEmit` (src) and `npm run test:typecheck` (tests)
- Linting passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- As board owner: navigate to settings → see danger zone → click "Delete board" → type board name → confirm → redirected to `/dashboard` → board no longer listed
- As board owner: type wrong name → delete button stays disabled
- As board owner: click cancel → dialog collapses, no side effects
- As contributor: navigate to settings → danger zone is not visible
- After deletion: direct navigation to `/board/<deleted-id>/settings` redirects to `/dashboard` (existing null-board guard handles this)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- No unit tests needed — the API route is a thin Supabase wrapper, and the component follows an established pattern. RLS authorization is already tested in the existing migration test suite.

### Integration Tests:

- Board owner can delete their board (DELETE returns 200, board no longer queryable)
- Non-owner gets RLS denial (DELETE returns error / empty result)
- Deleting a non-existent board returns appropriate error

### Manual Testing Steps:

1. Create a board with repos and contributors
2. As owner, go to settings, verify danger zone is visible
3. Click "Delete board", verify expand with board-name prompt
4. Type wrong name, verify button stays disabled
5. Type correct name, confirm deletion
6. Verify redirect to `/dashboard`
7. Verify board is gone from dashboard list
8. As a different user who was a contributor, verify the board is gone from their dashboard too
9. Log in as a contributor on a different board, verify no danger zone on that board's settings

## Performance Considerations

None — single row delete with cascade is fast even for boards with substantial data. The cascade is handled by Postgres internally.

## References

- Frame brief: `context/changes/delete-board/frame.md`
- Existing UI pattern: `src/components/DeleteAccountDialog.tsx`
- Existing DELETE API pattern: `src/pages/api/profile/index.ts`
- Board API routes: `src/pages/api/board/`
- Settings page: `src/pages/board/[id]/settings.astro`
- Board service (role mapping): `src/lib/services/boards.ts:14-24`
- RLS DELETE policy: `supabase/migrations/20260529120000_access_control_and_membership.sql:81`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: API Route + Delete Component + Settings Integration

#### Automated

- [x] 1.1 Type checking passes (src + tests) — 9661aac
- [x] 1.2 Linting passes — 9661aac
- [x] 1.3 Build succeeds — 9661aac

#### Manual

- [x] 1.4 Owner can delete board via settings page and is redirected to dashboard
- [x] 1.5 Wrong board name keeps delete button disabled
- [x] 1.6 Cancel collapses dialog without side effects
- [x] 1.7 Contributors do not see danger zone
- [x] 1.8 Deleted board is no longer accessible
