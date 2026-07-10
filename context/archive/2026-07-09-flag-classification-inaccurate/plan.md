# Thread Classification Voting Implementation Plan

## Overview

Add thumbs-up/thumbs-down voting on individual thread classifications so that board members can confirm correct classifications or exclude misclassified threads from metric aggregates (intent counts, domain counts, high-signal %). Both supervisors and contributors can vote; excluded threads (thumbs-down) are filtered from all metric computations.

## Current State Analysis

Thread classifications are stored in `thread_classifications` with columns `thread_root_comment_id` (PK), `pull_request_id`, `intent`, `domain`, `model_id`, `classified_at`. There is no feedback mechanism — once the AI classifies a thread, the classification is immutable and flows directly into all metrics.

The metrics pipeline is centralized: `get_board_classifications_for_commenter` RPC returns `(intent, domain)` rows, and `impact-metrics.ts:getClassificationAggregates` computes all three aggregates from that result set. A separate `get_homepage_stats` RPC computes platform-wide stats including `threads_classified` and `high_impact_percent` directly from the table.

The ThreadRow component in `ThreadsView.tsx` displays 6 columns (expand, comment, PR, intent, domain, date) with no interactive elements besides expand/collapse. The existing filter bar has 3 FilterDropdown components (Intent, Domain, Role).

### Key Discoveries:

- RLS on `thread_classifications`: SELECT requires `is_board_member`, INSERT/UPDATE/DELETE require `is_board_owner` — contributor voting needs a bypass via `SECURITY DEFINER` function (`supabase/migrations/20260618120000_thread_classifications.sql:23-38`)
- `get_board_classifications_for_commenter` feeds all three contributor-level metric aggregates (`src/lib/services/impact-metrics.ts:880-961`)
- `get_homepage_stats` independently queries `thread_classifications` for platform-wide stats (`supabase/migrations/20260629120000_homepage_stats_rpc.sql:16-66`)
- `get_board_classified_threads` + `get_board_classified_threads_count` power the paginated thread list; both need the vote column returned and a new filter param (`supabase/migrations/20260624200000_classified_threads_paginate_before_message_count.sql`)
- `get_board_thread_coverage` counts all root comments (classified or not) — no changes needed
- ThreadRow is a local (non-exported) component inside `ThreadsView.tsx` (`src/components/threads/ThreadsView.tsx:242-318`)
- Filter bar pattern: `FilterDropdown` components with `value` / `onChange` / `options` props; `updateFilters` merges into state and resets pagination (`ThreadsView.tsx:399-441`)
- API mutation pattern: `createClient → getUser → zod validation → getBoardWithRole → role check → Supabase call` (`src/pages/api/board/[boardId]/settings.ts`, `contributors.ts`)

## Desired End State

Each thread row in the Threads tab shows thumbs-up/thumbs-down buttons. Any board member (supervisor or contributor) can vote. Thumbs-up marks the classification as confirmed; thumbs-down marks it as excluded. Excluded threads appear dimmed with a visual "excluded" indicator. A 4-option vote filter (All signals / Unconfirmed / Confirmed / Excluded) lets supervisors focus on threads needing review. All metric aggregates — contributor-level intent counts, domain counts, high-signal %, and platform-wide homepage stats — exclude thumbs-down threads from their computations.

**Verification**: vote on several threads (both up and down), confirm the affected contributor's metrics update accordingly, confirm excluded threads appear dimmed in the list, and confirm the vote filter works across all four states.

## What We're NOT Doing

- Reclassification — voting excludes from metrics but does not change the intent/domain values
- Audit trail — no tracking of who voted or when (single-column boolean, no voter_id)
- Multi-vote — one vote per thread (latest write wins), no pending/approval workflow
- Undo confirmation UX — clicking the same thumb again just unsets the vote (returns to null)

## Implementation Approach

Add a nullable `vote boolean` column to `thread_classifications` (`true` = confirmed, `false` = excluded, `NULL` = unvoted). Use a `SECURITY DEFINER` function for the vote mutation so that any board member can vote without widening the existing UPDATE RLS policy. Update all RPCs that aggregate or list classifications to respect the vote column. Build the UI as thumbs-up/thumbs-down buttons with optimistic updates.

## Phase 1: Database Migration

