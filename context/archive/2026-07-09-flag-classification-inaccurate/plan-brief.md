# Thread Classification Voting — Plan Brief

> Full plan: `context/changes/flag-classification-inaccurate/plan.md`
> Frame brief: `context/changes/flag-classification-inaccurate/frame.md`

## What & Why

Thread classifications (intent/domain) are sometimes wrong — the AI assigns, e.g., `nitpick` instead of `bug-catch`. There is no mechanism to correct this. The wrong classifications flow directly into intent counts, domain counts, and the high-signal % metric, skewing contributor profiles. We're adding thumbs-up/thumbs-down voting so board members can confirm or exclude individual classifications.

## Starting Point

`thread_classifications` stores one row per classified thread with `intent` and `domain` but no feedback mechanism. The `get_board_classifications_for_commenter` RPC feeds all three contributor-level metrics, and `get_homepage_stats` computes platform-wide stats — both query the table directly with no exclusion logic. The ThreadsView UI shows classified threads in a 6-column table with filters for intent, domain, and role, but no voting UI.

## Desired End State

Each thread row shows thumbs-up/thumbs-down buttons. Any board member can vote. Excluded threads (thumbs-down) appear dimmed in the list and are filtered from all metric aggregates. A 4-option vote filter (All signals / Unconfirmed / Confirmed / Excluded) helps supervisors focus on threads needing review.

## Key Decisions Made

| Decision         | Choice                                                     | Why (1 sentence)                                                                                                         | Source                        |
| ---------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------- |
| Vote model       | Thumbs up/down (not exclude-only)                          | User wants both confirmation and exclusion signals on classifications.                                                   | Plan (user override of Frame) |
| Data storage     | Nullable `vote boolean` on `thread_classifications`        | Three-state (null/true/false) in one column; no audit trail needed for single-truth model.                               | Plan                          |
| Permission scope | Both supervisor and contributor                            | User explicitly chose both; gaming risk accepted as manageable.                                                          | Plan (user override of Frame) |
| RLS approach     | `SECURITY DEFINER` function                                | Keeps existing supervisor-only UPDATE policy intact; function validates board membership and only touches `vote` column. | Plan                          |
| UI interaction   | Icon button in new 7th column                              | Discoverable, consistent placement, doesn't clutter existing columns.                                                    | Plan                          |
| Visual treatment | Dimmed row (opacity)                                       | Thread stays visible for context but clearly marked as excluded.                                                         | Plan                          |
| Filter           | 4-option: All signals / Unconfirmed / Confirmed / Excluded | Complete coverage of all vote states; matches existing FilterDropdown pattern.                                           | Plan                          |
| Update strategy  | Optimistic with rollback                                   | Feels instant for batch reviewing; reverts on API failure.                                                               | Plan                          |

## Scope

**In scope:**

- Nullable `vote boolean` column + `SECURITY DEFINER` voting RPC
- New PATCH API endpoint for voting
- Vote column returned in threads list API with filter support
- Thumbs-up/down buttons in ThreadRow
- 4-option vote filter dropdown
- Dimmed visual treatment for excluded rows
- Metrics exclusion in `get_board_classifications_for_commenter` and `get_homepage_stats`

**Out of scope:**

- Reclassification (changing intent/domain values)
- Audit trail (who voted, when)
- Multi-vote / approval workflow
- Batch voting UI

## Architecture / Approach

Single nullable boolean column (`true` = confirmed, `false` = excluded, `NULL` = unvoted) on the existing `thread_classifications` table. A `SECURITY DEFINER` Postgres function bypasses the supervisor-only UPDATE RLS to let any board member vote on the `vote` column only. Metrics RPCs add a `WHERE vote IS DISTINCT FROM false` filter. The React UI uses optimistic updates with rollback.

## Phases at a Glance

| Phase                                | What it delivers                                    | Key risk                                                   |
| ------------------------------------ | --------------------------------------------------- | ---------------------------------------------------------- |
| 1. Database Migration                | `vote` column + secure voting function              | Migration must be backward-compatible (NULL default)       |
| 2. API & Service Layer               | Vote endpoint + threads list vote support           | New param on existing RPCs must not break current callers  |
| 3. UI: Vote Buttons, Filter & Visual | Thumbs up/down, filter, dimming, optimistic updates | Optimistic state management in ThreadRow                   |
| 4. Metrics Exclusion                 | All aggregates exclude thumbs-down threads          | Must catch all aggregation points (contributor + homepage) |

**Prerequisites:** Local Supabase running (`npx supabase start`)
**Estimated effort:** ~2-3 sessions across 4 phases

## Open Risks & Assumptions

- Contributor self-voting creates a gaming vector (exclude low-signal threads to inflate high-signal %) — user accepts this tradeoff; supervisor visibility into votes mitigates
- No audit trail means last-write-wins if both supervisor and contributor vote on the same thread
- `get_homepage_stats` is `SECURITY DEFINER` / `service_role` only — the `vote` filter applies universally, not per-board

## Success Criteria (Summary)

- Thumbs-down a thread → contributor's intent counts, domain counts, and high-signal % decrease by the expected amount
- Vote filter correctly isolates unconfirmed/confirmed/excluded threads
- Both supervisor and contributor can vote without permission errors
