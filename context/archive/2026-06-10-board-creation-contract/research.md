---
date: "2026-06-10T10:53:17Z"
researcher: Claude (AI)
git_commit: e9208078adacadb9675f090bf0435960cc8a15ef
branch: board-creation-contract
repository: GitGud
topic: "Board creation contract: API orchestration, DB transactions, and wizard state machine"
tags: [research, codebase, board-creation, transactions, wizard, partial-failure]
status: complete
last_updated: "2026-06-10"
last_updated_by: Claude (AI)
---

# Research: Board Creation Contract

**Date**: 2026-06-10T10:53:17Z
**Researcher**: Claude (AI)
**Git Commit**: e9208078adacadb9675f090bf0435960cc8a15ef
**Branch**: board-creation-contract
**Repository**: GitGud

## Research Question

What does the board creation contract look like end-to-end (wizard state machine + API orchestration), with a focus on DB transaction boundaries and partial-failure modes? This research serves test-plan Phase 2 (risks #3 and #4).

## Summary

The board creation flow has two independent surfaces — a 3-step React wizard (`CreateBoardForm.tsx`) and a 4-step API endpoint (`POST /api/boards`). Neither surface uses a database transaction wrapping multiple operations; the Supabase JS client (`@supabase/supabase-js@2.105.3`) provides no multi-call transaction API. Each `.from()` / `.rpc()` call is a separate HTTP request to PostgREST, each in its own DB transaction.

Key findings:

1. **Step 2 (PAT storage) failure orphans the board with no cleanup** — the user gets 500 but the board persists, blocking retries via the unique name constraint.
2. **Step 3 (repo linking) failure is silently swallowed** — the endpoint returns 201 but the board has zero repos.
3. **Step 4 (contributors) failure does trigger cleanup** — the board is deleted with ON DELETE CASCADE. But if the cleanup delete itself fails, the board is orphaned.
4. **Wizard has stale-selection bugs** — going back and changing PAT or repos does not clear `selectedContributors`, leading to phantom contributor submissions.
5. **PAT validation has a race condition** — an in-flight validation response can mark the PAT "valid" after the user has changed the input, allowing the user to proceed with a mismatched PAT.

## Detailed Findings

### 1. API Orchestration Sequence (`POST /api/boards`)

The endpoint at `src/pages/api/boards/index.ts:33-112` performs 4 sequential operations. Each is a separate HTTP request to PostgREST — there is no wrapping DB transaction.

| Step | Operation           | Call site                                 | DB table/function                                 | Atomic scope                               |
| ---- | ------------------- | ----------------------------------------- | ------------------------------------------------- | ------------------------------------------ |
| 1    | Insert board        | `index.ts:60` via `boards.ts:33-47`       | `boards` INSERT + trigger inserts `board_members` | Single PostgREST tx (board + trigger)      |
| 2    | Store encrypted PAT | `index.ts:62-69`                          | `set_board_github_pat` RPC (UPDATE on `boards`)   | Single PostgREST tx (function body)        |
| 3    | Link repos          | `index.ts:72-82`                          | `github_repos` batch INSERT                       | Single PostgREST tx (one INSERT statement) |
| 4    | Add contributors    | `index.ts:84-102` via `boards.ts:116-131` | `board_contributors` batch INSERT                 | Single PostgREST tx (one INSERT statement) |

#### Trigger: auto-membership

After step 1, the `boards_insert_owner_as_member` AFTER INSERT trigger (`20260529130000_board_triggers.sql:44-47`) inserts the owner into `board_members`. This runs in the same PostgreSQL transaction as the board INSERT — if the trigger fails, the board INSERT rolls back. The trigger uses `ON CONFLICT DO NOTHING` and is SECURITY DEFINER, so it is reliable and idempotent.

### 2. Partial-Failure Scenario Matrix

| Scenario                            | Steps completed          | User response                                 | DB state                                               | Retry blocked?           |
| ----------------------------------- | ------------------------ | --------------------------------------------- | ------------------------------------------------------ | ------------------------ |
| S1: Step 1 fails (unique name)      | None                     | 409 "You already have a board with that name" | Clean                                                  | No                       |
| S2: Step 1 fails (other)            | None                     | 500 generic                                   | Clean                                                  | No                       |
| **S3: Step 2 fails (PAT storage)**  | Board + member           | 500 "Failed to store GitHub token"            | **Orphaned board** (no PAT, no repos, no contributors) | **Yes — name taken**     |
| **S4: Step 3 fails (repo linking)** | Board + PAT              | **201 success**                               | Board exists **without repos**                         | No (but data incomplete) |
| S5: Step 4 fails, cleanup succeeds  | All created then deleted | 500 generic                                   | Clean                                                  | No                       |
| **S6: Step 4 fails, cleanup fails** | Board + PAT + repos      | 500 generic                                   | **Orphaned board** (no contributors)                   | **Yes — name taken**     |

#### S3 detail: PAT failure orphans with no cleanup

At `index.ts:67-69`, on PAT error the handler returns 500 immediately without deleting the board created in step 1. This is an asymmetry with step 4's cleanup. The orphaned board blocks retries because of the unique index `boards_owner_name_unique ON (owner_user_id, lower(trim(name)))` at `20260529140000_boards_unique_name_per_owner.sql:4-5`.

#### S4 detail: Repo failure silently swallowed

At `index.ts:80-82`, `reposError` is logged as `logger.warn` but execution continues. The endpoint returns 201, the user is redirected to the new board, and the board has zero repos. The user has no indication that repo linking failed.

#### S5/S6 detail: Contributor failure triggers cleanup

At `index.ts:94-102`, on contributor failure the handler deletes the board via `supabase.from("boards").delete().eq("id", boardId)`. ON DELETE CASCADE removes board_members, github_repos, and board_contributors. The encrypted PAT is a column on the boards row itself — it is deleted with the row. If the delete fails (logged at line 99), the board is orphaned.

### 3. ON DELETE CASCADE Chain

Deleting from `boards(id)` cascades through:

```
boards
 ├── board_members      (ON DELETE CASCADE, 20260529120000:14)
 ├── github_repos       (ON DELETE CASCADE, 20260531100000:12)
 │    ├── github_pull_requests   (ON DELETE CASCADE, 20260531100000:26)
 │    │    ├── github_reviews             (ON DELETE CASCADE, 20260531100000:45)
 │    │    └── github_review_comments     (ON DELETE CASCADE, 20260531100000:59)
 │    │         └── review_id FK          (ON DELETE SET NULL, 20260531100000:60)
 │    └── (no further children)
 ├── board_contributors (ON DELETE CASCADE, 20260602120000:7)
 └── boards.github_pat_encrypted  (column, deleted with row)
```

The cascade is complete — deleting the board cleans up everything.

### 4. Supabase/PostgREST Transaction Capabilities

**Installed versions**: `@supabase/supabase-js@2.105.3`, `@supabase/postgrest-js@2.105.3`, `@supabase/ssr@0.10.3`.

#### What IS atomic

- A single `.insert([...array...])` call with multiple rows executes as one INSERT statement inside one PostgREST transaction. All-or-nothing.
- A trigger fired by an INSERT runs in the same transaction as the triggering statement.
- A `.rpc()` call's function body runs in a single PostgREST transaction.

#### What IS NOT atomic

- Steps 1-4 as a whole. Each step is a separate HTTP request with its own transaction.
- The cleanup delete (step 4 catch) is a separate transaction from the original inserts.
- There is no `supabase.transaction()` or `beginTx()` API in supabase-js. The only way to get cross-step atomicity is to write a plpgsql function that does all the work and call it via `.rpc()`.

#### Implication for testing

The non-atomic sequence means **hermetic tests (stubbed client) are the appropriate layer for partial-failure branches**. This aligns with test-plan guidance: "A non-atomic save sequence means: write hermetic tests for partial-failure branches, not integration tests that force a mid-sequence error."

### 5. Wizard State Machine (`CreateBoardForm.tsx`)

The wizard manages a 3-step flow with 17 `useState` hooks and 2 `useRef` hooks (`CreateBoardForm.tsx:48-79`).

#### State carried across steps

| Variable               | Entered at | Used at                     | Final submit field |
| ---------------------- | ---------- | --------------------------- | ------------------ |
| `name`                 | Step 1     | Submit                      | `name`             |
| `pat`                  | Step 1     | Steps 2, 3 fetches + Submit | `pat`              |
| `selectedRepos`        | Step 2     | Step 3 fetch + Submit       | `repos`            |
| `selectedContributors` | Step 3     | Submit                      | `contributors`     |

#### Step transition guards

| Transition                            | Guards                                                                                                         | Side effects                                                   |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 1 → 2 (`handleNext`, line 189)        | `name` non-empty + `nameError` falsy + `patValidation.status === "valid"` + async name-uniqueness check passes | Clears `apiError`; fetches repos if PAT changed or repos empty |
| 2 → 3 (`handleNextToStep3`, line 230) | `selectedRepos.length > 0`                                                                                     | Clears `apiError`; always fetches collaborators                |
| 2 → 1 (`handleBack`, line 220)        | None                                                                                                           | Clears `apiError` only; all step 2 state preserved             |
| 3 → 2 (`handleBackToStep2`, line 225) | None                                                                                                           | Clears `apiError` only; all step 3 state preserved             |

#### Step bypass

Not possible via UI — `handleCreate()` is only callable from the step 3 button, which renders conditionally. The API validates all required fields server-side as a backstop.

### 6. Wizard Bugs Found

#### Bug 1: Stale `selectedContributors` on PAT/repo change

**Location**: `CreateBoardForm.tsx:225-235`

When navigating back and changing the PAT (step 1) or repo selection (step 2), `selectedContributors` is never cleared. The collaborator list refreshes on forward navigation (step 2→3), but previously-selected contributors persist. These stale entries:

- Won't have matching checkboxes in the new collaborator list (can't be deselected via UI)
- Will still appear in the count badge (`CreateBoardForm.tsx:659`)
- Will be included in the final submit payload