### Overview

Add the vote column and create a secure voting function that any board member can call.

### Changes Required:

#### 1. New migration: add vote column + voting RPC

**File**: `supabase/migrations/20260709120000_thread_classification_vote.sql`

**Intent**: Add a nullable `vote boolean` column to `thread_classifications` and create a `SECURITY DEFINER` function `set_thread_classification_vote` that validates board membership and updates only the vote column. This keeps the existing UPDATE RLS policy (supervisor-only) intact while allowing any board member to vote.

**Contract**:

- Column: `vote boolean DEFAULT NULL` on `thread_classifications`
- Function signature: `set_thread_classification_vote(p_thread_root_comment_id bigint, p_vote boolean) RETURNS void`
- The function must: look up the `board_id` via `get_board_id_for_pr`, check `is_board_member`, and update only the `vote` column. Raise an exception if the caller is not a board member or the thread doesn't exist.
- Follow the lesson: `REVOKE ALL` before granting execute to `authenticated`.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly against local Supabase: `npx supabase db reset`
- TypeScript compiles: `npx tsc --noEmit`

#### Manual Verification:

- In Supabase Studio, confirm `vote` column exists on `thread_classifications` with NULL default
- Call `set_thread_classification_vote` as a board member — succeeds
- Call it as a non-member — raises permission error

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: API & Service Layer

### Overview

Create a vote endpoint, update the threads list API to return and filter by vote status, and update the service layer mapping.

### Changes Required:

#### 1. Vote API endpoint

**File**: `src/pages/api/board/[boardId]/threads/[login]/[threadId]/vote.ts`

**Intent**: New PATCH endpoint to set or clear a thread classification vote. Validates board membership (not supervisor-only — both roles can vote) and calls the `set_thread_classification_vote` RPC.

**Contract**: `PATCH` export. Request body: `{ vote: boolean | null }` (zod-validated). Path params: `boardId` (UUID), `login` (string), `threadId` (string, the `thread_root_comment_id`). Auth: `getBoardWithRole` — any role (supervisor or contributor) is allowed. Returns 204 on success. Follows the established `json()` helper pattern.

#### 2. Update threads list RPC calls

**File**: `supabase/migrations/20260709120000_thread_classification_vote.sql` (same migration as Phase 1)

**Intent**: Update `get_board_classified_threads` and `get_board_classified_threads_count` to return the `vote` column and accept a `p_vote` filter parameter.

**Contract**:

- Add `p_vote text` parameter to both functions (values: `'confirmed'`, `'excluded'`, `'unconfirmed'`, `NULL` or `'all'` for no filter).
- `get_board_classified_threads` returns `vote boolean` as an additional column.
- Filter logic: `'confirmed'` → `vote = true`, `'excluded'` → `vote = false`, `'unconfirmed'` → `vote IS NULL`, `'all'`/NULL → no filter.
- Both functions must use `DROP FUNCTION IF EXISTS` (with the **old** 3-parameter signature) then `CREATE FUNCTION` (with the new `p_vote text DEFAULT NULL` 4th param). `CREATE OR REPLACE` cannot add parameters — PostgreSQL treats the new signature as an overload and callers get "function is not unique" errors. The codebase precedent for this is `20260624200000_classified_threads_paginate_before_message_count.sql:14-16`.
- Update the `REVOKE ALL` / `GRANT EXECUTE` statements to reference the **new** 4-parameter signature.

#### 3. Update service layer

**File**: `src/lib/services/impact-metrics.ts`

**Intent**: Update `getClassifiedThreads` to pass the vote filter param to the RPC and map the `vote` column in the response.

**Contract**: Add `vote` to the filter options object accepted by `getClassifiedThreads`. Map `vote` from the RPC result into the `ClassifiedThread` object.

#### 4. Update threads list API to accept vote query param

**File**: `src/pages/api/board/[boardId]/threads/[login].ts`

**Intent**: Add `vote` to the query params schema and pass it through to the service layer.

**Contract**: Add `vote` to `queryParamsSchema` as an optional enum: `'confirmed' | 'excluded' | 'unconfirmed'`. Pass to `getClassifiedThreads` filter options.

#### 5. Update ClassifiedThread type

**File**: `src/types.ts`

