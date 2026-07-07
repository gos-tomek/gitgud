---
date: 2026-07-06T13:46:59+02:00
researcher: Claude
git_commit: b0e55b7846936a0e92e70340f988455835b59ae4
branch: expand
repository: GitGud
topic: "Audit of unfinished expand/contract migration phases"
tags: [research, codebase, supabase, migrations, expand-contract, boards, github_pat]
status: complete
last_updated: 2026-07-06
last_updated_by: Claude
---

# Research: Audit of unfinished expand/contract migration phases

**Date**: 2026-07-06T13:46:59+02:00
**Researcher**: Claude
**Git Commit**: b0e55b7846936a0e92e70340f988455835b59ae4
**Branch**: expand
**Repository**: GitGud

## Research Question

Zauważyłem, że w tabeli `boards` wciąż mamy kolumnę na PAT. Czas wykonać fazę contract i ją usunąć. Przejrzyj wszystkie migracje i zrób listę wszystkich niedokończonych faz expand — czy coś jeszcze powinno być usunięte?

## Summary

There is exactly **one** genuinely unfinished expand/contract migration in the project: `boards.github_pat_encrypted`, plus the dead RPC function that reads it, `get_board_github_pat(uuid, text)`. Both were explicitly, in writing, deferred to "a separate future migration (contract phase)" by `supabase/migrations/20260625120000_user_pat_and_expiry.sql` and confirmed by `context/archive/2026-06-25-edit-board-connection/change.md` — and that follow-up migration was never written.

Every other "superseded/unused/deprecated" comment found across all 32 migration files turned out to already have been contracted **in the same migration** that flagged it (see table below) — those are closed loops, not debt.

A broader dead-code sweep (matching every table/column/RPC against actual `.select()`/`.insert()`/`.rpc()` call sites in `src/` and `tests/`) turned up a second cluster of never-read columns (`github_pull_requests.fetched_at`, `github_reviews.fetched_at`, `github_review_comments.fetched_at`, `github_review_comments.position_side`, `github_review_comments.review_id`, `thread_classifications.model_id`). On inspection, none of these are expand/contract debt: each has either an explicit design-decision comment explaining why it's intentionally write-only ([`impact-metrics.ts:100-105`](../../../src/lib/services/impact-metrics.ts#L100-L105) for `fetched_at`), or a real (non-`.select()`) in-process use ([`github-sync.ts:200,210`](../../../src/lib/services/github-sync.ts#L200) for `review_id`, used to validate rows before insert now that its FK was dropped), or is plausible forward-looking audit/provenance metadata with no migration author ever flagging it for removal (`model_id`, `position_side`). No migration promised a follow-up drop for any of these — they're just not surfaced in the UI yet, which is a normal state for iterative feature work, not broken process.

One adjacent-but-out-of-scope finding: `context/archive/2026-06-11-test-fix-gaps/reviews/impl-review.md` (finding F3) documents an **explicitly skipped** (not deferred) decision to narrow the `UPDATE` grant on `board_contributors` — still over-granted today. This is a privilege-hardening gap, not a migration debt, so it's noted but not part of the contract-phase list below.

**Recommendation**: write one contract migration that (1) drops `get_board_github_pat(uuid, text)` and its `GRANT EXECUTE`, and (2) drops `boards.github_pat_encrypted`. Nothing else qualifies.

## Detailed Findings

### Confirmed pending contract phase

| Object                                 | Introduced                                                                                                                      | Flagged deprecated                                                                                                                                                                   | Still present?                                                                                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `boards.github_pat_encrypted` (bytea)  | `supabase/migrations/20260531100000_github_ingestion_access.sql:6`                                                              | `supabase/migrations/20260625120000_user_pat_and_expiry.sql:8-9` — "boards.github_pat_encrypted is left in place (expand phase); ... the column drop is a separate future migration" | Yes — never dropped                                                                                                                             |
| `get_board_github_pat(uuid, text)` RPC | `supabase/migrations/20260531100000_github_ingestion_access.sql:127`, redefined `20260619100000_service_role_pat_access.sql:15` | Implicitly dead once `create_board_atomic` stopped writing to `boards.github_pat_encrypted` (`20260625130000_create_board_read_user_pat.sql`)                                        | Yes — `GRANT EXECUTE ... TO authenticated` still live; zero callers in `src/` (only a stale comment in `tests/integration/pat-leak.test.ts:18`) |

By the time `20260625130000_create_board_read_user_pat.sql` shipped, `create_board_atomic` no longer takes or writes a raw token to `boards` at all — it only verifies a PAT exists on `user_profiles`. So both the column and the RPC that reads it have been fully superseded by `user_profiles.github_pat_encrypted` / `get_user_github_pat` / `get_user_github_pat_by_user_id` since **2026-06-25**, with no code path touching them since.

### Checked and ruled out — already contracted in the _same_ migration

| Item                                                                 | Introduced                                       | Flagged                                                                                                                          | Dropped                                      |
| -------------------------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `set_board_github_pat(uuid,text,text)`                               | `20260531100000:111-125`                         | "superseded" `20260611120000_create_board_atomic.sql:64`                                                                         | same file, line 68                           |
| `board_members` table + `add_owner_as_board_member()` trigger        | `20260529120000`, `20260529130000`               | "superseded by derived access" `20260623100000_derived_board_access.sql`                                                         | `20260623110000_drop_board_members.sql:9-18` |
| `board_contributors.user_id`                                         | `20260602120000_board_contributors.sql:11`       | "unused" `20260623110000_drop_board_members.sql:20`                                                                              | same file, line 22                           |
| `thread_classifications.constructive/knowledge_direction/confidence` | `20260618120000_thread_classifications.sql:8-10` | table never shipped to prod, expand/contract lag explicitly waived — `20260621120000_classification_batch_voting_schema.sql:2-6` | same file, lines 18-21                       |
| `github_repos.connected_by`                                          | `20260531100000:16`                              | "unused" `20260625120000_user_pat_and_expiry.sql:83-88`                                                                          | same file, line 132                          |

