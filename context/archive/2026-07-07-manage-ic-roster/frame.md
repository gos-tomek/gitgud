# Frame Brief: Board post-creation management (roster, repos, name)

> Framing step before /10x-plan. This document captures what is _actually_
> at issue, separated from what was initially assumed.

## Reported Observation

The board settings page (`/board/[id]/settings.astro`) is read-only. After
board creation, there is no way to edit the board name, add/remove
repositories, or manage the contributor roster. Boards evolve over time —
people join/leave teams, repos get added/archived — but the only path today
is to delete and recreate the board.

## Initial Framing (preserved)

- **User's stated cause or approach**: This is a missing CRUD feature — the
  settings page needs edit controls.
- **User's proposed direction**: Build management UI for all three (name,
  repos, contributors) as one change.
- **Pre-dispatch narrowing**: Leading concern is "board evolves over time"
  (not wrong-initial-selection). User sees this as one observation ("settings
  page should be editable"), not three separate problems.

## Dimension Map

The observation could originate at any of these dimensions:

1. **UI gap** — settings page lacks edit controls; wiring forms to new
   endpoints solves it
2. **Data model / API gap** — no API routes or RPCs for incremental updates
   ← initial framing
3. **Cascade complexity** — removing repos/contributors has downstream data
   implications (PRs, reviews, classifications)
4. **Access control gap** — RLS policies may not support UPDATE/DELETE on
   repos and contributors

## Hypothesis Investigation

| Hypothesis                          | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Verdict                                                            |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| H1: UI gap only                     | `settings.astro` renders read-only lists of repos and contributors with no forms or action buttons                                                                                                                                                                                                                                                                                                                                                                                                                       | STRONG — confirmed gap                                             |
| H2: Data model / API gap            | RLS policies already grant board owners INSERT/UPDATE/DELETE on `boards`, `github_repos`, `board_contributors`. No API routes exist for PATCH/DELETE. No `update_board` RPC. `create_board_atomic` is the only write path.                                                                                                                                                                                                                                                                                               | STRONG — RLS is ready, API layer is not                            |
| H3: Cascade complexity is a blocker | **Repo removal**: clean CASCADE chain — `github_repos` → `github_pull_requests` → `github_reviews` + `github_review_comments` → `thread_classifications`. All downstream data is deleted. **Contributor removal**: `board_contributors` is a leaf table — no FK points to it. PRs/reviews/comments survive but become unreachable through per-contributor API endpoints (lookup by `github_login` in `board_contributors` fails). Re-adding the same `github_id` restores access to all historical data without re-sync. | STRONG — not a blocker but a design decision the plan must address |
| H4: Access control gap              | `boards_update`, `boards_delete`, `github_repos_insert/update/delete`, `board_contributors_insert/delete` policies all exist and gate on `is_board_owner(board_id)`. Only missing: no UPDATE policy on `board_contributors` (but add/remove via INSERT/DELETE is sufficient).                                                                                                                                                                                                                                            | NONE — RLS already covers it                                       |

## Narrowing Signals

- Step 3 evidence was conclusive; no user questioning needed.
- Repo removal is clean CASCADE — data loss is intentional and complete.
- Contributor removal is soft — data persists, access is gated by
  `board_contributors` membership. Re-adding restores everything.
- `impact-metrics.ts:681` builds an avatar/login lookup from
  `board_contributors`; a removed contributor's identity disappears from
  aggregate views (reviewer display on others' PRs).

## Cross-System Convention

The prior `edit-board-connection` change (archived 2026-06-25) dealt with
PAT storage and user profile — it did not touch board CRUD. No prior change
has addressed post-creation board management. The board creation wizard
(`CreateBoardForm.tsx` + `wizard-reducer.ts`) is the only existing write
path, and it uses `create_board_atomic` — a transactional all-or-nothing
RPC. Incremental edits can use direct table operations (protected by
existing RLS) without needing a new atomic RPC.

## Reframed (or Confirmed) Problem Statement

> **The initial framing was correct — proceed with the originally proposed
> direction.** This is a missing CRUD feature.

The settings page needs to become editable. The database layer (RLS
policies) already supports incremental edits; the gap is entirely in the
API layer (no routes for PATCH/DELETE) and UI layer (no forms/controls).
The one nuance the plan must handle is the **cascade asymmetry**: repo
removal destroys all downstream data (clean CASCADE), while contributor
removal only hides data behind a membership gate (soft removal, reversible
by re-adding). The plan should make this behavior explicit to the user in
the UI — particularly the destructive nature of repo removal and the
reversible nature of contributor removal.

## Confidence

**HIGH** — strong evidence across all dimensions. RLS is confirmed ready,
API gap is clear, cascade behavior is fully traced. No further
investigation needed before planning.

## What Changes for /10x-plan

The plan should:

1. **Re-grant UPDATE/DELETE on `board_contributors`**: The contract
   migration `20260707120000_contract_drop_board_pat.sql` (in GitGud,
   pending merge to GitGud-board) narrowed grants to SELECT+INSERT only,
   with an explicit note: "UPDATE/DELETE will be re-granted when contributor
   management ships." This change IS that feature — the plan must include
   a migration that re-grants DELETE on `board_contributors` to
   `authenticated`. UPDATE is likely unnecessary (contributors are
   identified by PK `(board_id, github_id)` — add/remove, not edit).
2. Add API routes under `/api/board/[boardId]/` for: PATCH (rename board),
   POST + DELETE repos, POST + DELETE contributors.
3. Transform the settings page from read-only to editable with inline
   controls or a settings form.
4. Handle repo removal as a destructive action with confirmation UI
   (CASCADE deletes all PRs/reviews/comments/classifications).
5. Handle contributor removal as a soft action — document/communicate
   that data persists and re-adding restores access.
6. Validate the board name uniqueness constraint (per-owner,
   case/whitespace-insensitive) on rename, reusing the existing
   `/api/board/check-name` pattern.
7. For contributor addition post-creation, reuse the GitHub
   `listContributors` fetch pattern from `CreateBoardForm.tsx` step 3, or
   allow manual entry by GitHub login.

## References

- Settings page: `src/pages/board/[id]/settings.astro`
- Board creation: `src/components/CreateBoardForm.tsx`, `src/components/wizard-reducer.ts`
- API: `src/pages/api/board/index.ts` (POST only), `src/pages/api/board/check-name.ts`
- Service layer: `src/lib/services/boards.ts`
- Schema: `supabase/migrations/20260529120000_access_control_and_membership.sql` (boards + RLS), `20260531100000_github_ingestion_access.sql` (repos + RLS), `20260602120000_board_contributors.sql` (contributors + RLS)
- Types: `src/types.ts` (Board, GitHubRepo, BoardContributor)
- Cascade chain: `github_repos` → `github_pull_requests` → `github_reviews` + `github_review_comments` → `thread_classifications` (all ON DELETE CASCADE)
- Contributor lookup: `src/pages/api/board/[boardId]/impact/[login]/` endpoints, `src/lib/services/impact-metrics.ts:681`
- Prior related change: `context/archive/2026-06-25-edit-board-connection/` (PAT management, not board CRUD)
- Contract migration dependency: `GitGud/supabase/migrations/20260707120000_contract_drop_board_pat.sql` — revoked UPDATE/DELETE on `board_contributors`, must be re-granted by this change
- Contract plan: `GitGud/context/changes/expand/plan.md:18` — "board_contributors UPDATE/DELETE will be re-granted when the contributor management feature ships"
