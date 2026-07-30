# Deferred Risk Gap Closure Implementation Plan

## Overview

Close test coverage gaps for three deferred risks promoted to active on 2026-07-09: IC-vs-EM data parity (#7), board-only deletion cascade (#8), and classification content retention (#9). Risk #10 (OAuth identity mismatch) is deferred to E2E Phase 8. AI Gateway `collectLog:true` content retention is out of scope — it is an infrastructure/compliance concern, not code-level testable.

## Current State Analysis

Phase 5 of the test plan rollout. Phases 1–4 shipped; Phase 3 was skipped (covered by Phase 1+2 patterns). The project has 32 test files across 4 layers (unit, component, hermetic, integration) plus a Playwright seed spec.

### Key Discoveries:

- **Risk #7**: `tests/integration/impact-access.test.ts` tests auth guard (200/403 status codes) but never compares IC vs EM response payloads. The service layer (`impact-metrics.ts`) has no role-based branching today — parity is structurally guaranteed but unprotected by assertion. All 5 impact endpoints (`summary.ts`, `author.ts`, `reviewer.ts`, `activity.ts`, `classifications.ts`) plus `threads` follow the same guard → service call pattern.
- **Risk #8**: `tests/integration/account-deletion.test.ts` tests user deletion cascade (admin API → board → children) across 7 child tables. No test exercises board-only DELETE through RLS as the authenticated owner — a different code path. The board DELETE handler (`src/pages/api/board/[boardId]/index.ts:30`) relies entirely on FK `ON DELETE CASCADE`.
- **Risk #9**: `tests/hermetic/classification-voting.test.ts` verifies `classifyThreads()` return shape (5 fields, no body), but never asserts what actually gets passed to the Supabase upsert call. `ClassificationResult` is the type upserted directly at `src/worker.ts:482-484`. The `thread_classifications` schema has no body column — structural defense, but unasserted.
- **Seed**: `seedTwoBoards()` in `tests/helpers/seed.ts` seeds boards, repos, PRs, reviews, comments, and board_contributors — but NOT `thread_classifications`. Both #7 (parity needs classified data to compare) and #8 (cascade must include classifications) need this extended.

## Desired End State

Every promoted deferred risk has at least one test that proves the protection described in the test plan's Risk Response Guidance table:

- **#7**: A test fetches the same contributor profile from all impact endpoints as both IC and EM, then asserts `icPayload === emPayload` field-by-field for each endpoint.
- **#8**: A test creates a board with full child data (7 tables), deletes the board as the authenticated owner via RLS, then asserts zero rows remain in all 7 child tables.
- **#9**: A hermetic test verifies that the object passed to `supabase.from("thread_classifications").upsert()` contains only `ClassificationResult` fields — no `body` or raw comment text.

Verification: `npm test` passes with the new tests included. CI `validate` and `test-integration` jobs remain green.

## What We're NOT Doing

- **Risk #10 (OAuth identity mismatch)** — deferred to E2E Phase 8, which tests the full signup → board access flow in a browser.
- **AI Gateway `collectLog:true` content retention** — this is a Cloudflare infrastructure configuration, not code-level testable from vitest. Document as an open risk for infra review.
- **Schema snapshot tests** for `thread_classifications` column list — fragile and low-signal given the schema already has no body column.
- **Integration test for #9** against a real DB — the structural defense (no column) plus the hermetic upsert assertion is sufficient; the cost of mocking the AI binding in integration context is not justified.

## Implementation Approach

Three phases, each delivering one test file (or test additions) for one risk. Phase 1 extends the shared seed helper first because both Phase 1 and Phase 2 depend on `thread_classifications` being part of the fixture. All phases follow existing cookbook patterns from test-plan §6.1 (integration) and §6.3 (hermetic).

## Phase 1: Seed Extension + IC-vs-EM Parity Test

### Overview

Extend `seedTwoBoards()` to include a `thread_classifications` row, then add an integration test that calls all impact endpoints as both the contributor (IC) and the board owner (EM) and compares response payloads.

### Changes Required:

#### 1. Extend seed helper

**File**: `tests/helpers/seed.ts`

**Intent**: Add a `thread_classifications` insert after the existing `github_review_comments` insert so the fixture includes classified data. This makes the seed useful for both the parity test (endpoints return richer data) and the board deletion cascade test (Phase 2).

**Contract**: Insert one row into `thread_classifications` with fields matching `ClassificationResult`: `thread_root_comment_id` (the existing `commentId`), `pull_request_id` (the existing `prId`), `intent` (any valid value e.g. `"mentoring"`), `domain` (any valid value e.g. `"functional"`), `model_id` (any string). Add `classificationCommentId` to the `TwoBoardFixture` return type for use in assertions.

#### 2. Add parity integration test

**File**: `tests/integration/impact-parity.test.ts` (new)

**Intent**: Prove that IC viewing their own profile and EM viewing the same profile receive identical JSON payloads from all impact endpoints — the data parity invariant from PRD NFR.

**Contract**: Follows the same pattern as `impact-access.test.ts`:

- Import all impact endpoint handlers (`summaryGET`, `authorGET`, `reviewerGET`, `activityGET`, `classificationsGET`, `threadsGET`).
- Mock `astro:env/server` and `@/lib/supabase` as in the existing test.
- Use `seedTwoBoards()` fixture.
- Build `makeContext(boardId, login)` helper returning minimal `APIContext` with params.
- For each endpoint in an `it.each`:
  1. Mock `createClient` to return `fixture.contributor.client` (IC), call handler, parse response JSON.
  2. Mock `createClient` to return `fixture.ownerA.client` (EM), call handler with same params, parse response JSON.
  3. `expect(icBody).toEqual(emBody)`.
- Guard with `describe.skipIf(!supabaseAvailable)`.

### Success Criteria:

#### Automated Verification:

- `seedTwoBoards()` inserts `thread_classifications` row without error
- Parity test passes for all 6 endpoints: `npx vitest run tests/integration/impact-parity.test.ts`
- Existing integration tests still pass: `npx vitest run tests/integration/`
- Type checking passes: `npm run test:typecheck`

#### Manual Verification:

- Confirm the test meaningfully exercises the endpoints by temporarily changing one mock to return a different role's client and observing a meaningful comparison (not two empty objects).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Board-Only Deletion Cascade

### Overview

Add an integration test that creates a board with full child data across all 7 child tables, deletes the board as the authenticated owner (RLS path), and asserts zero orphaned rows remain.

### Changes Required:

#### 1. Add board deletion integration test

**File**: `tests/integration/board-deletion.test.ts` (new)

**Intent**: Prove that board-only DELETE (not user delete) cascades through all 7 child tables, exercised through RLS as the authenticated board owner — the actual code path users take.

**Contract**: Follows §6.1 patterns with these specifics:

- Use `seedTwoBoards()` for Board A (the one with full child data, now including `thread_classifications` from Phase 1).
- In the test: call `fixture.ownerA.client.from("boards").delete().eq("id", fixture.ownerA.boardId)`.
- Assert via `adminClient` that zero rows remain in all 7 child tables, querying by their respective FK values:
  - `github_repos` by `board_id`
  - `board_contributors` by `board_id`
  - `board_members` by `board_id`
  - `github_pull_requests` by `repo_id`
  - `github_reviews` by `pull_request_id`
  - `github_review_comments` by `pull_request_id`
  - `thread_classifications` by `pull_request_id`
- Guard with `describe.skipIf(!supabaseAvailable)`.
- Cleanup: Board A is already deleted by the test; `afterAll` needs to clean up Board B and all three users only.

### Success Criteria:

#### Automated Verification:

- Board deletion cascade test passes: `npx vitest run tests/integration/board-deletion.test.ts`
- All integration tests pass: `npx vitest run tests/integration/`
- Type checking passes: `npm run test:typecheck`

#### Manual Verification:

- Confirm the test catches a real cascade gap by temporarily commenting out one FK CASCADE in a local migration and observing the test fail (then revert).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Classification Content Retention Guard

### Overview

Add a hermetic test asserting that the upsert payload sent to Supabase after classification contains only `ClassificationResult` fields — no `body`, `content`, or any raw comment text.

### Changes Required:

#### 1. Add retention guard to classification hermetic tests

**File**: `tests/hermetic/classification-voting.test.ts` (extend existing file)

**Intent**: Assert that every object in the array passed to `.upsert()` on the `thread_classifications` table contains exactly the 5 `ClassificationResult` fields and nothing else — guarding the no-retention invariant at the code boundary where data meets the database.

**Contract**: Add a new `it` block in the existing describe:

- Use the existing mock setup where `classifyThreads` is called with a mocked AI binding and a mock Supabase client.
- After `classifyThreads()` returns, inspect the result array.
- For each result object: `expect(Object.keys(result).sort()).toEqual(["domain", "intent", "model_id", "pull_request_id", "thread_root_comment_id"])`.
- This catches any future code change that adds `body` or other raw text fields to the classification result.

### Success Criteria:

#### Automated Verification:

- Retention guard test passes: `npx vitest run tests/hermetic/classification-voting.test.ts`
- All hermetic tests pass: `npx vitest run tests/hermetic/`
- Type checking passes: `npm run test:typecheck`

#### Manual Verification:

- Confirm the test catches a retention violation by temporarily adding a `body: "test"` field to a `ClassificationResult` in the service code and observing the test fail (then revert).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Integration Tests (Phase 1 + 2):

- IC-vs-EM parity across all 6 impact endpoints
- Board-only deletion cascade across all 7 child tables
- Both use real local Supabase with `describe.skipIf` guard

### Hermetic Tests (Phase 3):

- Classification upsert payload shape assertion
- Fully mocked, no external dependencies

### Edge Cases to Cover:

- Parity test: endpoints that return empty arrays (e.g. no activity data) — the parity holds trivially but should be compared anyway
- Board deletion: `board_members` auto-enrolled by trigger — cascade must clear these too
- Classification retention: result from a 3-way tie (dropped thread) — no result at all, not a result with body

## Performance Considerations

All new tests are lightweight:

- Parity test: 12 handler calls (6 endpoints × 2 roles) against local Supabase — ~1-2s
- Board deletion: 1 DELETE + 7 SELECT assertions — ~500ms
- Classification retention: pure in-memory assertion — ~50ms

No impact on CI run time beyond marginal seconds.

## References

- Test plan: `context/foundation/test-plan.md` §2 (Risk Map), §3 Phase 5, §6.1 (integration patterns), §6.3 (hermetic patterns)
- Existing parity groundwork: `tests/integration/impact-access.test.ts`
- Existing cascade pattern: `tests/integration/account-deletion.test.ts`
- Existing classification tests: `tests/hermetic/classification-voting.test.ts`
- Seed helper: `tests/helpers/seed.ts`
- Impact endpoints: `src/pages/api/board/[boardId]/impact/[login]/*.ts`
- Board DELETE handler: `src/pages/api/board/[boardId]/index.ts:12-38`
- Classification service: `src/lib/services/classification.ts:128-134` (`ClassificationResult`)
- Worker upsert: `src/worker.ts:482-484`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Seed Extension + IC-vs-EM Parity Test

#### Automated

- [x] 1.1 seedTwoBoards() inserts thread_classifications row without error — 14a7ded
- [x] 1.2 Parity test passes for all 6 endpoints — 14a7ded
- [x] 1.3 Existing integration tests still pass — 14a7ded
- [x] 1.4 Type checking passes — 14a7ded

#### Manual

- [x] 1.5 Confirm parity test exercises endpoints with real data (not empty comparisons) — 14a7ded

### Phase 2: Board-Only Deletion Cascade

#### Automated

- [x] 2.1 Board deletion cascade test passes
- [x] 2.2 All integration tests pass
- [x] 2.3 Type checking passes

#### Manual

- [x] 2.4 Confirm test catches cascade gap by temporarily removing a FK CASCADE

### Phase 3: Classification Content Retention Guard

#### Automated

- [x] 3.1 Retention guard test passes
- [x] 3.2 All hermetic tests pass
- [x] 3.3 Type checking passes

#### Manual

- [x] 3.4 Confirm test catches retention violation by temporarily adding body field
