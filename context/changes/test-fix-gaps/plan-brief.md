# Test Fix Gaps — Plan Brief

> Full plan: `context/changes/test-fix-gaps/plan.md`
> Frame brief: `context/changes/test-fix-gaps/frame.md`

## What & Why

The board creation flow has two structurally fragile systems — a non-atomic API sequence (4 separate PostgREST calls, each in its own DB transaction) and a flat-state wizard (17 `useState` hooks with no formal transitions) — whose symptoms were documented as 10 individual defects across 4 test files. Fixing the two structural roots eliminates all 10 symptoms and prevents recurrence as S-08/S-10/S-11 ship.

## Starting Point

POST `/api/boards` runs 4 sequential operations with inconsistent compensation: PAT failure orphans the board (S3), repo failure is silently swallowed (S4), cleanup failure orphans the board (S6). The wizard has 4 bugs stemming from ad-hoc state transitions. All 7 tables lack `REVOKE ALL FROM authenticated`. The logger has zero redaction.

## Desired End State

A single `create_board_atomic` plpgsql function replaces the 4-step sequence — any failure rolls back everything. The wizard uses `useReducer` with a discriminated union state type, making invalid transitions unrepresentable. All tables have `REVOKE ALL` + re-GRANT with RLS. The logger redacts known sensitive patterns. All "Known defect" markers in tests are replaced with correct-behavior assertions.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| RPC scope | Full atomic (all 4 ops) | Eliminates every partial-failure defect in one move; JSONB params for repos/contributors are acceptable | Plan |
| Change structure | One plan, three PRs | Keeps shared context; each scope ships independently | Plan |
| PAT encryption key | Keep as parameter | Zero infrastructure change; matches existing `set_board_github_pat` pattern | Plan |
| Wizard state mgmt | useReducer + discriminated union | Zero new deps; TypeScript enforces valid transitions; React Compiler compatible | Plan |
| API error shape | Generic only | Atomicity means "just retry"; step-level detail in server logs only | Plan |
| RPC auth check | Function validates ownership | Defense in depth — auth.uid() check inside the SECURITY DEFINER function | Plan |
| Hermetic tests | Rewrite from scratch | Old mocks for 4-step chain don't map to single-RPC contract | Plan |
| Old RPCs | Drop set_, keep get_ | set_ only used by POST /api/boards (+ tests); get_ used by /api/github/sync | Frame |
| REVOKE scope | REVOKE ALL + policy gap review | Complete hardening in one pass; no gaps found after review | Plan |
| Logger | Fixed redaction set | Simple, covers known leak vectors (ghp_, github_pat_, sbp_) | Plan |
| Service fn filtering | Defer to RLS only | RLS is the access control layer by design; no app-layer changes needed | Plan |
| Component tests | Adapt existing W1-W9 | Test structure (render→interact→assert) stays valid; only assertions change | Plan |

## Scope

**In scope:**
- `create_board_atomic` plpgsql function + migration
- POST `/api/boards` endpoint rewrite to single `.rpc()` call
- Dead code removal (createBoard, addBoardContributors, BoardNameTakenError, set_board_github_pat)
- Wizard `useReducer` refactor fixing Bugs 1-4
- Hermetic test rewrite, component test adaptation, pat-leak test update
- `REVOKE ALL` migration for all 7 tables
- Logger redaction wrapper
- Access-boundary test framing cleanup

**Out of scope:**
- App-layer userId filtering in service functions (RLS is sufficient)
- XState or state machine library (useReducer is sufficient)
- Structured API error codes
- E2E tests
- Dropping `get_board_github_pat`

## Architecture / Approach

Three independent PRs from one change folder. PR 1 (API) creates a plpgsql function that wraps all 4 board-creation operations in a single transaction, then rewrites the endpoint and tests. PR 2 (Wizard) extracts a pure reducer function, wires it into the component, and adapts tests. PR 3 (Infra) adds REVOKE ALL + logger redaction. PRs 1 and 2 are independent; PR 3 is independent of both.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. plpgsql Migration | `create_board_atomic` function, drop `set_board_github_pat` | JSONB parameter handling for repos/contributors arrays |
| 2. Endpoint Rewrite | Single `.rpc()` call in POST /api/boards | Error code mapping (23505 → 409) |
| 3. Dead Code Removal | Remove unused service functions | Missed callers (verified: none) |
| 4. API Test Updates | Rewritten hermetic tests, updated pat-leak setup | Mock surface change (4-step → single RPC) |
| 5. Reducer Extraction | Pure wizardReducer + unit tests | State shape design — must carry data across steps correctly |
| 6. Component Refactor | useReducer in CreateBoardForm, Bugs 1-4 fixed | Async operations (fetch, validate) must dispatch correctly |
| 7. Component Test Adaptation | W1-W9 assert correct behavior | Mock setup may need updating for new dispatch patterns |
| 8. REVOKE ALL Migration | Hardened privileges on all 7 tables | Must re-GRANT after REVOKE so RLS policies still work |
| 9. Logger + Test Cleanup | Redaction wrapper, gap-verification framing removed | Regex patterns must not over-match or under-match |

**Prerequisites:** Local Supabase running (for migration + integration tests). All existing tests passing on main.
**Estimated effort:** ~3-4 sessions across 9 phases (3 PRs).

## Open Risks & Assumptions

- `pat-leak.test.ts` calls `set_board_github_pat` in setup — must be migrated to `create_board_atomic` before the function is dropped (handled in Phase 4)
- S-08 (edit-board-connection) will need a way to update PATs on existing boards — `create_board_atomic` only creates; a future `update_board_pat` RPC may be needed
- The `REVOKE ALL` + `GRANT` sequence assumes Supabase's PostgREST correctly uses `SET ROLE authenticated` — tested in integration tests

## Success Criteria (Summary)

- `npm test` passes with zero "Known defect" / "Known bug" markers across all test files
- Board creation wizard works end-to-end through the UI with no partial-failure states
- All 7 tables hardened with `REVOKE ALL FROM anon, authenticated`
