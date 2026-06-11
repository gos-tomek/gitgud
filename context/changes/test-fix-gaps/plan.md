# Test Fix Gaps Implementation Plan

## Overview

Fix two structurally fragile systems in the board creation flow — a non-atomic API sequence and a flat-state wizard — and harden infrastructure conventions. The 10 parked defects from `board-creation-contract` (Phase 2) and `testing-access-boundary` (Phase 1) cluster into two structural roots plus one independent infra batch. Fixing the roots eliminates the symptoms and prevents recurrence as S-08/S-10/S-11 ship.

Three PRs, nine phases. Each PR ships independently; phase order within a PR is sequential.

## Current State Analysis

### API endpoint (`src/pages/api/boards/index.ts:60-102`)

POST `/api/boards` executes 4 sequential PostgREST calls, each in its own DB transaction:

1. `createBoard()` → INSERT boards
2. `supabase.rpc("set_board_github_pat")` → pgp_sym_encrypt + UPDATE boards
3. `supabase.from("github_repos").insert(...)` → INSERT github_repos
4. `addBoardContributors()` → INSERT board_contributors

Compensation logic is inconsistent:
- Step 2 failure: board orphaned (S3)
- Step 3 failure: silently swallowed, 201 returned with zero repos (S4)
- Step 4 failure: CASCADE delete (correct), but cleanup failure orphans the board (S6)

### Wizard component (`src/components/CreateBoardForm.tsx:48-79`)

17 `useState` hooks with ad-hoc transition handlers. No formal state machine, no guard conditions on transitions. Bugs stem from transitions that don't clean up or carry forward state correctly:
- Bug 1: `selectedContributors` not cleared when returning to step 2 (line 225-228)
- Bug 2: PAT validation race — `fetchRepos` called after `setStep(2)`, stale `lastFetchedPat.current` ref (line 86-107)
- Bug 3: API warnings from PAT validation parsed but never stored or displayed (line 172-176)