**Intent**: Add the `vote` field to the `ClassifiedThread` interface.

**Contract**: `vote: boolean | null` added to `ClassifiedThread`.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npx supabase db reset`
- TypeScript compiles: `npx tsc --noEmit` and `npm run test:typecheck`
- Lint passes: `npm run lint`
- Non-integration tests pass: `npx vitest run --exclude 'tests/integration/**'`

#### Manual Verification:

- `PATCH /api/board/{id}/threads/{login}/{threadId}/vote` with `{ "vote": true }` → 204
- `PATCH` with `{ "vote": false }` → 204
- `PATCH` with `{ "vote": null }` → 204 (clears vote)
- `GET /api/board/{id}/threads/{login}?vote=excluded` returns only threads with `vote = false`
- `GET` without vote param returns all threads (with `vote` field in response)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: UI — Vote Buttons, Filter & Visual Treatment

### Overview

Add thumbs-up/thumbs-down voting buttons to each ThreadRow, a 4-option vote filter dropdown, visual dimming for excluded rows, and optimistic update logic.

### Changes Required:

#### 1. Vote buttons in ThreadRow

**File**: `src/components/threads/ThreadsView.tsx`

**Intent**: Replace the Date column with a Vote column — keeping the total at 6 columns and preserving the `colSpan={6}` on the expanded discussion row. The date is moved into the comment cell (rendered as a small secondary line before the author's nick). Vote buttons (thumbs-up / thumbs-down) occupy the former Date column slot. Clicking sets the vote via the PATCH endpoint; clicking the active thumb again clears it (sets to null). Use optimistic state — update the local thread object immediately, revert on API failure.

**Contract**:

- Remove the `<th>Date</th>` header cell; replace it with `<th>Vote</th>`.
- In ThreadRow: remove the `<td>` that renders the date; add a `<td>` with two icon buttons (`ThumbsUp`, `ThumbsDown` from lucide-react) in its place.
- Move the date value into the comment `<td>` as a small secondary element (e.g. `<span className="text-xs text-muted-foreground block">`) rendered before the author nick.
- Active state: filled/highlighted icon for the current vote. Null state: both icons in muted style.
- Optimistic update: ThreadRow manages local `vote` state initialized from `thread.vote`, sends PATCH, reverts on error.
- The `onVoteChange` callback should also update the parent state so the row doesn't revert on re-render from parent.
- `colSpan` on the expanded discussion row stays at `{6}` — no change needed.

#### 2. Vote filter dropdown

**File**: `src/components/threads/ThreadsView.tsx`

**Intent**: Add a 4th FilterDropdown to the filter bar with options: All signals, Unconfirmed, Confirmed, Excluded.

**Contract**:

- Add `vote?: 'confirmed' | 'excluded' | 'unconfirmed'` to the `Filters` interface.
- New `FilterDropdown` in the filter bar (after Role filter).
- Options: `[{ value: '', label: 'All signals' }, { value: 'unconfirmed', label: 'Unconfirmed' }, { value: 'confirmed', label: 'Confirmed' }, { value: 'excluded', label: 'Excluded' }]`.
- Pass `vote` filter to the API fetch URL.

#### 3. Visual dimming for excluded rows

**File**: `src/components/threads/ThreadsView.tsx`

**Intent**: Threads with `vote = false` should appear dimmed to visually signal they're excluded from metrics.

**Contract**: On the `<tr>` element in ThreadRow, apply `opacity-50` when `vote === false`. The vote buttons column remains full opacity so the supervisor can still interact.

#### 4. Add ThumbsUp/ThumbsDown imports

**File**: `src/components/threads/ThreadsView.tsx`

**Intent**: Import the needed lucide-react icons.

**Contract**: Add `ThumbsUp`, `ThumbsDown` to the existing lucide-react import.

### Success Criteria:

#### Automated Verification:

- TypeScript compiles: `npx tsc --noEmit`
- Lint passes: `npm run lint`
- Non-integration tests pass: `npx vitest run --exclude 'tests/integration/**'`

#### Manual Verification:

- Thumbs-up button highlights when clicked, thread vote updates
- Clicking same thumb again clears the vote (returns to unvoted state)
- Thumbs-down dims the row visually
- Vote filter dropdown shows 4 options and filters correctly
- Optimistic update: vote appears instantly, reverts on network error (test by disconnecting)
- Both supervisor and contributor can vote on threads they can see
- Date appears as secondary text before the author nick in the comment column
- Vote column (formerly Date) shows thumbs-up/down buttons; table stays at 6 columns
- Responsive: table scrolls horizontally on narrow screens without breaking

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Metrics Exclusion

### Overview

Update all metric aggregation queries to exclude threads voted as `false` (thumbs-down), ensuring excluded threads no longer skew contributor profiles or platform-wide stats.

### Changes Required:

#### 1. Update contributor-level metrics RPC

**File**: `supabase/migrations/20260709120000_thread_classification_vote.sql` (same migration)

**Intent**: Update `get_board_classifications_for_commenter` to filter out rows where `vote = false`, so that intent counts, domain counts, and high-signal % exclude rejected classifications.

**Contract**: `CREATE OR REPLACE` the function. Add `AND (tc.vote IS DISTINCT FROM false)` to the WHERE clause. This excludes only `vote = false` rows; `vote = true` and `vote IS NULL` (unvoted) still count in metrics.

#### 2. Update homepage stats RPC

**File**: `supabase/migrations/20260709120000_thread_classification_vote.sql` (same migration)

**Intent**: Update `get_homepage_stats` to exclude `vote = false` threads from `threads_classified`, `high_impact_percent`, `deep_discussions`, and `multi_person_threads` counts.

**Contract**: `CREATE OR REPLACE` the function. Add `WHERE vote IS DISTINCT FROM false` (or equivalent) to the `classified` CTE, which feeds all downstream stats.

#### 3. Update thread-coverage denominator RPC _(discovered during implementation)_

**File**: `supabase/migrations/20260709120000_thread_classification_vote.sql` (same migration)

**Intent**: Update `get_board_started_root_comments_for_commenter` to exclude `vote = false` threads from the denominator it returns. Without this, the thread-coverage % denominator would still include excluded threads while the numerator (from the metrics RPC) would not, producing systematically deflated coverage percentages.

**Contract**: `CREATE OR REPLACE` the function. Add a LEFT JOIN to `thread_classifications` on `thread_root_comment_id` and append `AND (tc.vote IS DISTINCT FROM false)` to the WHERE clause.

#### 4. Verify impact-metrics.ts needs no changes

**File**: `src/lib/services/impact-metrics.ts`

**Intent**: Confirm that `getClassificationAggregates` requires no code changes — it computes from the RPC result set, so filtering at the SQL level is sufficient.

**Contract**: No code change expected. The function at lines 880-961 calls the RPC and iterates the result; if the RPC excludes `vote = false` rows, the TypeScript code automatically produces correct aggregates.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npx supabase db reset`
- TypeScript compiles: `npx tsc --noEmit`
- Non-integration tests pass: `npx vitest run --exclude 'tests/integration/**'`

