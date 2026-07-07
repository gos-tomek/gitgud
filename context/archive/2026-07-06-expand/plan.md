# Contract Phase: Drop Dead PAT Column, RPC & Tighten board_contributors Grants

## Overview

Complete the deferred contract phase of the PAT-to-user-profiles migration (2026-06-25) by dropping the now-dead `boards.github_pat_encrypted` column and `get_board_github_pat` RPC. Additionally, revoke the unused UPDATE and DELETE grants on `board_contributors` (append-only table). Clean up the one stale code reference.

## Current State Analysis

- `boards.github_pat_encrypted` was superseded by `user_profiles.github_pat_encrypted` in migration `20260625120000_user_pat_and_expiry.sql`. The column has had zero readers/writers since `20260625130000_create_board_read_user_pat.sql` rewired `create_board_atomic`.
- `get_board_github_pat(uuid, text)` RPC — zero callers in `src/`. Replaced by `get_user_github_pat` / `get_user_github_pat_by_user_id`. Still has a live `GRANT EXECUTE ... TO authenticated`.
- `board_contributors` has `GRANT SELECT, INSERT, UPDATE, DELETE` but no code ever calls `.update()` or `.delete()` on it. Table is append-only. Over-grant documented in archived impl-review finding F3.
- One stale comment in `tests/integration/pat-leak.test.ts:17-19` references `get_board_github_pat`.

### Key Discoveries:

- `src/lib/services/boards.ts:50` selects `github_pat_encrypted` from `user_profiles`, not `boards` — confirmed no live reference to the `boards` column
- The RPC was redefined once in `20260619100000_service_role_pat_access.sql` with signature `(p_board_id uuid, p_encryption_key text)` — DROP must match this exact signature
- `board_contributors` UPDATE/DELETE will be re-granted when the contributor management feature ships

## Desired End State

- `boards` table no longer has `github_pat_encrypted` column
- `get_board_github_pat(uuid, text)` function no longer exists
- `board_contributors` grants are `SELECT, INSERT` only (no UPDATE, DELETE)
- Zero references to `get_board_github_pat` in the codebase
- All existing tests pass — no functional code depends on any dropped object

## What We're NOT Doing

- Dropping write-only columns (`fetched_at`, `position_side`, `model_id`) — these are forward-looking metadata, not migration debt
- Addressing `board_contributors` RLS policy design — that's for the contributor management feature
- Any application code changes beyond the stale comment fix

## Implementation Approach

One migration file handles all three DB changes (DROP FUNCTION, DROP COLUMN, REVOKE+re-GRANT). One test file update fixes the stale comment. Both ship in a single commit.

## Phase 1: Contract Migration & Test Cleanup

### Overview

Write the contract migration, update the stale test comment, verify everything passes.

### Changes Required:

#### 1. Contract migration

**File**: `supabase/migrations/<next_timestamp>_contract_drop_board_pat.sql`

**Intent**: Drop the dead `get_board_github_pat` RPC and `boards.github_pat_encrypted` column, tighten `board_contributors` grants to SELECT+INSERT only.

**Contract**:

- `DROP FUNCTION IF EXISTS public.get_board_github_pat(uuid, text)` — must match the exact overloaded signature from `20260619100000`
- `ALTER TABLE public.boards DROP COLUMN IF EXISTS github_pat_encrypted` — the bytea column added in `20260531100000`
- `REVOKE ALL ON public.board_contributors FROM authenticated` followed by `GRANT SELECT, INSERT ON public.board_contributors TO authenticated` — narrows from the current SELECT/INSERT/UPDATE/DELETE

#### 2. Stale test comment

**File**: `tests/integration/pat-leak.test.ts`

**Intent**: Update the comment at lines 17-19 to reference the current RPC (`get_user_github_pat_by_user_id`) instead of the dropped `get_board_github_pat`.

**Contract**: Comment-only change in the availability guards section. No functional test changes.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npx supabase db reset` (local)
- Column gone: `SELECT github_pat_encrypted FROM boards LIMIT 0` returns error
- Function gone: `SELECT proname FROM pg_proc WHERE proname = 'get_board_github_pat'` returns 0 rows
- Grants correct: `board_contributors` has only SELECT+INSERT for authenticated
- Type checking passes: `npx tsc --noEmit` and `npm run test:typecheck`
- Linting passes: `npm run lint`
- Non-integration tests pass: `vitest run --exclude 'tests/integration/**'`
- Integration tests pass: `vitest run tests/integration/`

#### Manual Verification:

- Board creation and sync still work (PAT is read from `user_profiles`, unaffected)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- No new tests needed — no application code changes

### Integration Tests:

- Existing `pat-leak.test.ts` continues to pass (it uses `set_user_github_pat` / `get_user_github_pat`, not the dropped RPC)
- Existing `access-boundary.test.ts` continues to pass (uses INSERT on `board_contributors`, not UPDATE/DELETE)

### Manual Testing Steps:

1. Create a board with a linked GitHub repo — verify PAT is read from user profile, sync works
2. Confirm `board_contributors` rows are created during sync (INSERT still granted)

## Migration Notes

- This is a **destructive** (contract) migration — it cannot be rolled back via `supabase db reset` without re-running the expand migration that created the column. However, since the column has been empty/unused since 2026-06-25, data loss is zero.
- If `wrangler rollback` is needed: the Worker code doesn't reference `boards.github_pat_encrypted` or `get_board_github_pat`, so the rolled-back Worker is compatible with the post-contract schema. Safe per expand/contract convention.

## References

- Research: `context/changes/expand/research.md`
- Deferred-drop comment: `supabase/migrations/20260625120000_user_pat_and_expiry.sql:8-9`
- Archived change: `context/archive/2026-06-25-edit-board-connection/change.md`
- Over-grant finding: `context/archive/2026-06-11-test-fix-gaps/reviews/impl-review.md` (F3)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Contract Migration & Test Cleanup

#### Automated

- [x] 1.1 Migration applies cleanly — 5609340
- [x] 1.2 Column and function verified gone — 5609340
- [x] 1.3 board_contributors grants narrowed to SELECT+INSERT — 5609340
- [x] 1.4 Type checking passes — 5609340
- [x] 1.5 Linting passes — 5609340
- [x] 1.6 Non-integration tests pass — 5609340
- [x] 1.7 Integration tests pass — 5609340

#### Manual

- [x] 1.8 Board creation and sync work with user-profile PAT — 5609340
