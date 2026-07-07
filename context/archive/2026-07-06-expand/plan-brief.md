# Contract Phase: Drop Dead PAT Column, RPC & Tighten Grants — Plan Brief

> Full plan: `context/changes/expand/plan.md`
> Research: `context/changes/expand/research.md`

## What & Why

Complete the deferred contract phase of the PAT-to-user-profiles migration from 2026-06-25. The `boards.github_pat_encrypted` column and `get_board_github_pat` RPC were explicitly left in place for rollback safety; both have been dead (zero callers) for 11 days. Additionally, tighten the over-broad UPDATE/DELETE grants on `board_contributors` (append-only table).

## Starting Point

PATs moved from per-board (`boards.github_pat_encrypted`) to per-user (`user_profiles.github_pat_encrypted`) in migration `20260625120000`. All read/write paths were rewired, but the old column and RPC were kept for expand/contract safety. The contract-phase DROP was never scheduled as a follow-up change — until now.

## Desired End State

The `boards` table no longer carries the dead `github_pat_encrypted` column. The `get_board_github_pat` RPC no longer exists. `board_contributors` grants are narrowed to SELECT+INSERT (UPDATE/DELETE re-granted when contributor management ships). Zero stale references remain in the codebase.

## Key Decisions Made

| Decision                  | Choice                                                      | Why (1 sentence)                                                                     | Source   |
| ------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------ | -------- |
| Scope of column/RPC drops | Only `boards.github_pat_encrypted` + `get_board_github_pat` | Only objects with an explicit deferred-drop promise in a migration comment           | Research |
| Write-only columns        | Out of scope                                                | Forward-looking metadata, not migration debt — no migration flagged them for removal | Research |
| board_contributors grants | REVOKE UPDATE/DELETE now, re-GRANT later                    | Table is append-only today; contributor management feature will re-grant when needed | Plan     |
| DROP style                | IF EXISTS                                                   | Idempotent, safe for dev re-runs                                                     | Plan     |
| Test changes              | Comment update only                                         | pat-leak.test.ts already uses new RPCs; only a stale comment references old one      | Plan     |

## Scope

**In scope:**

- DROP `get_board_github_pat(uuid, text)` RPC
- DROP `boards.github_pat_encrypted` column
- REVOKE UPDATE, DELETE on `board_contributors` for authenticated
- Update stale comment in `pat-leak.test.ts`

**Out of scope:**

- Write-only columns (`fetched_at`, `position_side`, `model_id`)
- `board_contributors` RLS policy redesign
- Any application code changes

## Architecture / Approach

Single migration file with three statements: DROP FUNCTION, DROP COLUMN, REVOKE+re-GRANT. No application code changes needed — all live code paths already use the user-profiles-based PAT functions. Backward-compatible with `wrangler rollback` since the Worker never references the dropped objects.

## Phases at a Glance

| Phase                                | What it delivers                                                | Key risk                                             |
| ------------------------------------ | --------------------------------------------------------------- | ---------------------------------------------------- |
| 1. Contract Migration & Test Cleanup | Dead objects removed, grants tightened, stale reference cleaned | Near-zero: objects confirmed dead by research + grep |

**Prerequisites:** Local Supabase running for migration testing
**Estimated effort:** ~1 session, single phase

## Open Risks & Assumptions

- Assumes no external tooling or scheduled jobs reference `get_board_github_pat` outside this repo (confirmed by research: zero callers)
- `board_contributors` DELETE/UPDATE will need re-granting when contributor management ships — must be tracked

## Success Criteria (Summary)

- Migration applies cleanly with zero test failures
- `grep -r 'get_board_github_pat' src/ tests/` returns zero results
- Board creation and sync continue working via user-profile PAT path