#### Manual Verification:

- Thumbs-down a thread, navigate to the contributor's Impact tab — intent/domain counts and high-signal % decrease by the expected amount
- Thumbs-up a thread — metrics remain unchanged (confirmed threads still count)
- Clear a vote on a previously excluded thread — metrics increase back
- Homepage stats (`/`) reflect exclusions (threads_classified count decreases)
- Edge case: exclude all threads for a contributor — high-signal % shows 0, not NaN or error

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- `set_thread_classification_vote` RPC: board member can vote, non-member is rejected, non-existent thread raises error
- Vote API endpoint: valid vote values accepted, invalid rejected, auth enforced
- `ClassifiedThread` type includes `vote` field

### Integration Tests:

- Vote a thread → `get_board_classifications_for_commenter` excludes it → `getClassificationAggregates` returns updated counts
- Vote filter: `?vote=excluded` returns only excluded threads, `?vote=unconfirmed` returns only unvoted
- Contributor votes on own thread → succeeds (board member check, not supervisor check)

### Manual Testing Steps:

1. As supervisor: thumbs-down a thread, verify it dims, verify Impact metrics update
2. As contributor: thumbs-up own thread, verify it highlights, verify no permission error
3. Use vote filter to find all unconfirmed threads, then batch-review them
4. Exclude a thread, switch to Excluded filter, verify it appears there
5. Clear a vote, verify thread returns to normal appearance and metrics

