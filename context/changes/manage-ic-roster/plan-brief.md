# Board Settings Management — Plan Brief

> Full plan: `context/changes/manage-ic-roster/plan.md`
> Frame brief: `context/changes/manage-ic-roster/frame.md`

## What & Why

The settings page is read-only — after board creation, there is no way to edit the board name, add/remove repositories, or manage the contributor roster. Boards evolve over time (people join/leave teams, repos get added/archived) but the only path today is to delete and recreate the board.

## Starting Point

The database layer is already ready: RLS policies on `boards`, `github_repos`, and `board_contributors` gate all CRUD operations on `is_board_owner(board_id)`. The gap is entirely in the API layer (no mutation routes) and UI layer (no forms/controls). The board creation wizard has reusable patterns for contributor selection and name validation.

## Desired End State

Board owners can manage their boards from the settings page: rename the board with real-time uniqueness validation, add/remove repos (with a type-to-confirm destructive dialog for removal explaining the CASCADE deletion), and manage contributors using the same searchable collaborator list from the creation wizard. Contributors see the existing read-only view.

## Key Decisions Made

| Decision                       | Choice                                             | Why (1 sentence)                                                                                      | Source |
| ------------------------------ | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------ |
| Settings UX pattern            | Inline edit sections per area                      | Familiar pattern, low cognitive load — user edits one thing at a time without leaving the page        | Plan   |
| Repo removal confirmation      | Type-to-confirm with repo name                     | Prevents accidental deletion — CASCADE destroys all PRs/reviews/comments/classifications irreversibly | Plan   |
| Contributor addition method    | Wizard-style GitHub fetch                          | Same searchable collaborator list from board creation, fetching from linked repos — consistent UX     | Plan   |
| Name validation timing         | Real-time debounced check (like wizard)            | Matches existing creation flow — instant feedback on duplicate names                                  | Plan   |
| Cascade behavior communication | Explicit in UI per action type                     | Repo removal is destructive (CASCADE); contributor removal is reversible (re-add restores access)     | Frame  |
| board_contributors grants      | Re-grant DELETE only                               | The `expand` change revokes to SELECT+INSERT; this change adds DELETE back as committed in that plan  | Frame  |
| Testing approach               | Integration (real Supabase) + hermetic (mocked UI) | APIs need real DB coverage for RLS/CASCADE correctness; UI tests run fast without Supabase            | Plan   |

## Scope

**In scope:**

- Board rename with uniqueness check
- Repo add (validated against GitHub) and remove (with CASCADE confirmation)
- Contributor add (from repo collaborators) and remove (with reversibility messaging)
- Migration to re-grant DELETE on `board_contributors`
- Integration + hermetic tests

**Out of scope:**

- Board deletion
- Bulk import/export
- Contributor role management
- Re-sync after adding a repo
- UPDATE operations on contributors (add/remove only)

## Architecture / Approach

Bottom-up: migration → service layer → API routes → UI. Three new API route files under `/api/board/[boardId]/` (settings, repos, contributors) call new service functions in `boards.ts`. The settings page mounts three React islands (`client:load`) — `BoardNameEditor`, `RepoManager`, `ContributorManager` — each managing its own inline edit state. Edit controls are gated on supervisor role.

## Phases at a Glance

| Phase               | What it delivers                                                                       | Key risk                                          |
| ------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------- |
| 1. Foundation       | Migration, shadcn dialog/alert-dialog, service layer mutations                         | Migration sequencing with `expand` change         |
| 2. API Routes       | PATCH rename, POST/DELETE repos, POST/DELETE contributors                              | RLS enforcement correctness on all five endpoints |
| 3. Settings Page UI | Three React islands with inline editing, type-to-confirm, wizard-style contributor add | UI complexity of the contributor addition dialog  |
| 4. Testing          | Integration tests (RLS, CASCADE) + hermetic tests (UI interactions)                    | Integration test setup requires local Supabase    |

**Prerequisites:** The `expand` change must merge first (or its contract migration must be applied locally) so the re-grant migration sequences correctly.
**Estimated effort:** ~3-4 sessions across 4 phases.

## Open Risks & Assumptions

- The `expand` change's migration must land before or concurrently with this change's migration — if it hasn't merged, the re-grant is a no-op (safe either way)
- Contributor collaborator fetch can be slow for repos with many collaborators — reusing the wizard's loading state pattern mitigates UX impact
- `impact-metrics.ts:681` uses `board_contributors` for avatar/login lookup — removing a contributor makes their identity disappear from aggregate views until re-added

## Success Criteria (Summary)

- Board owners can rename, add/remove repos, and manage contributors from the settings page
- Repo removal shows a type-to-confirm dialog and cleanly cascades all downstream data
- Contributor removal is reversible — re-adding restores access to all historical data
- All mutation endpoints are protected by RLS (non-owners denied)
