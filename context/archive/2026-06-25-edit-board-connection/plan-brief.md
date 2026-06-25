# Edit Board Connection — Plan Brief

> Full plan: `context/changes/edit-board-connection/plan.md`
> Frame brief: `context/changes/edit-board-connection/frame.md`
> Research: `context/changes/edit-board-connection/research.md`

## What & Why

Move PAT storage from per-board to per-user, build a full `/profile/settings` page, fix the BoardTopbar avatar, add PAT-expiry capture with a 7-day warning banner, and implement account deletion. The actual problem (from the frame): implement four mostly-decoupled deliverables while explicitly resolving the PRD conflict that per-user PAT introduces — it contradicts FR-017/018/020/022 and the multi-org precedent, but the user has confirmed this as an intentional simplification.

## Starting Point

PAT is currently stored encrypted per-board in `boards.github_pat_encrypted`, managed via `create_board_atomic` (encrypt) and `get_board_github_pat` (decrypt) RPCs. `user_profiles` exists with `avatar_url` but has no PAT columns. `BoardTopbar.astro` renders a letter initial instead of the avatar. `/profile/settings` is a dead link (404). No PAT expiry data is captured anywhere — the GitHub response header is available but discarded.

## Desired End State

Users have one PAT in `user_profiles`, shared across all boards. The profile page is a live settings surface with PAT management, avatar, GitHub identity, sign-out, and account deletion. BoardTopbar shows the real avatar. A site-wide warning banner appears 7 days before PAT expiry. The PRD is updated to per-user semantics with multi-org documented as a known gap.

## Key Decisions Made

| Decision               | Choice                                 | Why (1 sentence)                                               | Source |
| ---------------------- | -------------------------------------- | -------------------------------------------------------------- | ------ |
| PAT cardinality        | Per-user, shared across boards         | User's deliberate simplification despite PRD conflict          | Frame  |
| PRD deviation handling | Update PRD to per-user semantics       | Single source of truth prevents spec drift for future planners | Plan   |
| Expiry capture timing  | Save time only (validate-pat header)   | Zero ongoing overhead; expiry rarely changes after creation    | Plan   |
| Create-board PAT step  | Keep step, pre-fill with stored info   | User always sees which token is used; consistent 3-step flow   | Plan   |
| Expiry warning scope   | All pages via Layout.astro             | User can't miss it; follows established config-status pattern  | Plan   |
| Profile page scope     | Full account settings                  | PAT, avatar, identity, sign-out, danger zone (delete account)  | Plan   |
| PAT backfill strategy  | Latest board's PAT per user            | Deterministic, simple SQL; most recent PAT most likely valid   | Plan   |
| Account deletion       | Full cascade: user + boards + all data | User's explicit requirement                                    | Plan   |

## Scope

**In scope:**

- PAT migration to `user_profiles` (expand phase only — column stays on `boards`)
- PAT expiry capture from GitHub header at save time
- `/profile/settings` page with full account settings
- Account deletion with full data cascade
- BoardTopbar avatar fix
- 7-day PAT expiry warning banner
- PRD FR-018/020/022 update
- `github_repos.connected_by` FK fix (ON DELETE SET NULL)

**Out of scope:**

- Dropping `boards.github_pat_encrypted` (future contract phase)
- Per-board PAT override for multi-org users
- PAT expiry refresh on sync calls
- Email notifications for expiry
- Board transfer on account deletion

## Architecture / Approach

Data flows from GitHub header → `validate-pat.ts` → `POST /api/profile/pat` → `set_user_github_pat` RPC → `user_profiles`. Board creation and the Worker read PAT via `get_user_github_pat` RPC which joins `boards.owner_user_id` → `user_profiles` to decrypt. Layout.astro queries `token_expires_at` on every authenticated page load for the warning banner. Account deletion uses service_role `auth.admin.deleteUser()` with FK cascades handling all associated data.

## Phases at a Glance

| Phase                           | What it delivers                                                                | Key risk                                                                                |
| ------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 1. Avatar Fix                   | BoardTopbar shows real GitHub avatar                                            | Minimal — render-only, data exists                                                      |
| 2. Data Model Expansion         | PAT + expiry columns, RPCs, backfill, FK fix, route protection                  | Migration backfill picks wrong PAT for multi-board users (mitigated: uses latest board) |
| 3. PAT Capture & Board Creation | Expiry header capture, save-PAT API, updated create-board flow, wizard pre-fill | Breaking RPC change — API route and RPC must deploy together                            |
| 4. Profile/Settings Page        | Full account settings with delete account                                       | Service_role key needed in Astro context; cascade must be complete                      |
| 5. Expiry Warning Banner        | Site-wide 7-day warning via Layout.astro                                        | Extra DB query per page load (lightweight PK lookup)                                    |
| 6. PRD Update                   | FR-018/020/022 updated, deprecated column documented                            | Documentation only — no risk                                                            |

**Prerequisites:** Local Supabase running for integration testing. `SUPABASE_SERVICE_KEY` available in env for account deletion endpoint.
**Estimated effort:** ~4-5 sessions across 6 phases.

## Open Risks & Assumptions

- `SUPABASE_SERVICE_KEY` may not be declared in `astro.config.mjs` env schema yet — Phase 4 may need to add it
- Multi-board users with different PATs per board lose all but the latest during backfill — acceptable given current usage patterns but should be communicated if there are known multi-board users
- The `create_board_atomic` RPC signature change is breaking — old clients calling with `p_raw_token` will fail. No external consumers exist (only `POST /api/board`), but deployment order matters

## Success Criteria (Summary)

- Users can manage their PAT from `/profile/settings` and see expiry status
- Board creation reuses the stored PAT without re-entry (with override option)
- A visible warning appears site-wide when PAT expires within 7 days
- Account deletion cleanly removes all user data with no orphaned records