## Performance Considerations

- The `vote` column adds negligible storage (nullable boolean)
- `IS DISTINCT FROM false` in the metrics RPC is sargable and doesn't prevent index usage on the existing join columns
- The `SECURITY DEFINER` function adds one extra query (board membership check) per vote — acceptable for an infrequent user action
- No new indexes needed — vote filtering is applied after the primary join/filter in all RPCs

## Migration Notes

- The migration is backward-compatible: `vote DEFAULT NULL` means all existing rows are unvoted, preserving current metric values exactly
- No data backfill needed
- `get_board_classified_threads` and `get_board_classified_threads_count` use `DROP FUNCTION` + `CREATE FUNCTION` (adding `p_vote` requires a new signature). Existing callers are unaffected because the new param has a `DEFAULT NULL`
- Rollback: drop the `vote` column and re-replace the RPCs without the vote logic

## References

- Frame brief: `context/changes/flag-classification-inaccurate/frame.md`
- Thread classifications schema: `supabase/migrations/20260618120000_thread_classifications.sql`
- Metrics RPC: `supabase/migrations/20260624190000_classification_aggregates_exclude_self_review.sql`
- Classified threads RPC: `supabase/migrations/20260624200000_classified_threads_paginate_before_message_count.sql`
- Homepage stats RPC: `supabase/migrations/20260629120000_homepage_stats_rpc.sql`
- Impact metrics service: `src/lib/services/impact-metrics.ts:880-961`
- ThreadsView component: `src/components/threads/ThreadsView.tsx:242-318`
- Threads API: `src/pages/api/board/[boardId]/threads/[login].ts`
- Lessons learned (REVOKE ALL): `context/foundation/lessons.md:24-30`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Database Migration

#### Automated

- [x] 1.1 Migration applies cleanly against local Supabase — be29a37
- [x] 1.2 TypeScript compiles — be29a37

#### Manual

- [x] 1.3 Vote column exists with NULL default — 8573bc7
- [x] 1.4 set_thread_classification_vote succeeds for board member — 8573bc7
- [x] 1.5 set_thread_classification_vote raises error for non-member — 8573bc7

### Phase 2: API & Service Layer

#### Automated

- [x] 2.1 Migration applies cleanly — dc68d90
- [x] 2.2 TypeScript compiles (src and tests) — dc68d90
- [x] 2.3 Lint passes — dc68d90
- [x] 2.4 Non-integration tests pass — dc68d90

#### Manual

- [x] 2.5 Vote PATCH endpoint works for all vote values — dc68d90
- [x] 2.6 Threads list API returns vote field — dc68d90
- [x] 2.7 Vote query param filters correctly — dc68d90

### Phase 3: UI — Vote Buttons, Filter & Visual Treatment

#### Automated

- [x] 3.1 TypeScript compiles — a93bca7
- [x] 3.2 Lint passes — a93bca7
- [x] 3.3 Non-integration tests pass — a93bca7

#### Manual

- [x] 3.4 Thumbs-up/down buttons work and highlight correctly — a93bca7
- [x] 3.5 Clicking same thumb clears vote — a93bca7
- [x] 3.6 Excluded rows appear dimmed — a93bca7
- [x] 3.7 Vote filter dropdown shows 4 options and filters correctly — a93bca7
- [x] 3.8 Optimistic update works, reverts on error — a93bca7
- [x] 3.9 Both supervisor and contributor can vote — a93bca7
- [x] 3.10 Table responsive on narrow screens — a93bca7

### Phase 4: Metrics Exclusion

#### Automated

- [x] 4.1 Migration applies cleanly — 8573bc7
- [x] 4.2 TypeScript compiles — 8573bc7
- [x] 4.3 Non-integration tests pass — 8573bc7

#### Manual

- [x] 4.4 Thumbs-down thread decreases contributor metrics — 8573bc7
- [x] 4.5 Thumbs-up thread leaves metrics unchanged — 8573bc7
- [x] 4.6 Clearing excluded vote restores metrics — 8573bc7
- [x] 4.7 Homepage stats reflect exclusions — 8573bc7
- [x] 4.8 All threads excluded → high-signal % shows 0 — 8573bc7
