# Delete Board — Plan Brief

> Full plan: `context/changes/delete-board/plan.md`
> Frame brief: `context/changes/delete-board/frame.md`

## What & Why

The board lifecycle is missing a delete operation — once created, a board is permanent. The DB already supports cascade deletion with an owner-only RLS policy, but the API endpoint and the owner-gated UI do not yet exist.

## Starting Point

The database layer is complete: `ON DELETE CASCADE` chains cover the entire board data tree, and an RLS `boards_delete` policy restricts deletion to `owner_user_id = auth.uid()`. No API route or UI for deletion exists. The settings page (`src/pages/board/[id]/settings.astro`) renders for all board members without role-based conditional sections. `DeleteAccountDialog.tsx` provides the established destructive-action UI pattern.

## Desired End State

Board owners see a "Danger zone" card at the bottom of board settings with a "Delete board" button. Clicking it expands an inline confirmation requiring the board name to be typed. On confirmation, the board and all associated data are permanently deleted, and the user is redirected to `/dashboard`. Contributors never see this section.

## Key Decisions Made

| Decision               | Choice                        | Why (1 sentence)                                                                         | Source |
| ---------------------- | ----------------------------- | ---------------------------------------------------------------------------------------- | ------ |
| Confirmation input     | Type board name               | Stronger confirmation — proves user knows which board they're deleting (GitHub pattern). | Plan   |
| Danger zone visibility | Hidden for non-owners         | Contributors shouldn't see actions they can't take.                                      | Plan   |
| Danger zone placement  | Bottom of settings page       | Follows GitHub convention; destructive actions at the bottom are expected.               | Plan   |
| Authorization approach | RLS only (no app-level check) | `boards_delete` policy already exists — duplicating in the API is unnecessary.           | Frame  |
| Post-delete redirect   | `/dashboard`                  | Natural landing page; matches `DeleteAccountDialog` redirect pattern.                    | Frame  |

## Scope

**In scope:**

- `DELETE /api/board/[boardId]` endpoint
- `DeleteBoardDialog` React component (board-name confirmation)
- Settings page integration with owner-only guard

**Out of scope:**

- DB migration (cascade + RLS already exist)
- Soft-delete / archive
- Bulk delete
- Contributor notification
- Broader read-only enforcement for contributors on settings

## Architecture / Approach

Three-file change following existing patterns. The API route mirrors `DELETE /api/profile` but uses the user's Supabase client (RLS handles auth). The React component mirrors `DeleteAccountDialog` with board-name confirmation instead of static "DELETE". The settings page conditionally renders a danger zone card when `board.role === "supervisor"`.

## Phases at a Glance

| Phase                            | What it delivers              | Key risk                                        |
| -------------------------------- | ----------------------------- | ----------------------------------------------- |
| 1. API + Component + Integration | Complete delete-board feature | None significant — all patterns are established |

**Prerequisites:** None — DB layer is already in place.
**Estimated effort:** ~1 session, single phase.

## Open Risks & Assumptions

- Assumes no other features depend on a board existing after the owner intends to delete it (no "are you sure?" beyond the confirmation dialog).
- Cascade delete performance is assumed fast — no boards with extreme data volumes exist yet.

## Success Criteria (Summary)

- Board owner can delete a board from settings and is redirected to dashboard
- All associated data (repos, contributors, PRs, reviews, classifications) is cascade-deleted
- Non-owner members never see the delete option