#### Bug 2: PAT validation race condition

**Location**: `CreateBoardForm.tsx:86-130`

Sequence: user enters valid PAT → waits >500ms (fetch fires) → types another character before response arrives → first fetch resolves and sets `patValidation.status = "valid"` → user can click "Next" because `nextDisabled` (line 324) only checks `patValidation.status`, not whether the validated token matches the current `pat` value.

The second fetch fires 500ms later and corrects the state, but during the window the user could proceed with a mismatched PAT.

#### Bug 3: Collaborator warnings silently discarded

**Location**: `CreateBoardForm.tsx:172-176`

The response type includes `warnings?: { repo: string; message: string }[]` but the value is never read or displayed. If some repos return GitHub 202 "stats still computing", the user sees a partial collaborator list with no indication that data is incomplete.

#### Bug 4: Empty collaborators dead-end

**Location**: `CreateBoardForm.tsx:666-670`

If all repos return zero collaborators, the user sees "No collaborators found" with no retry option or explanation. The "Create Board" button is disabled (min 1 contributor required). The user can only go back and change repos.

### 7. Data Flow: Wizard → API → DB

```
CreateBoardForm state                    POST /api/boards body              DB operations
─────────────────────                    ──────────────────────              ─────────────
name (step 1)              ───→          name: string                 ───→  INSERT boards (name, owner_user_id)
                                                                            + trigger INSERT board_members
pat (step 1)               ───→          pat: string                  ───→  RPC set_board_github_pat (UPDATE boards)
selectedRepos (step 2)     ───→          repos: [{owner, name}]      ───→  INSERT github_repos (board_id, repo_owner, repo_name, connected_by)
selectedContributors (3)   ───→          contributors: [{githubId,   ───→  INSERT board_contributors (board_id, github_id,
                                           githubLogin, avatarUrl}]          github_login, avatar_url)
```