No stale RPC overloads were found anywhere: every signature/return-type change that couldn't use `CREATE OR REPLACE` was preceded by an explicit `DROP FUNCTION IF EXISTS` for the exact old signature, in the same migration (`create_board_atomic`, `set_user_github_pat`, `get_unclassified_root_comments_for_board`, the 5 revisions of `get_board_classified_threads`).

### Investigated and ruled out — not expand/contract debt

- **`github_pull_requests/github_reviews/github_review_comments.fetched_at`** — written on every sync (`src/lib/services/github-sync.ts:99,192,568`), never selected back. Explicitly explained as intentional in [`impact-metrics.ts:100-105`](../../../src/lib/services/impact-metrics.ts#L100): board freshness is derived from `github_repos.last_synced_at`, not `fetched_at`, because an incremental sync can complete with nothing new to fetch and leave `fetched_at` stale on purpose. No migration ever flagged these for removal.
- **`github_review_comments.review_id`** — its FK was dropped in `20260630140000_drop_review_id_fk.sql` ("review_id is not queried by any RPC, so removing [the FK]..."), but the column itself is still actively used at write time in `github-sync.ts:200,210` to validate rows against known review IDs before insert (an application-level substitute for the FK check that was removed for resilience against upstream 502s). Not dead.
- **`github_review_comments.position_side`**, **`thread_classifications.model_id`** — write-only today, but no migration comment or archived change ever flagged them as deprecated/unused. They read as forward-looking bookkeeping (diff-side rendering, model provenance for future re-classification/versioning features) rather than migration leftovers. Flagging these for removal would be a product decision, not a migration-hygiene one — out of scope for a contract-phase cleanup.

### Adjacent, out of scope

- `context/archive/2026-06-11-test-fix-gaps/reviews/impl-review.md` finding F3: `GRANT SELECT, INSERT, UPDATE, DELETE ON public.board_contributors TO authenticated` was reviewed and the over-broad `UPDATE` grant on this append-only table was explicitly marked **SKIPPED** (not deferred to a named migration) in `20260614120000_revoke_all_hardening.sql:22`. Still over-granted today, but this is a privilege-hardening decision, not an expand-phase promise — separate from this audit's scope. Worth its own change if the team wants to tighten it.

## Code References

- `supabase/migrations/20260531100000_github_ingestion_access.sql:6` — `boards.github_pat_encrypted` added
- `supabase/migrations/20260531100000_github_ingestion_access.sql:127` — `get_board_github_pat` created
- `supabase/migrations/20260619100000_service_role_pat_access.sql:15` — `get_board_github_pat` redefined (service_role bypass)
- `supabase/migrations/20260625120000_user_pat_and_expiry.sql:8-9` — deferred-drop comment
- `supabase/migrations/20260625130000_create_board_read_user_pat.sql:11` — `create_board_atomic` stops writing to `boards.github_pat_encrypted`
- `src/lib/github.ts:141` — live PAT read path (`get_user_github_pat`)
- `tests/integration/pat-leak.test.ts:18` — stale comment referencing `get_board_github_pat` (no actual call)
- `src/lib/services/impact-metrics.ts:100-105` — explains why `fetched_at` is intentionally unread
- `src/lib/services/github-sync.ts:200,210` — `review_id` used in-process for FK-less validation

## Architecture Insights

- This codebase's expand/contract discipline (per `CLAUDE.md`) is followed well in practice: of ~6 deprecation comments found across 32 migrations, 5 were contracted in the same migration that flagged them (often same file, a few lines down). Only the PAT column slipped through, likely because the wizard/backfill/RPC-rewrite spanned three separate migrations (`p2`→`p3`→`p4` in `edit-board-connection`) and the actual `DROP COLUMN` step was never scheduled as its own follow-up change.
- "Never selected in a `.select()`" is not, by itself, evidence of expand/contract debt in this codebase — several columns are legitimately write-only (audit/provenance/staleness bookkeeping) or consumed via non-`.select()` in-process logic. The reliable signal is an explicit author note deferring a drop, cross-checked against whether a later migration actually did it.

## Historical Context (from prior changes)

- `context/archive/2026-06-25-edit-board-connection/change.md` — "`boards.github_pat_encrypted` is deprecated after this change... The column is kept in place for rollback safety per expand/contract convention. Its removal is a separate future migration (contract phase)." — the authoritative source for the one pending item.
- `context/archive/2026-06-22-link-github-account/plan.md` — documents the `board_members` drop plan, which was executed in full via `20260623110000_drop_board_members.sql`.
- `context/archive/2026-06-11-test-fix-gaps/reviews/impl-review.md` (F3) — documents the skipped `board_contributors` UPDATE-grant narrowing (adjacent, out of scope).

## Related Research

None found under `context/changes/**/research.md` or `context/archive/**/research.md` on this specific topic.

## Open Questions

- Should the `board_contributors` UPDATE over-grant (F3, skipped) be picked up as a separate hardening change? Not part of this contract-phase cleanup, but flagged for visibility.
- `position_side` / `model_id` are write-only by product-maturity, not by migration mistake — confirm with the team whether they're still wanted before any future removal; not recommended for removal now.
