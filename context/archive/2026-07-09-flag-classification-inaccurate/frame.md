# Frame Brief: Per-thread classification exclusion flag

> Framing step before /10x-plan. This document captures what is _actually_
> at issue, separated from what was initially assumed.

## Reported Observation

Thread classifications (intent/domain) are sometimes wrong — the AI assigns, e.g.,
`nitpick` instead of `bug-catch`. There is no mechanism to correct this. The wrong
classifications flow directly into intent counts, domain counts, and the high-signal %
metric, skewing contributor profiles.

## Initial Framing (preserved)

- **User's stated cause/approach**: Users need a per-thread feedback mechanism on the Threads tab.
- **User's proposed direction**: Thumbs up/down buttons per thread row. Thumbs down auto-excludes the thread from metrics (intent/domain counts, high-signal %) as if it were never classified.
- **Pre-dispatch narrowing**: Błędny intent/domain is the core observation; both the board supervisor and the contributor themselves should be able to flag; the effect is exclusion from metric counts only (no reclassification).

## Dimension Map

The observation could originate at any of these dimensions:

1. **AI classification quality** — the model makes errors at the source; user signals don't fix this, just work around it.
2. **Feedback UX** — what the flag interaction looks like: bidirectional (thumbs up/down) vs. single exclude toggle. ← initial framing
3. **Permission scope** — who can flag: supervisor-only (existing trust model) vs. contributor-self (new trust boundary, gaming risk). ← initial framing (both)
4. **Data model** — where the flag lives: column on `thread_classifications` vs. separate exclusions table.
5. **Metrics pipeline** — how exclusion flows into the RPC that feeds all three aggregates.

## Hypothesis Investigation

| Hypothesis                                   | Evidence                                                                                                                                                                                                                                                                                                                                               | Verdict                                                                                                |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Thumbs up has a mechanical purpose           | User described no mechanical effect for thumbs up; only thumbs-down = exclude. No existing "confirmed correct" concept in DB or UI.                                                                                                                                                                                                                    | NONE                                                                                                   |
| Contributor-self flagging is safe            | `thread_classifications` UPDATE RLS is `is_board_owner` only (`20260618120000_thread_classifications.sql:31-34`). Astro page enforces `board.role !== "supervisor"` redirect for cross-contributor viewing (`threads/[githubLogin]/[...dateRange].astro:42-43`). Contributors can't mutate classifications today; allowing it is a new trust boundary. | WEAK — gaming risk: contributor could selectively exclude low-signal threads to inflate high-signal %. |
| Supervisor-only flag aligns with trust model | `is_board_owner` controls all classification mutations. Supervisors are the quality control role system-wide (sync gate `api/github/sync.ts:51`, classification insert RLS). Supervisor-only flag needs no RLS policy change on the main table.                                                                                                        | STRONG                                                                                                 |
| Single-table column is sufficient            | No existing exclusions concept. A boolean `excluded_from_metrics` on `thread_classifications` with a WHERE clause change in the `get_board_classifications_for_commenter` RPC (`20260623120000_board_classifications_rpc.sql:9-29`) covers all three aggregates in one change.                                                                         | STRONG                                                                                                 |
| Separate exclusions table is needed          | No evidence of multi-user exclusion requirements or need for audit history. Would add join complexity with no benefit given single-truth model.                                                                                                                                                                                                        | NONE                                                                                                   |

## Narrowing Signals

- Thumbs up: user did not describe any mechanical effect → UI bidirectionality adds complexity with no functional benefit. A single exclude toggle is the real primitive.
- Permission scope: user said "both author and admin" — but the existing system draws a hard supervisor/contributor line. Contributors self-flagging creates a gaming vector (exclude `nitpick` threads to make high-signal % look better). The intended use case (correcting misclassification) is a supervisory judgment call, not a self-service one.
- Metrics effect: user confirmed "wykluczenie z liczników" only — no reclassification loop needed. Simpler than it could be.

## Cross-System Convention

All mutation-level permissions on classification data follow `is_board_owner` exclusively (INSERT, UPDATE, DELETE policies all use it). The only read permission is `is_board_member`. A flag that modifies which classifications count in metrics is semantically a mutation of classification state — the convention says supervisor-only.

## Reframed (or Confirmed) Problem Statement

> **The actual problem to plan around is**: a supervisor needs a board-wide "exclude from metrics" toggle on individual thread classifications, so that acknowledged misclassifications stop skewing intent/domain counts and high-signal % for the affected contributor.

The "thumbs up/down" framing is UX sugar over a simpler primitive: a boolean `excluded_from_metrics` flag on each classification. Thumbs up has no mechanical role and should not be built. The "both author and admin can flag" framing is the key correction: contributor self-flagging risks metric gaming and requires a new trust boundary — the flag should be supervisor-only, matching the existing RLS and supervisory authority model.

## Confidence

- **HIGH** — strong evidence + matches convention across RLS, Astro page enforcement, and the sync gate. The gaming risk of contributor-self-flagging is structural, not speculative.

## What Changes for /10x-plan

The plan should be: supervisor-only "exclude from metrics" toggle on each `ThreadRow`, stored as a flag in (or alongside) `thread_classifications`, with the metrics RPC updated to filter excluded threads. Drop the thumbs-up concept entirely — it has no function.

## References

- Source files: `supabase/migrations/20260618120000_thread_classifications.sql:31-34`, `supabase/migrations/20260623120000_board_classifications_rpc.sql:9-29`, `src/lib/services/impact-metrics.ts:909-946`, `src/pages/board/[id]/threads/[githubLogin]/[...dateRange].astro:40-43`, `src/pages/api/github/sync.ts:51`
- Related research: none yet