Zod validation at `index.ts:26-31` enforces: name 1-80 chars, pat min 1, repos min 1, contributors min 1 max 200.

## Code References

- `src/pages/api/boards/index.ts:33-112` — Board creation API endpoint (4-step orchestration)
- `src/pages/api/boards/index.ts:62-69` — PAT storage with no cleanup on failure
- `src/pages/api/boards/index.ts:72-82` — Repo linking with silent failure
- `src/pages/api/boards/index.ts:84-102` — Contributor insert with cleanup-on-failure
- `src/lib/services/boards.ts:33-47` — `createBoard()` service function
- `src/lib/services/boards.ts:116-131` — `addBoardContributors()` service function
- `src/components/CreateBoardForm.tsx:47-79` — Wizard state declarations
- `src/components/CreateBoardForm.tsx:86-130` — PAT validation with race condition
- `src/components/CreateBoardForm.tsx:189-218` — Step 1→2 transition with repo refresh logic
- `src/components/CreateBoardForm.tsx:225-235` — Back transitions (no contributor state cleanup)
- `src/components/CreateBoardForm.tsx:293-322` — Final submit handler
- `supabase/migrations/20260529120000_access_control_and_membership.sql` — boards + board_members schema + RLS
- `supabase/migrations/20260529130000_board_triggers.sql:28-47` — Auto-membership trigger
- `supabase/migrations/20260529140000_boards_unique_name_per_owner.sql` — Unique name constraint
- `supabase/migrations/20260531100000_github_ingestion_access.sql:111-125` — PAT encryption RPC
- `supabase/migrations/20260602120000_board_contributors.sql` — board_contributors schema + RLS

## Architecture Insights

1. **No multi-call transactions via supabase-js.** The JS client has no transaction API. Each HTTP call is its own DB transaction. The only path to atomicity across steps would be a plpgsql function called via `.rpc()`. The current code does not use this pattern for the orchestration sequence.

2. **Cleanup uses application-level compensation, not DB rollback.** Step 4's catch block manually deletes the board (cascading to children). This is a compensation pattern, not a transaction rollback. Steps 2 and 3 have no compensation.