> **Reclassified during Phase 6 manual review**: the original "Bug 4" (submit disabled with empty `selectedContributors`, line 666-671) is **not a defect** — the business rule requires at least one contributor per board. The "no escape path" symptom was caused by Bug 1 (Back navigation didn't refresh repos/collaborators), which is fixed above. With Bug 1 fixed, a user who lands on a repo set with no collaborators can go Back, change repos, and try again. Submission continues to require `selectedContributors.length >= 1`, matching the original (pre-Phase-5) behavior.

### Infrastructure gaps

- All 7 tables `REVOKE ALL FROM anon` only — missing `authenticated` per project convention (`lessons.md`)
- Logger (`src/lib/logger.ts:1`) is bare `consola` re-export with zero redaction
- Service functions (`src/lib/services/boards.ts:61-114`) have no app-layer userId filtering (deferred: RLS is the access control layer)

### Key Discoveries:

- `set_board_github_pat` is called only by POST `/api/boards` (production) and `pat-leak.test.ts:79` (tests) — safe to drop if test setup is updated
- `get_board_github_pat` is called by `/api/github/sync` — must be kept
- `createBoard` and `addBoardContributors` are called only by POST `/api/boards` — become dead code after the rewrite
- `boards_insert_owner_as_member` trigger (`20260529130000_board_triggers.sql:28-47`) auto-enrolls the owner, so `create_board_atomic` doesn't need to INSERT into board_members
- SECURITY DEFINER + `SET search_path = public` pattern is established by existing RPC functions (`set_board_github_pat`, `get_board_github_pat`, `is_board_member`, `is_board_owner`)
- Unique index `boards_owner_name_unique` (`20260529140000`) enforces case/whitespace-insensitive uniqueness per owner — the atomic RPC inherits this constraint

## Desired End State

- POST `/api/boards` calls a single plpgsql function that creates the board, encrypts the PAT, links repos, and adds contributors in one atomic transaction. Any failure rolls back everything — no orphaned boards, no partial state.
- `CreateBoardForm` uses a `useReducer` with a discriminated union state type. Step transitions are explicit actions with guard conditions. Bugs 1-3 are eliminated by design; the Bug-4 concern is resolved by Bug 1's fix, and the ≥1-contributor submission rule is preserved.
- All 7 tables have `REVOKE ALL FROM anon, authenticated` with complete per-operation RLS policies. Logger redacts known sensitive patterns before output.
- All existing test suites pass. "Known defect" markers in tests are replaced with assertions of correct behavior.

### Verification:

- `npm test` passes with zero known-defect markers
- `npm run lint && npm run build` pass
- Manual: create a board through the wizard → board appears on dashboard with repos and contributors. Navigate back/forward through steps without data loss.

## What We're NOT Doing

- **App-layer userId filtering in service functions** — deferred; RLS is the access control layer by design. Service functions (getBoardWithRole, getBoardRepos, getBoardContributors) continue to rely on the Supabase client's auth context.
- **XState or other state machine library** — useReducer with TypeScript discriminated union is sufficient; no new dependencies.
- **Structured error codes from the API** — the atomic RPC returns generic errors; the step-level detail lives in server logs only.
- **Dropping get_board_github_pat** — still used by `/api/github/sync`.
- **E2E tests** — not in rollout scope (test-plan §3).
- **Immer for reducer updates** — potential React Compiler compatibility issues; plain spread operators are sufficient.

## Implementation Approach

**Three PRs from one change folder.** Each PR corresponds to a scope from the frame brief:

| PR | Scope | Phases | Branch |
|----|-------|--------|--------|
| 1 | API Atomicity | 1–4 | `change/test-fix-gaps-api` |
| 2 | Wizard State Machine | 5–7 | `change/test-fix-gaps-wizard` |
| 3 | Infrastructure Hardening | 8–9 | `change/test-fix-gaps-infra` |

PR 1 and PR 2 are independent — either can ship first. PR 3 is fully independent of both.

## Critical Implementation Details

### Timing & lifecycle

The `boards_insert_owner_as_member` AFTER INSERT trigger fires within the same transaction as `create_board_atomic`. The owner's board_members row exists by the time github_repos and board_contributors are inserted. This means RLS policies that check `is_board_member(board_id)` are satisfied for the owner within the function — no special handling needed.

### State sequencing

The `create_board_atomic` function must INSERT boards BEFORE encrypting the PAT, because `github_pat_encrypted` is a column on the boards table — the row must exist first. The INSERT returns the board_id used by subsequent github_repos and board_contributors inserts. If the repos or contributors JSONB arrays are empty, the corresponding INSERT is skipped (no error on empty input).

---

## Phase 1: plpgsql Migration

### Overview

Create the `create_board_atomic` SECURITY DEFINER function that replaces the 4-step sequence with a single atomic transaction. Drop the now-superseded `set_board_github_pat` function.

### Changes Required:

#### 1. New migration file

**File**: `supabase/migrations/YYYYMMDDHHMMSS_create_board_atomic.sql`

**Intent**: Define a plpgsql function that atomically creates a board, encrypts and stores the PAT, links repos, and adds contributors — all in one transaction. Validate caller ownership via `auth.uid()`.

**Contract**: Function signature:

```sql
CREATE FUNCTION public.create_board_atomic(
  p_user_id       uuid,
  p_name          text,
  p_raw_token     text,
  p_encryption_key text,
  p_repos         jsonb,       -- [{"owner":"...","name":"..."}]
  p_contributors  jsonb        -- [{"github_id":123,"github_login":"...","avatar_url":"..."}]
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
```

The function:
- Validates `p_user_id = auth.uid()`, raises `42501` if not
- INSERTs into `boards` (name, owner_user_id), captures board_id
- UPDATEs `boards` SET `github_pat_encrypted = pgp_sym_encrypt(p_raw_token, p_encryption_key)` WHERE id = board_id
- If `p_repos` is non-empty: INSERTs into `github_repos` (board_id, repo_owner, repo_name, connected_by = p_user_id) from `jsonb_to_recordset(p_repos)`
- If `p_contributors` is non-empty: INSERTs into `board_contributors` (board_id, github_id, github_login, avatar_url) from `jsonb_to_recordset(p_contributors)`
- RETURNs board_id
- Unique violation on `boards_owner_name_unique` propagates as SQLSTATE 23505

The migration also:
- `REVOKE ALL ON FUNCTION public.create_board_atomic FROM public, anon`
- `GRANT EXECUTE ON FUNCTION public.create_board_atomic TO authenticated`
- `DROP FUNCTION IF EXISTS public.set_board_github_pat(uuid, text, text)`
- Removes the GRANT on the dropped function

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly on a fresh Supabase instance: `npx supabase db reset`
- Function exists and is callable: `SELECT proname FROM pg_proc WHERE proname = 'create_board_atomic'`
- `set_board_github_pat` no longer exists: `SELECT proname FROM pg_proc WHERE proname = 'set_board_github_pat'` returns empty
- `get_board_github_pat` still exists and works

#### Manual Verification:

- Call `create_board_atomic` via Supabase Studio SQL editor with test data → board + PAT + repos + contributors created atomically
- Call with duplicate name → 23505 error, no partial state
- Call with wrong user ID → 42501 error

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Endpoint Rewrite

### Overview

Replace the 4-step POST `/api/boards` handler with a single `.rpc('create_board_atomic')` call. Simplify error handling to: duplicate name → 409, everything else → 500 with generic message.

### Changes Required:

#### 1. POST handler rewrite

**File**: `src/pages/api/boards/index.ts`

**Intent**: Replace the multi-step orchestration (lines 60-102) with a single RPC call. Keep Zod validation (lines 26-38) — validate before calling the RPC. Remove imports of `createBoard`, `addBoardContributors`, `BoardNameTakenError`.

**Contract**: The handler calls `supabase.rpc("create_board_atomic", { p_user_id, p_name, p_raw_token, p_encryption_key, p_repos, p_contributors })`. On success → `201 { id: boardId }`. On error code `23505` → `409 { error: "You already have a board with that name" }`. On any other error → `500 { error: "Board creation failed. Please try again." }`. Errors are logged with `logger.error('[boards] create_board_atomic failed', { boardName, userId, pgCode, detail })`.

#### 2. Remove unused imports

**File**: `src/pages/api/boards/index.ts`

**Intent**: Remove the import of `createBoard`, `addBoardContributors`, `BoardNameTakenError` from `@/lib/services/boards`. Remove the import of `GITHUB_TOKEN_ENCRYPTION_KEY` only if it's no longer needed (it IS still needed — passed to the RPC as `p_encryption_key`).

**Contract**: Only `GITHUB_TOKEN_ENCRYPTION_KEY` from `astro:env/server` and `logger` from `@/lib/logger` remain as non-Astro imports alongside the Zod schema.

### Success Criteria:

#### Automated Verification:

- TypeScript compiles: `npx astro check` (or `npm run lint`)
- Build succeeds: `npm run build`
- No references to `createBoard`, `addBoardContributors`, `BoardNameTakenError` in `index.ts`

#### Manual Verification:

- Create a board via the UI → 201, board appears on dashboard
- Create a board with duplicate name → 409, error displayed
- (Requires Supabase running locally)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Dead Code Removal

### Overview

Remove service functions and error class that are no longer called after the endpoint rewrite.

### Changes Required:

#### 1. Remove createBoard, addBoardContributors, BoardNameTakenError

**File**: `src/lib/services/boards.ts`

**Intent**: Remove the `createBoard` function (lines 33-47), `addBoardContributors` function (lines 116-131), and `BoardNameTakenError` class (lines 26-30). These are only called by the old POST handler. Keep `getUserBoards`, `getBoardWithRole`, `getBoardRepos`, `getBoardContributors` — they are used by other API routes and pages.

**Contract**: The `boards.ts` module exports only: `getUserBoards`, `getBoardWithRole`, `getBoardRepos`, `getBoardContributors`, and the type helpers (`toUserBoard`, `BoardRow`).

### Success Criteria:

#### Automated Verification:

- TypeScript compiles with no unused-export warnings: `npm run lint`
- Build succeeds: `npm run build`
- `grep -rn "createBoard\|addBoardContributors\|BoardNameTakenError" src/` returns only type definitions or zero results

#### Manual Verification:

- Dashboard page loads correctly (uses `getUserBoards`)
- Board detail page loads correctly (uses `getBoardWithRole`, `getBoardRepos`, `getBoardContributors`)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: API Test Updates

### Overview

Rewrite hermetic tests for the new single-RPC contract. Update `pat-leak.test.ts` setup to use `create_board_atomic` instead of the dropped `set_board_github_pat`.

### Changes Required:

#### 1. Rewrite hermetic board creation tests

**File**: `tests/hermetic/board-creation.test.ts`

**Intent**: Replace the existing test file (which mocks 4 separate Supabase calls) with a fresh suite structured around the new single-RPC contract. Remove all "Known defect" markers — S3/S4/S6 are eliminated by atomic execution. The mock surface reduces to: `@/lib/supabase` (createClient), `astro:env/server`, and `supabase.rpc()`.

**Contract**: Test cases cover:
- Happy path: `.rpc()` returns `{ data: uuid }` → handler returns 201 `{ id: uuid }`
- Duplicate name: `.rpc()` returns error code `23505` → handler returns 409
- Generic RPC failure: `.rpc()` returns error → handler returns 500 with generic message
- Zod validation failure: invalid payload → handler returns 400 with field errors
- Unauthenticated: `auth.getUser()` returns null → handler returns 401
- Empty repos/contributors: invalid payload (`repos: []` / `contributors: []`) → handler returns 400 with the field-specific message (`"At least one repository is required"` / `"At least one contributor is required"`); `.rpc()` is never called

> **Implementation-time correction**: the original wording of the last bullet was "valid payload with empty arrays → handler calls `.rpc()` with empty JSONB arrays". That contradicts the business rule (a board requires ≥1 repo and ≥1 contributor) and the existing `.min(1)` Zod constraints at `src/pages/api/boards/index.ts:28-29`, so empty arrays never reach `.rpc()`. The bullet above reflects the actual, correct, pre-existing 400 behavior (equivalent to H7 in the old suite). `index.ts` is unchanged; `create_board_atomic`'s `IF jsonb_array_length(...) > 0` guards remain defensive SQL-side code not exercised via the API.

Mock structure: `vi.hoisted()` for mock variables, `vi.mock("@/lib/supabase")`, `vi.mock("astro:env/server")`. `makeContext` helper builds `APIContext` from a `Request`. `beforeEach` resets mocks and configures happy-path defaults.

#### 2. Update pat-leak test setup

**File**: `tests/integration/pat-leak.test.ts`

**Intent**: Replace the `set_board_github_pat` RPC call (line 79-84) with `create_board_atomic`, which creates the board + stores the PAT + links the repo in one call. This eliminates the 3 separate admin setup steps (create board, add repo, store PAT) and replaces them with a single RPC call from the owner client.

**Contract**: The test setup calls `ownerClient.rpc("create_board_atomic", { p_user_id: ownerUserId, p_name: ..., p_raw_token: TEST_PAT, p_encryption_key: ENCRYPTION_KEY, p_repos: [{ owner: "test-org", name: "test-repo-pat-leak" }], p_contributors: [] })`. The returned UUID becomes `ownerBoardId`. The admin-client board insert (line 49-55) and repo insert (line 67-73) are removed. The contributor board_member insert (line 58-61) stays — it uses admin since the contributor isn't added via the RPC.

### Success Criteria:

#### Automated Verification:

- `npm test` passes — all hermetic and integration tests green
- Zero "Known defect" comments in `tests/hermetic/board-creation.test.ts`
- `pat-leak.test.ts` passes with Supabase running

#### Manual Verification:

- Review test output: hermetic suite covers success, duplicate, failure, validation, auth cases
- Review pat-leak suite: sentinel PAT still doesn't appear in response or logs

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 5: Reducer Extraction + Unit Tests

### Overview

Extract the wizard's state management into a pure `wizardReducer` function with a TypeScript discriminated union state type. Write unit tests that verify transition logic, guard conditions, and the fixes for Bugs 1-4 at the reducer level.

### Changes Required:

#### 1. Wizard state types and reducer

**File**: `src/components/wizard-reducer.ts` (new file)

**Intent**: Define `WizardState` as a discriminated union on `step` (1 | 2 | 3), `WizardAction` as a union of all possible actions, and `wizardReducer` as a pure function. Each step's state includes only the fields relevant to that step, plus shared fields (name, pat, patValidation, apiError, submitting) that persist across steps. The reducer enforces transition guards: NEXT_TO_STEP_2 requires valid PAT and non-empty name; NEXT_TO_STEP_3 requires at least one selected repo. BACK_TO_STEP_2 clears selectedContributors (fixes Bug 1). PAT validation actions reset on new PAT input and store warnings (fixes Bugs 2, 3).

**Contract**: Exported types: `WizardState`, `WizardAction`, `PatValidation`, `RepoItem`, `CollaboratorItem`. Exported function: `wizardReducer(state: WizardState, action: WizardAction): WizardState`. Exported constant: `initialState: WizardState` (step 1 defaults).

The discriminated union shape:

```ts
type WizardState =
  | { step: 1; name: string; nameError?: string; checkingName: boolean;
      pat: string; patVisible: boolean; patValidation: PatValidation;
      apiError?: string; submitting: boolean }
  | { step: 2; name: string; pat: string; patValidation: PatValidation;
      repos: RepoItem[]; reposLoading: boolean; reposError?: string;
      repoFilter: string; selectedRepos: RepoItem[];
      manualEntry: string; manualEntryLoading: boolean; manualEntryError?: string;
      apiError?: string; submitting: boolean }
  | { step: 3; name: string; pat: string; patValidation: PatValidation;
      selectedRepos: RepoItem[];
      collaborators: CollaboratorItem[]; selectedContributors: CollaboratorItem[];
      collaboratorsLoading: boolean; collaboratorsError?: string;
      contributorFilter: string;
      apiError?: string; submitting: boolean };
```

Key bug fixes embedded in the reducer:
- **Bug 1**: `BACK_TO_STEP_2` action resets `selectedContributors` to `[]`
- **Bug 2**: `SET_PAT` action resets `patValidation` to `{ status: "idle" }` immediately, cancelling any in-flight validation
- **Bug 3**: `VALIDATE_PAT_SUCCESS` action stores `warnings` array in `patValidation` state
- **Bug 4 (reclassified)**: submission still requires `selectedContributors.length > 0` (`SUBMIT_START` is a no-op otherwise) — this is the correct business rule, not a bug. The dead-end concern is addressed by Bug 1's fix instead.

#### 2. Reducer unit tests

**File**: `tests/unit/wizard-reducer.test.ts` (new file)

**Intent**: Test the reducer as a pure function — dispatch actions, assert resulting state. Cover all transitions, guard conditions, and the 4 bug fixes. No DOM, no mocks.

**Contract**: Test cases include:
- Step 1 → 2 transition: requires valid patValidation.status and non-empty name
- Step 1 → 2 rejected: invalid PAT → state stays at step 1
- Step 2 → 1 back: preserves name, pat, selectedRepos
- Step 2 → 3 transition: requires selectedRepos.length > 0
- Step 3 → 2 back: clears selectedContributors (Bug 1 fix)
- PAT change resets validation to idle (Bug 2 fix)
- PAT validation success stores warnings (Bug 3 fix)
- Step 3 rejects `SUBMIT_START` with empty selectedContributors (Bug 4 reclassified — business rule, not a bug); succeeds once at least one contributor is selected
- Invalid transitions are no-ops (e.g., NEXT_TO_STEP_3 from step 1)

### Success Criteria:

#### Automated Verification:

- `npm test -- tests/unit/wizard-reducer.test.ts` passes
- TypeScript compiles: `npm run lint`
- Reducer is a pure function: no side effects, no async

#### Manual Verification:

- Review reducer logic: transitions match the wizard's intended flow
- Review bug fix assertions: each bug has at least one test that would fail without the fix

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 6: Component Refactor

### Overview

Wire the `wizardReducer` into `CreateBoardForm`, replacing 17 `useState` hooks with a single `useReducer` call. Async operations (PAT validation, repo fetching, collaborator fetching, form submission) dispatch actions to the reducer.

### Changes Required:

#### 1. Refactor CreateBoardForm state management

**File**: `src/components/CreateBoardForm.tsx`

**Intent**: Replace all 17 `useState` hooks (lines 48-79) with `const [state, dispatch] = useReducer(wizardReducer, initialState)`. Replace direct `setState` calls with `dispatch(action)` calls. Move interface definitions (`PatValidation`, `RepoItem`, `CollaboratorItem`) to the shared `wizard-reducer.ts` and import them. Keep the existing JSX structure and event handlers — only the state management plumbing changes.

**Contract**:
- The component imports `wizardReducer`, `initialState`, and all types from `./wizard-reducer`
- All `useState` hooks are removed; state is accessed via `state.fieldName`
- Step transitions dispatch `NEXT_TO_STEP_2`, `BACK_TO_STEP_1`, `NEXT_TO_STEP_3`, `BACK_TO_STEP_2`
- Async operations (fetch, validate) dispatch start/success/error action pairs
- The `useRef` hooks for `patDebounceTimer` and `lastFetchedPat` can remain as refs or move into effect cleanup — implementer's choice
- Bug 1: `BACK_TO_STEP_2` now clears selectedContributors automatically via reducer
- Bug 2: `SET_PAT` resets patValidation; the debounced validation effect dispatches `VALIDATE_PAT_START`/`SUCCESS`/`ERROR`
- Bug 3: `VALIDATE_PAT_SUCCESS` stores warnings in state; the UI renders them (e.g., a warning banner in step 2)
- Bug 4 (reclassified): Submit button in step 3 stays disabled with 0 selectedContributors, matching the pre-existing business rule; the dead-end concern is resolved by Bug 1's fix to Back navigation

### Success Criteria:

#### Automated Verification:

- TypeScript compiles: `npm run lint`
- Build succeeds: `npm run build`
- React Compiler lint rule passes (no `react-compiler/react-compiler` errors)

#### Manual Verification:

- Create a board: step 1 (name + PAT) → step 2 (repos) → step 3 (contributors) → submit → redirect
- Back navigation: step 3 → step 2 → change repos → step 3 → contributors list is fresh (Bug 1 fixed)
- PAT change: enter PAT → validation starts → change PAT mid-validation → previous validation cancelled (Bug 2 fixed)
- Warnings displayed: use a PAT with limited scopes → warnings shown in step 2 (Bug 3 fixed)
- Empty contributors: select repos with no collaborators → Create Board stays disabled; Back → pick different repos → contributors available (Bug 4 reclassified, Bug 1 provides the escape path)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 7: Component Test Adaptation

### Overview

Update the existing component tests (W1-W9) to assert correct behavior instead of documenting bugs. The test file structure stays; assertions change from "documents Bug X" to "verifies correct behavior."

### Changes Required:

#### 1. Adapt component test assertions

**File**: `tests/component/CreateBoardForm.test.tsx`

**Intent**: Update test assertions that currently document bugs to assert the fixed behavior. Remove "Known bug" and "Bug N" inline comments. Update mock setup if the component now dispatches actions instead of calling setState directly. The render → interact → assert pattern stays the same; only the expected outcomes change.

**Contract**: Key assertion changes:
- **W6 (Bug 1)**: Currently asserts stale selectedContributors persist → now asserts selectedContributors are cleared after back-to-step-2 navigation
- **Bug 2 tests** (if present): Assert PAT validation resets on PAT change, no stale state
- **Bug 3 tests** (if present): Assert warnings are rendered in the UI after PAT validation
- **Bug 4 tests** (if present): Assert `SUBMIT_START`/Create Board remains blocked with zero selectedContributors (reclassified as required business rule, not a bug)

The mock `fetch` setup may need updating if the component's fetch call patterns changed (e.g., if warnings are now stored in state, the mock must return warnings in the validate-pat response).

### Success Criteria:

#### Automated Verification:

- `npm test -- tests/component/CreateBoardForm.test.tsx` passes
- Zero "Known bug" or "Known defect" comments in the file
- `npm run lint` passes

#### Manual Verification:

- Review that each bug fix has at least one test that would fail if the bug regressed
- Cross-check: the test count is equal to or greater than the original W1-W9

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 8: REVOKE ALL Migration

### Overview

Add `REVOKE ALL FROM anon, authenticated` for all 7 tables. Review and fill any policy gaps so that every operation is either explicitly allowed by a policy or denied by the revocation.

### Changes Required:

#### 1. New migration file

**File**: `supabase/migrations/YYYYMMDDHHMMSS_revoke_all_hardening.sql`

**Intent**: Bring all 7 tables into compliance with the project convention from `lessons.md`: "Every new table migration must include `REVOKE ALL ON <table> FROM anon, authenticated` before the RLS policies." Since these tables already have RLS enabled and policies defined, we only need to add the REVOKE statements. Existing policies remain unchanged — they already define the allowed operations.

**Contract**: The migration executes, for each table:

```sql
REVOKE ALL ON public.<table> FROM anon, authenticated;
```

Tables (7): `boards`, `board_members`, `github_repos`, `github_pull_requests`, `github_reviews`, `github_review_comments`, `board_contributors`.

After REVOKE, the `authenticated` role can only access these tables through the existing RLS policies (which use `GRANT ... TO authenticated` implicitly via Supabase's default setup). Since Supabase's PostgREST uses `SET ROLE authenticated` and RLS is enabled, the REVOKE changes the privilege path but not the effective access — this is defense-in-depth.

Policy completeness review per table:

| Table | SELECT | INSERT | UPDATE | DELETE | Gap? |
|-------|--------|--------|--------|--------|------|
| boards | `boards_select` + `boards_select_owner` | `boards_insert` | `boards_update` | `boards_delete` | No |
| board_members | `board_members_select` | `board_members_insert` | — | `board_members_delete` | UPDATE missing — acceptable, members are immutable |
| github_repos | `github_repos_select` | `github_repos_insert` | `github_repos_update` | `github_repos_delete` | No |
| github_pull_requests | all 4 ops covered | | | | No |
| github_reviews | all 4 ops covered | | | | No |
| github_review_comments | all 4 ops covered | | | | No |
| board_contributors | `board_contributors_select` | `board_contributors_insert` | — | `board_contributors_delete` | UPDATE missing — acceptable, contributors are append-only |

No policy gaps need filling. The missing UPDATE policies on `board_members` and `board_contributors` are by design — these rows are created and deleted, never updated. After REVOKE, authenticated can't UPDATE them regardless.

The migration also re-GRANTs the necessary table-level privileges so RLS policies work:

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.<table> TO authenticated;
```

This is required because `REVOKE ALL` removes the privilege to even attempt the operation — RLS can only filter within granted privileges.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npx supabase db reset`
- `npm test` passes — all integration tests still pass (access-boundary, pat-leak)
- Existing RLS behavior unchanged: cross-board isolation tests pass without modification

#### Manual Verification:

- In Supabase Studio, verify each table shows REVOKE in privilege list
- Create a board through the UI → all operations succeed (GRANT + RLS working together)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 9: Logger Redaction + Test Cleanup

### Overview

Replace the bare consola re-export with a redaction wrapper. Update access-boundary tests to remove "gap verification" framing now that REVOKE ALL is applied.

### Changes Required:

#### 1. Logger redaction wrapper

**File**: `src/lib/logger.ts`

**Intent**: Replace the single-line re-export (`export { consola as logger } from "consola"`) with a thin wrapper that scrubs known sensitive patterns from log output before passing to consola. Covers the Risk #2 leak vectors identified in `pat-leak.test.ts`.

**Contract**: The wrapper redacts these patterns (replacing with `[REDACTED]`):
- `ghp_[A-Za-z0-9_]{36,}` — classic GitHub PAT format
- `github_pat_[A-Za-z0-9_]{22,}` — fine-grained GitHub PAT format
- `sbp_[a-f0-9]{40,}` — Supabase service-role key format

The exported `logger` object exposes `info`, `warn`, `error`, `debug` methods matching consola's API surface. Each method redacts the first argument (string) before delegating to consola.

#### 2. Update access-boundary test framing

**File**: `tests/integration/access-boundary.test.ts`

**Intent**: Remove the "REVOKE ALL gap verification" section (lines ~397-460) or reframe it. The 7 tests that documented the gap now verify the hardened state. Remove the block comment (lines 397-403) that explained the gap. The test assertions themselves may stay unchanged — they verify cross-board denial, which is still true. Only the framing comment and describe block name change.

**Contract**: The describe block changes from "REVOKE ALL gap verification" to something like "REVOKE ALL + RLS enforcement" (or remove the separate section entirely and fold the tests into the main cross-board isolation suite). Remove the comment about "known gap."

#### 3. Verify pat-leak tests still pass

**File**: `tests/integration/pat-leak.test.ts`

**Intent**: The logger redaction should make the pat-leak tests more robust — the server output now redacts PAT patterns even if a catch block accidentally logs the raw token. Verify the existing tests still pass without changes.

**Contract**: No changes to `pat-leak.test.ts` in this phase. The tests should pass as-is; if the logger redaction changes output format, adapt assertions.

### Success Criteria:

#### Automated Verification:

- `npm test` passes — all test suites green
- `npm run lint` passes
- Zero "gap verification" or "known gap" comments in test files
- Logger unit test (optional): import logger, log a string containing a PAT → output contains `[REDACTED]`

#### Manual Verification:

- Start dev server, trigger a sync with invalid PAT → server output shows `[REDACTED]` instead of raw token
- Review access-boundary test names: no "gap" language remaining

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- `tests/unit/wizard-reducer.test.ts` — pure function tests for wizardReducer: transitions, guards, bug fixes
- Optional: `tests/unit/logger.test.ts` — redaction patterns

### Component Tests:

- `tests/component/CreateBoardForm.test.tsx` — adapted from existing W1-W9, now asserting correct behavior

### Hermetic Tests:

- `tests/hermetic/board-creation.test.ts` — rewritten for single-RPC contract

### Integration Tests:

- `tests/integration/access-boundary.test.ts` — updated framing, same assertions
- `tests/integration/pat-leak.test.ts` — updated setup (create_board_atomic), same leak assertions

### What's NOT tested:

- Service functions (getBoardWithRole etc.) — covered by integration tests indirectly
- Static pages — per test-plan §7 exclusions
- Generated types — per test-plan §7 exclusions

## Performance Considerations

- The `create_board_atomic` plpgsql function runs 4 operations in a single DB round-trip instead of 4 separate PostgREST calls. This reduces latency by ~3 round-trips.
- The `useReducer` has negligible performance difference vs 17 `useState` hooks — React batches updates in both cases. The discriminated union may improve DX by making invalid states unrepresentable.
- `REVOKE ALL` + re-GRANT has no runtime performance impact — it changes the privilege check path but not the query plan.

## Migration Notes

### Database migrations (expand/contract safe):

All migrations are additive:
- Phase 1: `CREATE FUNCTION create_board_atomic` + `DROP FUNCTION set_board_github_pat` — safe because the only production caller (POST /api/boards) is updated in the same PR
- Phase 8: `REVOKE ALL` + `GRANT` — changes privileges but not schema; fully reversible

### Rollback strategy:

- Phase 1: If the RPC has issues, revert the endpoint to the 4-step approach and re-create `set_board_github_pat` via a new migration
- Phase 8: Reversible by running the inverse GRANTs (though this would re-open the convention violation)

## References

- Frame brief: `context/changes/test-fix-gaps/frame.md`
- Research (board-creation): `context/changes/board-creation-contract/research.md`
- Research (access-boundary): `context/changes/testing-access-boundary/research.md`
- Archived MVP trade-off: `context/archive/2026-06-01-link-board-to-github-org/plan.md` (line 283)
- API endpoint: `src/pages/api/boards/index.ts:33-112`
- Wizard component: `src/components/CreateBoardForm.tsx`
- Logger: `src/lib/logger.ts:1`
- Service functions: `src/lib/services/boards.ts:61-131`
- Migrations: `supabase/migrations/20260529120000_access_control_and_membership.sql`, `20260531100000_github_ingestion_access.sql`, `20260602120000_board_contributors.sql`
- Trigger: `supabase/migrations/20260529130000_board_triggers.sql:28-47`
- Unique index: `supabase/migrations/20260529140000_boards_unique_name_per_owner.sql`
- Test plan: `context/foundation/test-plan.md` (§3 rollout, §6 cookbook)
- Lessons: `context/foundation/lessons.md` (REVOKE ALL rule)
- Roadmap: `context/foundation/roadmap.md` (S-08, S-10, S-11)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: plpgsql Migration

#### Automated

- [x] 1.1 Migration applies cleanly: `npx supabase db reset` — 4883af9
- [x] 1.2 `create_board_atomic` function exists in pg_proc — 4883af9
- [x] 1.3 `set_board_github_pat` removed from pg_proc — 4883af9
- [x] 1.4 `get_board_github_pat` still exists and works — 4883af9

#### Manual

- [x] 1.5 Atomic creation via SQL editor with test data succeeds — 4883af9
- [x] 1.6 Duplicate name returns 23505, no partial state — 4883af9
- [x] 1.7 Wrong user ID returns 42501 — 4883af9

### Phase 2: Endpoint Rewrite

#### Automated

- [x] 2.1 TypeScript compiles: `npm run lint` — ba63a51
- [x] 2.2 Build succeeds: `npm run build` — ba63a51
- [x] 2.3 No references to old service functions in index.ts — ba63a51

#### Manual

- [x] 2.4 Create board via UI → 201, appears on dashboard — ba63a51
- [x] 2.5 Duplicate name via UI → error displayed — ba63a51

### Phase 3: Dead Code Removal

#### Automated

- [x] 3.1 TypeScript compiles: `npm run lint` — a3f303c
- [x] 3.2 Build succeeds: `npm run build` — a3f303c
- [x] 3.3 No createBoard/addBoardContributors/BoardNameTakenError in src/ — a3f303c

#### Manual

- [x] 3.4 Dashboard page loads correctly — a3f303c
- [x] 3.5 Board detail page loads correctly — a3f303c

### Phase 4: API Test Updates

#### Automated

- [x] 4.1 `npm test` passes — all hermetic and integration tests green — 736453f
- [x] 4.2 Zero "Known defect" comments in hermetic tests — 736453f
- [x] 4.3 pat-leak tests pass with Supabase running — 736453f

#### Manual

- [x] 4.4 Review hermetic suite covers success, duplicate, failure, validation, auth cases — 736453f
- [x] 4.5 Review pat-leak suite: sentinel PAT absent from response and logs — 736453f

### Phase 5: Reducer Extraction + Unit Tests

#### Automated

- [x] 5.1 `npm test -- tests/unit/wizard-reducer.test.ts` passes — 6ee8f21
- [x] 5.2 TypeScript compiles: `npm run lint` — 6ee8f21
- [x] 5.3 Reducer is a pure function (no side effects) — 6ee8f21

#### Manual

- [x] 5.4 Review reducer transitions match wizard flow — 6ee8f21
- [x] 5.5 Review bug fix assertions (each bug has at least one test) — 6ee8f21

### Phase 6: Component Refactor

#### Automated

- [x] 6.1 TypeScript compiles: `npm run lint` — f70960a
- [x] 6.2 Build succeeds: `npm run build` — f70960a
- [x] 6.3 React Compiler lint rule passes — f70960a

#### Manual

- [x] 6.4 Full wizard flow: step 1 → 2 → 3 → submit → redirect — f70960a
- [x] 6.5 Bug 1: back from step 3, change repos, return → fresh contributors — f70960a
- [x] 6.6 Bug 2: change PAT mid-validation → previous cancelled — f70960a
- [x] 6.7 Bug 3: limited-scope PAT → warnings displayed — f70960a
- [x] 6.8 Bug 4 (reclassified): repos with no collaborators → Create Board stays disabled; Back lets you pick different repos — f70960a

### Phase 7: Component Test Adaptation

#### Automated

- [ ] 7.1 `npm test -- tests/component/CreateBoardForm.test.tsx` passes
- [ ] 7.2 Zero "Known bug"/"Known defect" comments in file
- [ ] 7.3 `npm run lint` passes

#### Manual

- [ ] 7.4 Each bug fix has at least one regression test
- [ ] 7.5 Test count ≥ original W1-W9

### Phase 8: REVOKE ALL Migration

#### Automated

- [ ] 8.1 Migration applies cleanly: `npx supabase db reset`
- [ ] 8.2 `npm test` passes — all integration tests green
- [ ] 8.3 Cross-board isolation tests unchanged and passing

#### Manual

- [ ] 8.4 Verify REVOKE in Supabase Studio privilege list
- [ ] 8.5 Board creation via UI still succeeds

### Phase 9: Logger Redaction + Test Cleanup

#### Automated

- [ ] 9.1 `npm test` passes — all test suites green
- [ ] 9.2 `npm run lint` passes
- [ ] 9.3 Zero "gap verification"/"known gap" comments in tests

#### Manual

- [ ] 9.4 Server output shows [REDACTED] for PAT patterns
- [ ] 9.5 Access-boundary test names have no "gap" language
