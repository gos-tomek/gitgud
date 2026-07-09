---
date: 2026-07-09T17:00:00+02:00
researcher: Claude (10x-research)
git_commit: 268fcfe401c87fe7ec759a04e16a1855a3341275
branch: GitGud-e2e
repository: GitGud-e2e
topic: "Refresh test plan to reflect 10 features shipped since June 2026"
tags: [research, testing, risk-map, test-plan, workflow, settings, metrics, deletion]
status: complete
last_updated: 2026-07-09
last_updated_by: Claude (10x-research)
---

# Research: Test Plan Refresh — 10 Features Shipped Since June 2026

**Date**: 2026-07-09T17:00:00+02:00
**Researcher**: Claude (10x-research)
**Git Commit**: 268fcfe401c87fe7ec759a04e16a1855a3341275
**Branch**: GitGud-e2e
**Repository**: GitGud-e2e

## Research Question

What changed in the codebase since 2026-06-14 (last test-plan update), and how should the test plan's risk map, rollout phases, stack profile, and cookbook be updated to reflect 10 shipped features, 4 activated deferred risks, and 4 new risk surfaces?

## Summary

Since the last test-plan update (2026-06-14), the project shipped 10 features across 13 archived change folders. The test base grew from zero to 32 test files (6 unit, 6 component, 14 hermetic, 6 integration) plus 5 helpers. Four of five deferred risks activated (#7–#10: raw metrics, delete board, classification batch, OAuth linking). Four new risk surfaces emerged: workflow chain integrity (58 commits of churn), settings API (6–7 mutation endpoints), dashboard metric correctness (1146-line service), and account deletion cascade. Existing tests cover individual functions within these surfaces but leave orchestration, authorization boundaries, and edge-case metrics untested.

## Detailed Findings

### 1. Shipped Features Since 2026-06-14

Ten features shipped, mapped to the deferred risks they activate:

| #   | Change                        | Archived   | Deferred Risk Activated                       | Key Artifacts                                                                                           |
| --- | ----------------------------- | ---------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 1   | `profile-raw-github-metrics`  | 2026-06-17 | **S-04 → Risk #7** (data parity)              | 5 impact API endpoints, `src/lib/services/impact-metrics.ts` (1146 lines), heatmap UI                   |
| 2   | `classification-batch`        | 2026-06-22 | **F-03 → Risk #9** (raw comment retention)    | `src/worker.ts` WorkflowEntrypoint (521 lines), `20260621120000_classification_batch_voting_schema.sql` |
| 3   | `link-github-account`         | 2026-06-23 | **F-04 → Risk #10** (OAuth identity mismatch) | `20260622120000_user_profiles.sql`, derived board access, dropped `board_members` table                 |
| 4   | `delete-board`                | 2026-07-07 | **S-10 → Risk #8** (deletion cascade)         | `DELETE` at `src/pages/api/board/[boardId]/index.ts:12`, settings danger zone UI                        |
| 5   | `em-switch-ic-dropdown`       | 2026-06-22 | —                                             | UI-only: EM switches between IC profiles                                                                |
| 6   | `profile-classified-comments` | 2026-06-24 | —                                             | RPCs for classified threads, 2 new API routes                                                           |
| 7   | `edit-board-connection`       | 2026-06-25 | —                                             | PAT migrated from `boards` to `user_profiles`, new `POST /api/profile/pat`                              |
| 8   | `homepage`                    | 2026-06-29 | —                                             | `get_homepage_stats` RPC, KV caching, homepage-stats service                                            |
| 9   | `bugfix` (workflow overhaul)  | 2026-07-06 | — (new surface: R1)                           | 58 commits (PRs #44–#86), rebuilt workflow orchestration in `src/worker.ts`                             |
| 10  | `manage-ic-roster` + `expand` | 2026-07-07 | — (new surface: R5)                           | Board settings PATCH/POST/DELETE endpoints, contract migration dropping deprecated columns              |

**Deferred risk #11 (PAT expiry false positive/negative)** remains deferred — S-11 has not shipped.

### 2. Current Test Inventory (32 Files)

| Type        | Count | Files                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit        | 6     | `classification.test.ts`, `date-range.test.ts`, `github.test.ts`, `logger.test.ts`, `token-status.test.ts`, `wizard-reducer.test.ts`                                                                                                                                                                                                                                                    |
| Component   | 6     | `CreateBoardForm.test.tsx`, `ChangePasswordForm.test.tsx`, `DeleteAccountDialog.test.tsx`, `PatUpdateForm.test.tsx`, `SignUpForm.test.tsx`, `impact.test.tsx`                                                                                                                                                                                                                           |
| Hermetic    | 14    | `board-creation.test.ts`, `board-settings.test.tsx`, `classification-voting.test.ts`, `delete-account.test.ts`, `github-pat-fallback.test.ts`, `impact-api.test.ts`, `impact-metrics.test.ts`, `list-and-upsert-prs.test.ts`, `profile-password.test.ts`, `profile-pat.test.ts`, `sync-pr-batch.test.ts`, `sync-review-comments.test.ts`, `threads-api.test.ts`, `validate-pat.test.ts` |
| Integration | 6     | `access-boundary.test.ts`, `account-deletion.test.ts`, `board-settings.test.ts`, `impact-access.test.ts`, `pat-leak.test.ts`, `smoke.test.ts`                                                                                                                                                                                                                                           |
| Helpers     | 5     | `astro-server.ts`, `auth-fetch.ts`, `seed.ts`, `setup.ts`, `supabase.ts`                                                                                                                                                                                                                                                                                                                |

**Coverage of activated deferred risks:**

- **Risk #7** (data parity): `impact.test.tsx`, `impact-api.test.ts`, `impact-metrics.test.ts`, `impact-access.test.ts` — covers API guard layer and individual metric functions. Missing: IC-vs-EM parity assertion (the core risk scenario).
- **Risk #8** (deletion cascade): `account-deletion.test.ts` (integration, thorough cascade verification), `DeleteAccountDialog.test.tsx` (component), `delete-account.test.ts` (hermetic). Missing: board-only deletion test, running-workflow-during-delete scenario.
- **Risk #9** (raw comment retention): `classification-voting.test.ts` (hermetic), `classification.test.ts` (unit). Missing: assertion that classified output strips raw comment text.
- **Risk #10** (OAuth identity mismatch): `SignUpForm.test.tsx` (component, GitHub username field). Missing: identity-bridge integration test (auto-match trigger, wrong-account scenario).

### 3. New Risk Surfaces — Deep Analysis

#### R1: Workflow Chain Integrity (highest concern)

**Chain**: dispatch → sync-repo → orchestrate → prdetails → reviews → classify (6 phases in `src/worker.ts`)

**Failure scenarios**:

1. **Fire-and-forget architecture**: phases spawned via `Workflow.create()` with no completion polling (`src/worker.ts:220-221`). If `prdetails` fails silently, reviews and classifications proceed on stale data.
2. **Multi-repo race on classify**: each repo's `reviews` phase spawns `classify-${boardId}-${syncStamp}` (`src/worker.ts:384`). Second repo gets "duplicate ID" error, caught silently. Classification may run on incomplete data.
3. **Subrequest budget exhaustion**: capped at 50 per Cloudflare invocation. Large repos can exceed, causing partial data.
4. **Untestable in Vitest**: `step.do`/`step.sleep` are Cloudflare primitives — the bugfix plan (`context/archive/2026-06-30-bugfix/plan.md`) explicitly documents this constraint.

**Existing tests**: `sync-pr-batch.test.ts`, `sync-review-comments.test.ts`, `list-and-upsert-prs.test.ts` cover individual data-transform functions. No test covers multi-phase orchestration or failure recovery.

**Recommended**: Hermetic tests for mid-chain failure recovery (what happens when one phase's DB write fails). E2E for the manual sync trigger through the UI. Orchestration itself (Cloudflare Workflows `step.do`) cannot be tested in Vitest — consider E2E against a deployed preview.

#### R5: Settings API

**Endpoints found** (6–7 mutation surfaces, not exactly 7):

| Endpoint                                        | Method       | What it does                   |
| ----------------------------------------------- | ------------ | ------------------------------ |
| `src/pages/api/board/[boardId]/settings.ts`     | PATCH        | Rename board (supervisor-only) |
| `src/pages/api/board/[boardId]/repos.ts`        | POST, DELETE | Add/remove repo from board     |
| `src/pages/api/board/[boardId]/contributors.ts` | POST, DELETE | Add/remove contributor         |
| `src/pages/api/board/check-name.ts`             | POST         | Check board name availability  |
| `src/pages/api/board/[boardId]/index.ts`        | DELETE       | Delete board                   |
| `src/pages/api/profile/pat.ts`                  | PUT, DELETE  | Update/remove PAT              |
| `src/pages/api/profile/password.ts`             | PATCH        | Change password                |

**Failure scenarios**:

1. **TOCTOU race on rename**: PATCH checks for duplicate names with SELECT, then updates. Unique constraint catches it but returns generic 500 before the 409 path (`src/pages/api/board/[boardId]/settings.ts:50-56`).
2. **No ownership check in code**: board DELETE at `src/pages/api/board/[boardId]/index.ts:30` relies entirely on RLS — if policies are misconfigured, any authenticated user could delete any board.

**Existing tests**: `tests/hermetic/board-settings.test.tsx` (component), `tests/integration/board-settings.test.ts` (integration for rename/add/remove). Missing: authorization boundary test (non-owner cannot rename/delete), concurrent rename race.

#### R8: Dashboard Metric Correctness

The dashboard page (`src/pages/dashboard.astro`) is a redirect-only page — actual metrics live in `src/lib/services/impact-metrics.ts` (1146 lines) serving 5 API endpoints.

**Failure scenarios**:

1. **Self-review exclusion drift**: Multiple places filter out reviews on own PRs (lines 210, 233, 438, 478). If any filter is missed, metrics inflate.
2. **Date range boundary**: String comparison of ISO dates is correct for UTC but fragile if timestamps have timezone offsets.
3. **Division by zero**: `threadsPerReviewedPr` (line 594) doesn't guard against very small `reviewedPrIds.size`.

**Existing tests**: `impact-metrics.test.ts` (hermetic), `impact-api.test.ts` (hermetic guard layer), `impact.test.tsx` (component). Missing: edge-case unit tests for zero-PR boards, self-review-only periods, single-PR metric computation.

#### R8 (original): Account Deletion Cascade

**CASCADE chain** (from migrations):

- `auth.users` CASCADE → `boards` → `github_repos` → `github_pull_requests` → `github_reviews`, `github_review_comments`, `thread_classifications`
- `boards` CASCADE → `board_contributors`
- `board_contributors.user_id` → SET NULL (ghost contributor survives)

**Failure scenarios**:

1. **Running workflows orphaned**: board deleted while `ClassificationBatchWorkflow` is running — workflow continues writing to deleted repos/PRs. No guard in `worker.ts`.
2. **Board-only delete untested**: `account-deletion.test.ts` covers account deletion thoroughly, but no test verifies board-only deletion cascade.
3. **Ghost contributors**: when user A (contributor on user B's board) deletes their account, `board_contributors.user_id` is SET NULL but `github_id`/`github_login` columns remain.

**Existing tests**: `tests/integration/account-deletion.test.ts` (thorough for account deletion). Missing: board-only deletion integration test, running-workflow scenario.

### 4. Testing Phases Status

| Phase                                 | Status                                                                    | Evidence                                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 1 — Bootstrap + access boundary       | **shipped**                                                               | `context/archive/2026-06-09-testing-access-boundary/`                                         |
| 2 — Board creation contract           | **shipped**                                                               | `context/archive/2026-06-10-board-creation-contract/`                                         |
| 3 — Validation + data layer templates | **skipped**                                                               | `context/archive/2026-06-14-validation-data-layer-templates/` — covered by Phase 1+2 patterns |
| 4 — Quality gates                     | **shipped**                                                               | `context/archive/2026-06-14-quality-gates/`                                                   |
| 5 — Slice-ready contracts             | **not started** (plan says this, but tests were added alongside features) | —                                                                                             |

**Key observation**: Phase 5 is listed as "not started" but significant test coverage for deferred risks #7–#10 was added alongside their feature slices (not in a dedicated test phase). The plan should acknowledge this organic coverage and focus new phases on the gaps.

### 5. Historical Testing Decisions

1. **No e2e / Playwright**: Explicitly excluded in every testing phase. Now relevant for workflow chain (cannot test Cloudflare Workflows in Vitest).
2. **Cloudflare Workflow orchestration untestable in Vitest**: `step.do`/`step.sleep` are Cloudflare primitives (`context/archive/2026-06-30-bugfix/plan.md`).
3. **Thin RLS wrappers get no unit tests**: delete-board plan explicitly stated this (`context/archive/2026-07-07-delete-board/`).
4. **Manual testing as gate**: Post-Phase-4 features consistently used automated checks + manual verification.

## Code References

- `src/worker.ts` — Workflow chain (dispatch → sync-repo → orchestrate → prdetails → reviews → classify), 521 lines
- `src/lib/services/impact-metrics.ts` — Metric computation, 1146 lines
- `src/lib/services/github-sync.ts` — GitHub data fetching for sync pipeline
- `src/lib/services/classification.ts` — AI classification logic
- `src/pages/api/board/[boardId]/settings.ts` — Board rename PATCH
- `src/pages/api/board/[boardId]/index.ts:12` — Board DELETE handler
- `src/pages/api/board/[boardId]/repos.ts` — Repo add/remove
- `src/pages/api/board/[boardId]/contributors.ts` — Contributor add/remove
- `src/pages/api/profile/index.ts:14` — Account DELETE handler
- `tests/integration/account-deletion.test.ts` — Thorough cascade verification
- `tests/hermetic/impact-metrics.test.ts` — Metric function hermetic tests
- `tests/hermetic/sync-pr-batch.test.ts` — PR batch sync hermetic tests

## Architecture Insights

1. **The workflow chain is the highest-risk, hardest-to-test surface.** It spans Cloudflare Workflows (untestable in Vitest), multiple async phases, and fire-and-forget spawning. The only automated testing possible today is hermetic tests for individual data-transform functions. E2E or integration against a deployed preview would be needed for chain-level confidence.

2. **Tests grew organically alongside features**, not in a dedicated Phase 5. This is healthy but means the test plan's Phase 5 ("Slice-ready contracts") is partially obsolete — it should be replaced with phases targeting the specific gaps identified above.

3. **The settings API is a cluster of thin RLS wrappers.** The team's convention is not to unit-test these. Integration tests for authorization boundaries (non-owner rejection) are the right layer.

4. **Metric correctness is a pure-function problem** at its core. The 1146-line `impact-metrics.ts` is well-suited to unit/hermetic tests with known fixture data, testing edge cases (zero PRs, self-review only, timezone boundaries).

## Historical Context (from prior changes)

- `context/archive/2026-06-09-testing-access-boundary/` — Established two-client pattern, RLS assertion shapes, seed helpers
- `context/archive/2026-06-10-board-creation-contract/` — Established hermetic test pattern (`vi.mock()` + `vi.hoisted()`), component test pattern (`happy-dom`)
- `context/archive/2026-06-14-validation-data-layer-templates/` — Skip decision: Zod validation uniform across all routes, RLS covered by Phase 1
- `context/archive/2026-06-14-quality-gates/` — CI wiring, Lefthook, PostToolUse hooks
- `context/archive/2026-06-30-bugfix/` — Cloudflare Workflow untestability documented, hermetic tests for sync functions added
- `context/archive/2026-07-07-delete-board/` — "No unit tests needed" for thin RLS wrapper convention

## Related Research

- `context/archive/2026-06-14-validation-data-layer-templates/research.md` — Prior analysis of Zod validation uniformity
- `context/archive/2026-06-14-validation-data-layer-templates/frame.md` — Framing for Phase 3 skip decision

## Open Questions

1. **Should the test plan introduce E2E (Playwright)?** The workflow chain cannot be tested in Vitest. E2E against a deployed Cloudflare preview would cover the manual sync trigger → data appears flow. The existing test plan explicitly excluded E2E in Phases 1–4 — this decision should be revisited.

2. **How to test classification content retention (Risk #9)?** The "no raw comment content stored after classification" guardrail needs a test that classifies a thread and then asserts the stored output contains only classification labels, not original text. This requires either a real AI binding (integration) or a mocked one (hermetic) — the hermetic approach is cheaper but less trustworthy.

3. **Should IC-vs-EM parity (Risk #7) be tested at the API layer or UI layer?** The data-parity invariant ("IC sees same data as EM") could be tested by calling the same impact API with two different user roles and comparing responses, or by rendering the UI for both roles. API-layer is cheaper and more precise.

4. **What is the correct behavior for ghost contributors?** When a user deletes their account, `board_contributors.user_id` becomes NULL but the row persists. Is this intended behavior or a bug? The test plan needs to document the expected behavior before writing a test.

5. **Phase numbering**: Should new phases be 5–7 (as change.md suggests) or should Phase 5 ("Slice-ready contracts") be retired and replaced? The organic test growth suggests retiring Phase 5 and defining new phases around the 4 gap areas.