3. **Asymmetric error handling across steps.** Step 2 failure: returns 500, no cleanup. Step 3 failure: continues (201), no cleanup. Step 4 failure: cleanup + 500. This asymmetry is the core defect the test contract must document.

4. **Wizard state is flat React useState.** No state machine library, no reducer. Step transitions are guarded by inline conditions in handler functions. Backward navigation preserves all state, which causes stale-selection bugs.

## Historical Context

- `context/archive/2026-06-01-link-board-to-github-org/plan.md` — Documents the original orchestration design: "If PAT storage or repo linking fails after board creation, the board still exists — acceptable for MVP (no transaction rollback across RPC + table inserts)." The current contributor cleanup was added later (S-03) but the PAT/repo gaps were accepted as MVP trade-offs.
- `context/archive/2026-05-29-board-create-with-em-role/plan.md` — Original board creation plan; no transaction discussion.
- `context/foundation/test-plan.md §2` — Risk #4 specifically calls out: "POST /api/boards inserts board, stores PAT, links repos, stores contributors in sequence; partial failure leaves orphaned data with no rollback."

## Test Contract (what tests must prove)

### Risk #4: API partial-failure — hermetic tests (stubbed client)

| #   | Scenario                               | Expected outcome                                                    | Stub setup                                                  |
| --- | -------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------- |
| H1  | Happy path: all 4 steps succeed        | 201, `{ id }` returned                                              | All calls return success                                    |
| H2  | Step 1 fails (unique name, code 23505) | 409, "You already have a board with that name", no orphan           | `createBoard` throws `BoardNameTakenError`                  |
| H3  | Step 2 fails (PAT storage)             | 500, board persists (orphan — documents current defect)             | `rpc` returns `{ error }`                                   |
| H4  | Step 3 fails (repo linking)            | 201 (silent success — documents current defect), board has no repos | `from("github_repos").insert` returns `{ error }`           |
| H5  | Step 4 fails, cleanup succeeds         | 500, board deleted (cascade verified)                               | `addBoardContributors` throws; `delete` returns success     |
| H6  | Step 4 fails, cleanup fails            | 500, board persists (orphan)                                        | `addBoardContributors` throws; `delete` returns `{ error }` |
| H7  | Validation: missing/invalid fields     | 400 with specific message                                           | N/A (no stub needed)                                        |
| H8  | Auth: no session                       | 401                                                                 | `getUser` returns `{ data: { user: null } }`                |

### Risk #4: API happy path — integration test (real Supabase)

| #   | Scenario                            | Expected outcome                                                                     |
| --- | ----------------------------------- | ------------------------------------------------------------------------------------ |
| I1  | Full board creation with valid data | 201; board, board_member, PAT (encrypted), repos, contributors all exist in DB       |
| I2  | Duplicate board name                | 409; no orphaned rows                                                                |
| I3  | Bulk insert atomicity (repos)       | Either all repos inserted or none (constraint violation on one repo fails the batch) |

### Risk #3: Wizard state machine — component tests (vitest + testing-library)

| #   | Scenario                                 | Expected outcome                                                                |
| --- | ---------------------------------------- | ------------------------------------------------------------------------------- |
| W1  | Step 1→2: name empty                     | Blocked, error shown                                                            |
| W2  | Step 1→2: PAT not validated              | "Next" disabled                                                                 |
| W3  | Step 1→2→3→submit: complete flow         | POST body contains correct data from all 3 steps                                |
| W4  | Step 2→1→2: PAT changed                  | `selectedRepos` cleared, repos re-fetched                                       |
| W5  | Step 3→2→3: repos changed                | Collaborators re-fetched                                                        |
| W6  | Step 3→2→3: stale contributors           | `selectedContributors` still contains entries from old repo set (documents bug) |
| W7  | Step 2: no repos selected                | "Next" disabled                                                                 |
| W8  | Step 3: no contributors selected         | "Create Board" disabled                                                         |
| W9  | Step 3: empty collaborator list from API | "No collaborators found" shown, submit disabled                                 |

## Open Questions

1. **Should S3 (PAT failure orphan) be fixed before or during the test phase?** The test can document the defect, but a fix (add cleanup delete on PAT failure, mirroring step 4's pattern) is a one-line change. Fixing first means the test asserts correct behavior; documenting first means the test locks in the current behavior as a known defect.

2. **Should S4 (silent repo failure) be fixed?** Returning 201 when repos fail is a deliberate MVP trade-off (per archived plan). Tests should document this as a known behavior, but should the test assert 201 (current) or 500 (desired)?

3. **Is the PAT validation race condition (Bug 2) in scope for Phase 2?** It's a wizard state bug but not listed in risk #3's description. It could cause the user to submit with a different PAT than the one validated.
