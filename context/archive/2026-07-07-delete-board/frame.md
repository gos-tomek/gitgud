# Frame Brief: Delete Board

> Framing step before /10x-plan. This document captures what is _actually_
> at issue, separated from what was initially assumed.

## Reported Observation

There is no way to delete a board — once created it is permanent. The user wants
to add a "Delete Board" action in board settings.

## Initial Framing (preserved)

- **User's stated approach**: Add a delete option inside board settings.
- **User's proposed direction**: Cascade-delete all board data from the DB; gate the action behind a confirmation dialog modelled on the existing account-deletion flow.
- **Pre-dispatch narrowing**: Only the board creator/owner should be able to delete. (GitHub org connection question was dropped — investigation showed no such shared entity exists.)

## Dimension Map

The framing could break at any of these dimensions:

1. **DB cascade coverage** — does deleting the `boards` row actually remove all board data without a custom migration?
2. **RLS authorization** — is a DELETE policy for board owners already present, or does one need to be written?
3. **Migration scope** — is a new DB migration required?
4. **API surface** — does a `DELETE /api/board/[boardId]` endpoint exist?
5. **Settings-page UI gating** — does the settings page currently enforce owner-only rendering for destructive sections?
6. **Post-delete redirect** — what happens to the user's browser session after the board row is gone?

## Hypothesis Investigation

| Dimension               | Evidence                                                                                                                                                                                                                                   | Verdict                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------- |
| DB cascade coverage     | `boards → board_members`, `board_contributors`, `github_repos → github_pull_requests → github_reviews`, `github_review_comments → thread_classifications` — all `ON DELETE CASCADE`. Entire tree disappears with the `boards` row.         | STRONG — no gaps                    |
| RLS authorization       | `boards_delete` policy already in `20260529120000_access_control_and_membership.sql:81`: `USING (owner_user_id = auth.uid())`.                                                                                                             | STRONG — already present            |
| Migration scope         | Cascade and authorization are both already in place.                                                                                                                                                                                       | NONE needed                         |
| API surface             | No `DELETE /api/board/[boardId]` exists. Only `POST /api/board/index.ts` (create).                                                                                                                                                         | MISSING — must be created           |
| Settings-page UI gating | `src/pages/board/[id]/settings.astro` renders for any board member (`getBoardWithRole` only checks access, not role). `board.role` is available (`"supervisor"` = owner, `"contributor"` = member) but not used for conditional rendering. | PARTIAL — owner check must be added |
| Post-delete redirect    | Natural target is `/dashboard`. `DeleteAccountDialog` precedent: `window.location.href = "/"` after delete.                                                                                                                                | UNRESOLVED — must choose target     |

## Narrowing Signals

- Authorization model confirmed by user: only the board creator/owner may delete.
- "GitHub org connection" is not a real entity — `github_repos` is scoped per-board; no cross-board sharing exists.
- The DB already handles cascade cleanly; no custom delete procedure needed.

## Cross-System Convention

`DeleteAccountDialog.tsx` is the existing destructive-action pattern: inline expand (no separate modal), type-to-confirm (`"DELETE"`), `fetch` DELETE call, redirect on success. This is the exact UI shape the user described. The convention is consistent and reusable as a reference, not as a shared component (board name vs. account deletion differ enough).

## Reframed (or Confirmed) Problem Statement

> **The actual problem to plan around is**: the board lifecycle is missing a
> delete operation — the DB already supports it (cascade + RLS), but the API
> endpoint and the owner-gated UI do not yet exist.

The initial framing was correct and well-targeted. The only work is: (1) a
`DELETE /api/board/[boardId]` endpoint that calls `supabase.from("boards").delete()`,
(2) a React confirmation component in `settings.astro` rendered only when
`board.role === "supervisor"`, and (3) a post-delete redirect to `/dashboard`.
No DB migration is needed.

## Confidence

**HIGH** — strong evidence at every dimension, matches the existing
destructive-action convention, user confirmed the authorization model.

## What Changes for /10x-plan

The plan should cover exactly three deliverables: the API route, the React
component (modelled on `DeleteAccountDialog`), and the settings-page integration
with owner role guard. No migration work is in scope.

## References

- DB cascade chain: `supabase/migrations/20260529120000_access_control_and_membership.sql`
- DB cascade (github data): `supabase/migrations/20260531100000_github_ingestion_access.sql`
- DB cascade (contributors): `supabase/migrations/20260602120000_board_contributors.sql`
- DB cascade (classifications): `supabase/migrations/20260618120000_thread_classifications.sql`
- Existing RLS DELETE policy: `supabase/migrations/20260529120000_access_control_and_membership.sql:81`
- Existing UI pattern: `src/components/DeleteAccountDialog.tsx`
- Settings page (integration target): `src/pages/board/[id]/settings.astro`
- Board service (role mapping): `src/lib/services/boards.ts:22`
