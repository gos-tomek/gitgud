---
date: 2026-08-02T00:00:00+02:00
researcher: Tomasz Sierpinski
git_commit: 683b9f201a522056d040c36617ac76a6f16e5fa8
branch: project-map
repository: gos-tomek/gitgud
topic: "Refactor opportunities from post-flow-analysis — problem inventory, three-dimensional per-candidate exploration, and ranking"
tags: [research, refactoring, technical-debt, structural-risk, exploration, verified]
status: complete
last_updated: 2026-08-02
last_updated_by: Tomasz Sierpinski
last_updated_note: "Structural claims verified with ast-grep + grep at commit 683b9f2; in-place corrections use format 'actual (raport: reported)'. See §9. Ranking and intentionality verdicts unchanged."
verification_commit: 683b9f201a522056d040c36617ac76a6f16e5fa8
---

# Research: Refactor opportunities from post-flow-analysis

**Date**: 2026-08-02
**Researcher**: Tomasz Sierpinski
**Git Commit**: `683b9f201a522056d040c36617ac76a6f16e5fa8`
**Branch**: `project-map`
**Repository**: `gos-tomek/gitgud`

## Research question

Read `context/changes/post-flow-analysis/research.md` (the recorded technical debt & structural-risk report for this repo) and treat its findings as gathered evidence. List every problem it notes, classify each as **CANDIDATE** (a fix that would change code structure) or **non-candidate** (test gap, doc gap, product decision, etc.). For each candidate, run a three-dimensional exploration — current shape, historical intent, migration feasibility — with hard rules: no code changes, no target-architecture design, mark unknowns honestly, and stop for any candidate whose real fix is a business-concept redesign.

Close with 2–3 top-ranked refactor opportunities as input to a separate planning session.

## Summary

The source report catalogues ~40 concrete problems across 6 buckets (coverage, structural, error-handling, undocumented runtime knowledge, schema, observability) plus a "silent-coupling landmines" section that overlaps with structural. **12 items are test/coverage gaps and 5 are product/observability/schema decisions — non-candidates.** That leaves **9 distinct structural candidates**, after merging overlapping items (silent-coupling landmines are subsumed by the structural bullets).

Three parallel sub-agents (current shape, history, feasibility) ran across all 9 candidates. Verdicts split as follows:

- **Intentional constraint** (fix should respect the reason): C1 (dispatch contract lives across three files because `Workflow.create({params})` needs one interface, and instance-ID authz + dedup precision came from a real day-precision bug at `e05229b`), C4 (dual env decl is unavoidable — Cloudflare bindings can't live in `astro:env`), C7 (`AbortSignal` was tried in `324241c` and ripped out in `070e781` because `step.sleep` invalidates plugin-set signals).
- **Accidental complexity** (no historical defense): C2 (row-shape re-declarations grew per feature), C3 (7×`SupabaseClient` copies grew independently over 5 weeks; `plan.md` explicitly treats it as a template), C5 (`createGitHubClient` orphaned by `9ac661c`), C6 (asymmetric error catches are coincidence of authorship), C9 (`fetch()` URL rename incident PR #32 recorded, no tooling proposed since).
- **Business-decision required — stopped**: C8 (per-batch write transactionality is downstream of an unanswered product decision on partial-iteration semantics — §4.6 open question #5).

**Top 3 refactor opportunities**, ranked (details in §5):

1. **C1 — Cross-boundary Workflow-dispatch contract.** Extract a shared `src/lib/workflow-contract.ts` that owns `ClassificationBatchParams`, the `board-<boardId>-<dateStamp>` instance-ID builder, and the prefix authz parser. Highest coupling density in the app; incidentally closes the zero-coverage security gate at `sync/status.ts:53`.
2. **C2 — Row-shape type bridge.** Introduce generated (or hand-maintained) snake_case DB `Row` types that both writers (`github-sync.ts`) and readers (`impact-metrics.ts`, `classification.ts`, `boards.ts`) import. Makes column-name drift caught by `tsc --noEmit` — currently invisible everywhere except runtime.
3. **C9 — Typed API-route client for `fetch()` calls.** ~22 `/api/…` URL strings across 11 components with zero static checking. PR #32 (`034fa6d`) already broke this once; no tooling added since.

Two smaller cleanups (**C3** — dedupe `SupabaseClient`; **C5** — delete `createGitHubClient`) are trivial and best bundled into the first PR of C1 or C2 rather than standing alone. **C6** is a strong runner-up but the code-only fix leaves the user-signal gap (open question §10 bullet 1) unanswered — return to it after the top three.

---

## 1. Full problem inventory & CANDIDATE classification

Every distinct problem the source report notes, in the order it appears there. **CANDIDATE** = a fix that changes code structure. **Non-candidate** = test gap, doc gap, config gap, product/schema decision, or observability addition.

### From §4.1 — Coverage debt (all NON-CANDIDATES — writing tests, not restructuring)

| #   | Problem                                                                                                      | Source | Classification                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------- |
| P1  | Zero unit tests on `worker.ts` (7 phase methods + `scheduled` + `runStep`)                                   | §4.1   | non-candidate (tests)                                                                 |
| P2  | `scheduled` handler (`worker.ts:500-521`) has no test of any kind                                            | §4.1   | non-candidate (tests)                                                                 |
| P3  | `sync/status.ts:53` cross-board probe rejection — zero coverage                                              | §4.1   | non-candidate (tests) — **but see C1**; adding a test is the natural first step there |
| P4  | `sync.ts:66-78` duplicate-id branch — zero coverage                                                          | §4.1   | non-candidate (tests)                                                                 |
| P5  | `github.ts:120-125` real `GitHubAuthError` 401/403 mapping — zero coverage                                   | §4.1   | non-candidate (tests) — **but see C6**                                                |
| P6  | `github.ts:104-107` `GitHubRateLimitError` throw — zero coverage                                             | §4.1   | non-candidate (tests) — **but see C6**                                                |
| P7  | `syncPrBatch` `!prData` missing-alias silent-drop (`github-sync.ts:463-468`)                                 | §4.1   | non-candidate (tests)                                                                 |
| P8  | Recursive-halving path (`github-sync.ts:388-404`) untested                                                   | §4.1   | non-candidate (tests)                                                                 |
| P9  | DB-write error paths in `syncPrBatch` (`:583-609`)                                                           | §4.1   | non-candidate (tests)                                                                 |
| P10 | `upsertPullRequests` field-mapping regressions — no tripwire                                                 | §4.1   | non-candidate (tests)                                                                 |
| P11 | Incremental-sync cutoff (`github-sync.ts:244,246`) untested                                                  | §4.1   | non-candidate (tests)                                                                 |
| P12 | Multi-page paths (`mapPrNumbersToIds`, `read-pr-refs`, `runReviews` chain, `runClassify` recursive) untested | §4.1   | non-candidate (tests)                                                                 |

### From §4.2 — Structural / architectural debt

| #   | Problem                                                                                                           | Source                | Classification                                                               |
| --- | ----------------------------------------------------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------- |
| P13 | Contract-by-string between `pages/api/github/sync*.ts` ↔ `worker.ts` (params via `env.d.ts:13`; dedup convention) | §4.2, §3.4 landmine 4 | **CANDIDATE → C1**                                                           |
| P14 | Column-name coupling without a type bridge (`types.ts` mirrors decorative; readers re-declare inline)             | §4.2, §3.4 landmine 1 | **CANDIDATE → C2**                                                           |
| P15 | 7 hand-copied `type SupabaseClient` aliases                                                                       | §4.2, §3.4 landmine 2 | **CANDIDATE → C3**                                                           |
| P16 | Dual declaration of env vars (`env.d.ts` + `astro.config.mjs env.schema`)                                         | §4.2                  | **CANDIDATE → C4**                                                           |
| P17 | Wrangler `class_name` string reference to `worker.ts:95`                                                          | §4.2                  | non-candidate (Cloudflare config binding; cannot be structurally eliminated) |
| P18 | Dead export `createGitHubClient`                                                                                  | §4.2                  | **CANDIDATE → C5**                                                           |

### From §4.3 — Error-handling debt

| #   | Problem                                                                                     | Source     | Classification                                     |
| --- | ------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------- |
| P19 | `GitHubRateLimitError` never caught anywhere in `src/`                                      | §4.3       | **CANDIDATE → C6**                                 |
| P20 | `GitHubAuthError` catch surface asymmetric (not in `sync.ts` / `sync/status.ts` / Workflow) | §4.3       | **CANDIDATE → C6**                                 |
| P21 | `GitHubTokenMissingError` never caught                                                      | §4.3       | **CANDIDATE → C6**                                 |
| P22 | `runReviews:391-394` classify-spawn wrapped in log-only try/catch                           | §4.3       | **CANDIDATE → C6**                                 |
| P23 | No `AbortSignal` plumbing through the pipeline                                              | §4.3, §1.6 | **CANDIDATE → C7** (but see history verdict)       |
| P24 | Non-transactional per-batch writes in `syncPrBatch` (`:583` + `:598` commit independently)  | §4.3       | **CANDIDATE → C8** (with business-decision caveat) |

### From §4.4 — Undocumented Cloudflare runtime knowledge (NON-CANDIDATES — docs/ADR)

| #   | Problem                                                                                                                                                                                                                                      | Classification           |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| P25 | 50-sub cap, `step.sleep` doesn't reset budget, `Workflow.create({params})` requires one interface, 32 MiB RPC serialization limit, retries replay subrequests, cron dedup precision, PR #67/#68 reasoning — all live only in commit messages | non-candidate (docs/ADR) |

### From §4.5 — Schema / migration debt (all NON-CANDIDATES — schema decisions, not code structure)

| #   | Problem                                                          | Classification                                                                                   |
| --- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| P26 | Bot-name filter hard-coded in SQL (`20260704200000`)             | non-candidate (schema decision — move to config table is a data-model change, not code refactor) |
| P27 | `github_review_comments.review_id` FK dropped, filter still runs | non-candidate (schema/defensive-code trade-off; fix is a schema decision)                        |
| P28 | `batch_update_pr_sizes` bakes column types into RPC body         | non-candidate (schema decision)                                                                  |
| P29 | Three service-role grants land in separate follow-up migrations  | non-candidate (process/policy)                                                                   |

### From §4.6 — Observability / user-signal debt

| #   | Problem                                                                       | Classification                                                                                                                                                                      |
| --- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P30 | `getBoardLastSyncedAt` reports oldest repo's timestamp — surprising semantics | non-candidate — **business-concept redesign; STOP per hard constraint** (comment at `impact-metrics.ts:100-105` documents the deliberate choice; changing it is a product decision) |
| P31 | No end-user signal when daily cron sync fails                                 | non-candidate (product/UX decision; overlaps with C6 code-only half but the user-facing signal is product design)                                                                   |
| P32 | PR-list pagination has no stable cursor                                       | non-candidate — `dedupeById` is the working mitigation; no debt to fix                                                                                                              |
| P33 | No retry visibility (metrics)                                                 | non-candidate (observability addition, not restructuring)                                                                                                                           |

### From §3.4 — Silent-coupling landmines (subsumed above)

| #   | Problem                                                                   | Merged into                                                                               |
| --- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| P34 | `import type` from `types.ts` invisible to `lint:deps`                    | C2                                                                                        |
| P35 | Hand-copied `SupabaseClient` aliases                                      | C3                                                                                        |
| P36 | `fetch()` URL strings referencing sync routes (SyncIndicator.tsx:46, :62) | **CANDIDATE → C9** (new; not called out separately in §4.2 but explicit landmine in §3.4) |
| P37 | String-only binding + params contract                                     | C1                                                                                        |
| P38 | Instance-ID convention as authorization boundary                          | C1                                                                                        |
| P39 | SQL constraints/triggers assuming column shape                            | P27, P28                                                                                  |
| P40 | Cloudflare runtime assumptions in comments/method bodies                  | P25                                                                                       |

### CANDIDATE list (9)

| ID     | Candidate                                                                                          | Provenance            |
| ------ | -------------------------------------------------------------------------------------------------- | --------------------- |
| **C1** | Cross-boundary contract for Workflow dispatch (params + dedup + instance-ID authz)                 | P13 + P37 + P38       |
| **C2** | Row-shape type bridge for pipeline DB tables                                                       | P14 + P34             |
| **C3** | `SupabaseClient` type alias duplication (7 sites)                                                  | P15 + P35             |
| **C4** | Dual env-var declaration (`env.d.ts` + `astro.config.mjs env.schema`)                              | P16                   |
| **C5** | Dead export `createGitHubClient`                                                                   | P18                   |
| **C6** | GitHub error-class catch surface (Rate / Auth / TokenMissing / swallowed classify-spawn)           | P19 + P20 + P21 + P22 |
| **C7** | `AbortSignal` plumbing through pipeline                                                            | P23                   |
| **C8** | Non-transactional per-batch writes in `syncPrBatch` — **may cross into business-concept redesign** | P24                   |
| **C9** | Route-URL strings not typed / lint-visible                                                         | P36                   |

**Explicit stops (business-concept, not code structure)**:

- **P30** (`getBoardLastSyncedAt` semantics) — product decision on what "last synced" means when repos disagree. Not a refactor.
- **C8** (per-batch write atomicity) — advances only after answering open question §10.5: is partial-iteration allowed?

---

## 2. Per-candidate analysis

Each candidate covers three dimensions from three parallel exploration sub-agents: **A. Current shape** (evidence in code, marked evidence/inference/unknown), **B. History & intentionality** (verdict: intentional constraint / accidental complexity / unknown), **C. Migration feasibility** (existing abstraction, blast radius per source report, safety nets, first prerequisite step).

### C1 — Cross-boundary contract for Workflow dispatch

**A. Current shape.**

- **evidence** — `worker.ts:22-40` exports `interface ClassificationBatchParams { boardId; phase?; repoId?; owner?; repoName?; since?; syncStartedAt?; prChunk?; chunkIndex?; reviewPageIndex?; threadRootIds?; threadChunk? }`. Comment at `worker.ts:19-20` states one interface is mandatory because "`Workflow.create({params})` requires one type, and discriminated unions break… typing".
- **evidence** — the interface is bound into `Env` entirely via `src/env.d.ts:13`: `CLASSIFICATION_BATCH: Workflow<import("./worker").ClassificationBatchParams>;`. This is the **only** typed edge between `worker.ts` and `sync*.ts`.
- **evidence** — `src/pages/api/github/sync.ts` and `src/pages/api/github/sync/status.ts` import zero symbols from `@/worker` or `@/lib/services/github-sync`; they touch `astro`, `zod`, `cloudflare:workers`, `@/lib/supabase`, `@/lib/services/boards`, `@/lib/logger` only. Confirmed no direct edge.
- **evidence** — dedup key at three sites, no shared helper: `worker.ts:514` `` `board-${boardId}-${dateStamp}` ``; `sync.ts:59 (raport: :58-59)` builds identical string; `sync/status.ts:53` asserts `!instanceId.startsWith(`board-${boardId}-`)` as an **authz gate**. Child-instance prefixes (`repo-`, `orchestrate-`, `prdetails-`, `reviews-`, `classify-`) are string-literal at 10 `.create()` sites in `worker.ts` (verified in source report §9 #12).
- **inference** — the seam is entirely string- and env.d.ts-mediated; no compile-time symmetry beyond one generic.
- **Mixed responsibilities**: `env.d.ts:13` doubles as Cloudflare binding declaration and sole cross-file type import from `worker.ts`. No `WorkflowContract.ts`, no `instanceIds.ts`, no dispatch-client module exists.
- **Adequate target shape**: one shared module exporting `ClassificationBatchParams` (re-export) + instance-ID builder + authz-prefix parser.

**B. History & intentionality.**

- **evidence** — `ClassificationBatchParams` first shipped in `7f3c6c9` (2026-06-22, "classification-batch") as `{ boardId: string }`; grew by `fe14fd5`, `3e4c1d0`, `6beea9a`. Each phase-split PR added optional fields — shape organic, but single-interface constraint is real (research §4.4).
- **evidence** — Dedup-key day-precision is defended by commit `e05229b`: _"dateStamp (YYYY-MM-DD) caused silent spawn failures when a repo was synced more than once per day — workflow.create rejects duplicate IDs, the catch block swallowed the error, and no sync-repo instances ran"_. Ms-precision at child level is the fix; day-precision at top level is retained by design.
- **evidence** — `env.d.ts:13` seam added in `63e0667` alongside the custom entrypoint; motivation given in `b5c186a`: "declaration-merge bindings into `Cloudflare.Env` so `import { env } from 'cloudflare:workers'` is typed correctly".
- **evidence** — Instance-ID authz prefix at `sync/status.ts:53` and its producers (`worker.ts:514`, `sync.ts:59`) all landed in the same commit `7f3c6c9` — check and convention designed together.
- **Verdict: intentional constraint.** The _shape_ is deliberate (Cloudflare single-interface + past dedup bug). What's silent is the _coverage_ on the authz gate and the _shared-module absence_ — those are absent by omission, not by decision.

**C. Migration feasibility.**

- **Existing abstraction**: no single owner today; new leaf module needed (not new architecture, just a naming home).
- **Blast radius** (per source): §3.1 lists this as the "string-only static coupling"; §3.2 confirms `sync.ts`/`sync/status.ts` learn the params object only at runtime; §3.4 landmine #4; §4.2 elevates it to "contract-by-string across the largest coupling in the app". §9 #12: 10 `.create()` sites in `worker.ts`, 2 in `sync.ts`, `.get()` at `sync.ts:67` + `status.ts:73,96`. §9 #16 confirms prefix at exactly the three cited lines.
- **Safety nets**: `tsc --noEmit` sees only the `env.d.ts:13` generic; a new required params field trips it only at Workflow-typed call sites, not at the params-object shape (§3.3 "no test asserts `ClassificationBatchParams` shape"). §2.1 shows `sync/status.ts:53` has **zero coverage**. Only `sync-chain.spec.ts` (single happy-path) exercises the runtime contract. Dependency-cruiser does not model string contracts.
- **First step**: introduce `src/lib/workflow-contract.ts` that re-exports `ClassificationBatchParams` from `worker.ts` and adds `buildBoardInstanceId(boardId, stamp)` + `parseBoardInstanceId(instanceId)`. Refactor `sync/status.ts:53`, `sync.ts:59`, `worker.ts:514` to call the helpers. Add `tests/hermetic/workflow-contract.test.ts` for the round-trip. One PR, no behaviour change; the ID-prefix authz gate finally gets coverage.

---

### C2 — Row-shape type bridge for pipeline DB tables

**A. Current shape.**

- **evidence** — pipeline writers ignore `@/types`: `worker.ts`, `src/lib/services/github-sync.ts`, `src/lib/github.ts` have zero `from "@/types"` imports (verified §9 #9).
- **evidence** — `impact-metrics.ts:2-21` imports `@/types` but only for **view models** (`ImpactSummary`, `AuthorMetrics`, `WeeklyActivity`, `IntentCategory`, etc.) — none of them a row shape.
- **evidence** — inline snake_case DB-row re-declarations in read-path service files (Explore agent enumerated):
  - `impact-metrics.ts:27-42` `PrDb`, `:44-50` `ReviewDb`, `:52-59` `CommentDb`, `:965` `ClassifiedThreadRow`, `:1120` `ThreadMessageRow` — **5 inline types**.
  - `classification.ts:32-41` `CommentRow`, `:43-47` `PrRow` — **2 inline types**.
  - `boards.ts:4-8` `ContributorInput`, `:12-18` `BoardRow` — **2 inline types**.
- **evidence** — camelCase mirrors in `src/types.ts` (`GitHubPullRequest:21`, `GitHubReview:39`, `GitHubReviewComment:65`, `GitHubRepo:13`): **zero references** across `src/` and `tests/` outside `src/types.ts` itself. Decorative dead code.
- **Mixed responsibilities**: `impact-metrics.ts` is both a view-model service and a de-facto DB-row schema authority via its inline types.
- **Existing abstractions**: `@/types` exists but pipeline-write ↔ pipeline-read never both go through it. No Zod schema, no generated Supabase types (§3.3 verified).
- **Adequate target shape**: one canonical snake_case DB-row module (ideally generated Supabase types) consumed by both sides + delete the unused camelCase mirrors.

**B. History & intentionality.**

- **evidence** — No commit or plan doc discusses a shared row-shape module. Camel entities in `types.ts` grew per feature (`d42f7a87` "profile-raw-github-metrics", `7f3c6c9` "classification-batch", `75a1226` "per-user PAT storage").
- **evidence** — `impact-metrics.ts` (`d42f7a87`) imports `@/types` for view models _and_ re-declares its own inline row types — bifurcated from birth.
- **evidence** — `github-sync.ts` (`ba56375`, 2026-05-31) shipped with inline `BoardRepoRow`/`PullRequestRow` and has never imported from `@/types`. No reviewer note in `context/archive/2026-05-30-github-ingestion-access/` argues for or against a bridge.
- **Verdict: accidental complexity.** No evidence anyone weighed "one shared row type vs redeclare per site". Each feature added its own inline types; no one would defend the current split if asked today.

**C. Migration feasibility.**

- **Existing abstraction**: none; need new — either generated `Database` types from `supabase gen types` or a hand-maintained snake_case `Row` module.
- **Blast radius** (per source): §3.2 enumerates writer rows (`github-sync.ts:87-100, :179-192, :562-568`) and reader rows (`impact-metrics.ts` 12 `.from` chains + 5 RPC calls per §9 #11, `classification.ts:239,240,261`, `boards.ts:97,141,156`). §3.3 "Types & shapes" is the must-change-together list. §3.4 landmine #1: `import type` invisible to `lint:deps`. §4.2 second bullet: "Column-name coupling without a type bridge … Adding/renaming a column is invisible to `tsc --noEmit`."
- **Safety nets**: `tsc --noEmit` runs in CI + pre-commit + deploy but sees only the inline aliases; cannot detect column-name drift. Coverage on writers: §2.1 marks `syncPrBatch` / `syncReviewCommentsForRepo` / `listAndUpsertPrsForRepo` well-tested hermetic; §2.2 #8 flags `upsertPullRequests` field-mapping regressions as untripped. Coverage on readers: hermetic `tests/hermetic/impact-api.test.ts`, `impact-metrics.test.ts` exist. Nothing else guards the write↔read join.
- **First step**: land `supabase gen types typescript --local` output into `src/db/database.types.ts` + a re-export module `src/db/rows.ts` exporting `PullRequestRow = Database["public"]["Tables"]["github_pull_requests"]["Row"]` (etc., only pipeline tables). No consumers change. Follow-up PRs migrate one reader at a time; `impact-metrics.ts` reader for `github_pull_requests` is a natural first sub-step. Fully reversible.

---

### C3 — `SupabaseClient` type alias duplication

**A. Current shape.**

- **evidence** — `type SupabaseClient = NonNullable<ReturnType<typeof createClient>>` at exactly 7 `src/` sites (verified §9 #1): `github.ts:10`, `token-status.ts:3`, `services/classification.ts:6`, `services/boards.ts:10`, `services/github-sync.ts:22`, `services/impact-metrics.ts:23`, `pages/api/github/sync/status.ts:20`. Plus **4 more test sites** (`tests/hermetic/{classification-voting,sync-review-comments,list-and-upsert-prs,sync-pr-batch}.test.ts`).
- **evidence** — canonical export search: `src/lib/supabase.ts` and `src/lib/supabase-admin.ts` export factories with unnamed inferred return types. No file in `src/` exports a `SupabaseClient` type name.
- **inference** — alias only covers the SSR client (`createClient`). `worker.ts` uses the **service-role client** from `supabase-admin.ts` and does not alias its type at all — meaning several service function signatures accept a type they can't be called with in the Workflow path (type-safety mirage).
- **Adequate target shape**: single `export type SupabaseClient = …` in `src/lib/supabase.ts` (or new `src/lib/supabase-types.ts`), ideally covering both SSR and service-role variants.

**B. History & intentionality.**

- **evidence** — 7 sites landed independently across 5 weeks: `62baceb` boards.ts (May 29) → `c387f37` github.ts (May 31) → `ba56375` github-sync.ts (May 31) → `d42f7a87` impact-metrics.ts (Jun 17) → `7f3c6c9` classification.ts + sync/status.ts (Jun 22).
- **evidence** — `context/archive/2026-05-30-github-ingestion-access/plan.md` treats it as a **template**: _"`src/lib/services/boards.ts` follows async/await pattern — `SupabaseClient` first param, throw on error, snake→camelCase via helper. This pattern is the template for new services."_
- **evidence** — No commit message anywhere rejects a shared alias; no `src/lib/types/supabase.ts` history.
- **Verdict: accidental complexity.** The nearest "decision" enshrines copy-paste; growth was uncoordinated.

**C. Migration feasibility.**

- **Existing abstraction**: new tiny abstraction — no central types module owns this today.
- **Blast radius**: §3.4 landmine #2, §4.2 bullet three. All 7 files simply consume the alias — no runtime coupling. Lowest-risk candidate on the list.
- **Safety nets**: `tsc --noEmit` (src + tests) is complete for a type-only refactor. Hermetic tests in every touched service continue to exercise the types.
- **First step**: add the export to `src/lib/supabase.ts`, then in a _separate_ second PR mechanically replace the 7 duplicate declarations with `import type { SupabaseClient } from "@/lib/supabase"`. First PR is a no-op that only adds a symbol; second is fully mechanical. Bundle with C5 to avoid a "tiny PR" tax.

---

### C4 — Dual env-var declaration (`env.d.ts` + `astro.config.mjs env.schema`)

**A. Current shape.**

- **evidence** — `src/env.d.ts:10-22` declares (Cloudflare `Env`): `ASSETS`, `AI`, `CLASSIFICATION_BATCH`, `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SERVICE_KEY`, `GITHUB_TOKEN_ENCRYPTION_KEY`, `HOMEPAGE_CACHE`, `SENTRY_DSN`, `GITHUB_API_BASE_URL?`, `AI_MOCK?`.
- **evidence** — `astro.config.mjs:34-38` `env.schema` declares only: `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SERVICE_KEY`, `GITHUB_TOKEN_ENCRYPTION_KEY` — all `envField.string({ context: "server", access: "secret", optional: true })`.
- **evidence — overlap**: 4 vars appear in both.
- **evidence — drift**:
  - Declared only in `env.d.ts` (7): the 4 bindings + `SENTRY_DSN` + `GITHUB_API_BASE_URL` + `AI_MOCK`. `SENTRY_DSN` is a real secret used at `worker.ts:495` but absent from the Astro schema.
  - Optionality drift: astro schema marks all 4 as `optional: true`; `env.d.ts` types them as always-present. Runtime check in `supabase.ts:6` returns null on missing — consistent with astro but inconsistent with `env.d.ts`.
- **Mixed responsibilities**: `env.d.ts` conflates Cloudflare bindings (ASSETS, AI, KV, Workflow) with plain string secrets in the same brace block.
- **Adequate target shape**: shared source (e.g. `src/env-schema.ts`) imported by `astro.config.mjs` to build `envField` and by `env.d.ts` via `import type` to derive `Env` — with bindings declared separately.

**B. History & intentionality.**

- **evidence** — `astro.config.mjs env.schema` shipped in bootstrap commit `b4192d9` (2026-05-22).
- **evidence** — `src/env.d.ts`'s `Env` interface was added months later in `63e0667` (2026-06-18, "classification-batch p1: infrastructure & custom entrypoint") because Cloudflare `env` needs typed _bindings_ (`AI`, `CLASSIFICATION_BATCH`, `ASSETS`) that `envField` cannot express. `b5c186a`: "declaration-merge bindings into `Cloudflare.Env` so `import { env } from 'cloudflare:workers'` is typed correctly".
- **Verdict: intentional constraint.** Two runtimes (astro:env at request time; Cloudflare `env` in the Worker) require separate typings. The overlap on the 4 secret names is unavoidable. What's missing is a _sync-enforcement_ tool — an observability gap on top of a real constraint.

**C. Migration feasibility.**

- **Existing abstraction**: dedupe not possible (different runtimes); a shared _source of truth_ file is possible.
- **Blast radius** (per source): §3.3 lists both files as "must change together" plus CI env-injection; §4.2 bullet four. Every consumer that reads `import.meta.env.*` or `astro:env/server` is downstream but doesn't have to change if var names stay stable.
- **Safety nets**: CI runs `npx astro sync` before typecheck (`ci.yml:17`, `deploy.yml:29,53`); an `env.schema` change without a matching `env.d.ts` change surfaces as an `Env` type error in `worker.ts` at build time. `wrangler deploy --dry-run` validates bindings. **No test asserts the two lists are identical.**
- **First step**: add `scripts/check-env-schema.ts` (pre-commit + CI) that parses both files and asserts the symmetric difference of variable names is empty. Pure safety net, no source motion. Only after that lands would consolidation into a shared module be worth attempting.

---

### C5 — Dead export `createGitHubClient`

**A. Current shape.**

- **evidence** — `src/lib/github.ts:159-166` defines `export async function createGitHubClient(supabase, boardId, encryptionKey?): Promise<Octokit>` = `makeOctokit(await getGitHubToken(...))`.
- **evidence** — grep across `src/` and `tests/`: only 2 hits — the definition and a comment in `tests/integration/pat-leak.test.ts:186` (`// These paths never decrypt the PAT — they fail before reaching createGitHubClient.`). Zero call sites.
- **evidence** — no `context/` references outside the source report itself.
- **Adequate target shape**: delete the export; fix the stale comment.

**B. History & intentionality.**

- **evidence** — born in `c387f37` (2026-05-31, "github-ingestion-access p2") as the sole factory.
- **evidence** — `f62fdf6` (2026-06-30, PR #55) message: _"Extract `getGitHubToken()` from `createGitHubClient()` for token-only use."_ After that, `createGitHubClient` became a thin wrapper.
- **evidence** — the remaining caller `syncBoardGitHubData` was explicitly deleted in `9ac661c` (2026-07-05, "chore(bugfix): remove dead sync path"): _"remove `syncBoardGitHubData` … dead code, not imported anywhere; the dashboard sync button uses the Workflow, not this function."_ That deletion silently orphaned `createGitHubClient`; nothing since has touched it.
- **Verdict: accidental complexity.** Added intentionally in May, extracted-around in June, orphaned by the July cleanup that missed it.

**C. Migration feasibility.**

- **Existing abstraction**: deletion, not migration.
- **Blast radius**: zero at runtime (§9 #5 verified). Deleting also drops one tally each from `makeOctokit` (9→8 sites) and `getGitHubToken` (4→3 sites).
- **Safety nets**: `.dependency-cruiser.cjs` has `no-orphans` (whole-file only). ESLint catches unused _local_ symbols, not unused _exports_. `tsc --noEmit` cannot detect unused exports. Nothing prevents recurrence.
- **First step**: delete the 8-line function; run `npx tsc --noEmit && npm test`; ship. Optional follow-up: add `ts-prune` (or `knip`) as a recurring lint.

---

### C6 — GitHub error-class catch surface

**A. Current shape.**

- **evidence — throws** (all in `src/lib/github.ts`): `GitHubTokenMissingError` at `:139, :148, :153`; `GitHubRateLimitError` at `:106`; `GitHubAuthError` at `:121, :124`.
- **evidence — catches** (grep on `instanceof GitHub…Error`):
  - `GitHubAuthError`: 5 files, 6 catch sites — `repos.ts:80`, `validate-repo.ts:73`, `validate-pat.ts:63`, `collaborators.ts:107,117`, `profile/pat.ts:70`. **NOT caught** in `sync.ts`, `sync/status.ts`, `worker.ts`, `services/github-sync.ts`.
  - `GitHubRateLimitError`: **zero catches anywhere in `src/`**.
  - `GitHubTokenMissingError`: **zero catches anywhere in `src/`**.
- **evidence — pattern**: every route that catches `GitHubAuthError` also imports `makeOctokit` (all `:4`). The two Workflow-dispatch routes don't import `makeOctokit` and don't catch.
- **evidence** — `runReviews:383-395` classify-spawn try/catch: catches, logs `Failed to spawn classify for board …`, returns `{ classifyId: null }`. Step returns success → sync itself reports OK.
- **Mixed responsibilities**: three distinct error classes with three implicit lifecycle contracts, only one ever caught, only in half the routes that call the module.
- **Adequate target shape**: uniform error boundary at each dispatch/route layer (or a `withGitHubErrors()` wrapper) so all three classes have symmetric coverage; separate but related: a decision on user-facing signalling.

**B. History & intentionality.**

- **evidence** — catches added feature-by-feature, always by the PR that added the `makeOctokit` call: `e3e5611` / `e254ffd` (link-board-to-github-org), `413106a` / `4f95057` (invite-and-join-board), `b80f2eb` (edit-board-connection), `75a1226` (per-user PAT storage).
- **evidence** — the two Workflow-dispatch routes shipped in `7f3c6c9`/`f89592b` — they don't call `makeOctokit` at all; the GitHub call happens inside the Workflow, which fails async and cannot be turned into a synchronous HTTP response.
- **evidence** — no commit message says "we deliberately don't catch it in dispatch routes." Source report §4.6 and §10 flag the user-signal gap as an _open question_, not a resolved design.
- **Verdict: accidental complexity.** The pattern ("every route that calls `makeOctokit` catches it") is real but coincidental to authorship. The missing user signal on expired PAT during scheduled sync is a documented gap, not a documented trade-off.

**C. Migration feasibility.**

- **Existing abstraction**: extend existing classes through existing handlers; no new module needed. Two abstraction points would help: (1) a Workflow-step error wrapper in `worker.ts`, (2) extend the 4 API-route catches to also handle `GitHubRateLimitError` + `GitHubTokenMissingError`.
- **Blast radius** (per source): §3.2 enumerates catch sites; §4.3 lists asymmetries; §9 #6/#7/#8 verify. §4.6 open question §10.1: "intended user-facing signal when daily cron sync fails" — the user-facing half is undecided.
- **Safety nets**: §2.1 shows `github.ts:120-125` (real `GitHubAuthError` mapping) has zero coverage — "every hermetic caller stubs a fake" (§2.2 #3); `github.ts:104-107` (`GitHubRateLimitError` throw) also zero coverage (§2.2 #4). The existing catches are exercised via hermetic mocks but the real mapper is not.
- **Caveat / partial redesign flag**: closing this candidate fully requires the user-signalling product decision (§10.1). The **code-only half** (catch surface parity + Sentry classification) can ship independently.
- **First step**: add a hermetic test asserting the real `hook.error` mapping in `makeOctokit` maps 401/403 → `GitHubAuthError` and `x-ratelimit-remaining: 0` → `GitHubRateLimitError`. Lands the missing §2.2 #3/#4 coverage without touching production code; becomes regression guard for any subsequent catch-surface change.

---

### C7 — `AbortSignal` plumbing through pipeline

**A. Current shape.**

- **evidence** — grep `AbortSignal|signal:|abort\(` across `worker.ts`, `github-sync.ts`, `github.ts`: exactly one hit — a comment at `github-sync.ts:47`: _"Retry on transient network failures only (502, ETIMEDOUT). AbortSignal timeouts (60s) are NOT…"_. Zero actual `AbortSignal` construction, zero `{ signal }` request-option pass-through.
- **evidence — two non-caller-controllable abort layers exist**: (1) Octokit built-in 60 s `AbortSignal` per request; (2) wall-clock `BATCH_DEADLINE_MS = 180_000` at `github-sync.ts:340`, checked at `:350 (raport: :353)` — short-circuits _further_ GQL calls only, does NOT cancel in-flight requests.
- **evidence** — no `AbortController` at any API-route layer either.
- **Adequate target shape**: caller-provided `AbortSignal` threaded from Workflow step boundary through service functions to Octokit — OR explicit "no cancellation" documented invariant.

**B. History & intentionality.**

- **evidence** — caller-managed cancellation was **added** in `324241c` (PR #60): `AbortSignal.timeout(60s)` injected via `hook.before` in `makeOctokit`.
- **evidence** — it was **explicitly removed** in `070e781`: _"octokit plugins (retry, throttling) set their own `AbortSignal` on requests. Our `req.signal ??= AbortSignal.timeout(60s)` didn't override it (??= skips non-null), but after a Workflow `step.sleep` the plugin's signal was already expired — causing instant 'operation aborted due to timeout' on the next request. Removing the signal manipulation lets plugins manage their own timeouts."_
- **evidence** — Cloudflare Workflow steps aren't cancellable mid-execution; the only cancellation surface is `.terminate()` at instance level (`status.ts:82,97`), which is present.
- **Verdict: intentional constraint.** Caller-provided `AbortSignal` was tried, broke against `step.sleep`, and was actively ripped out. Current shape is the direct output of that lesson — not unshipped, rejected.

**C. Migration feasibility.**

- **Existing abstraction**: new — signature change on every service function + every phase in `worker.ts`. Adequate target shape: optional `opts: { signal?: AbortSignal }` last-parameter.
- **Cloudflare Workflow caveat**: **unknown** whether `WorkflowStep` exposes a cancellation signal or whether `.terminate()` fires one. Not documented in source report.
- **Blast radius**: §1.6 + §9 #13. All 3 hermetic services need mock signals. §3.2 shows 8 `makeOctokit` sites for API routes that likely also want signals passed from Astro's `AbortSignal`.
- **Safety nets**: hermetic coverage on all 3 services exists but never passes a signal today; new code paths get no coverage unless new tests added.
- **First step**: prototype in `listAndUpsertPrsForRepo` alone with a new hermetic test asserting abort-mid-pagination. Smallest surface; deliberately independent of the Cloudflare-cancellation unknown.

---

### C8 — Non-transactional per-batch writes in `syncPrBatch`

**Business-level decision required — STOPPING per hard constraint.**

**A. Current shape.**

- **evidence** — `github-sync.ts:581-595`: `rpc("batch_update_pr_sizes", { updates })` commits on RPC return.
- **evidence** — `github-sync.ts:596-611`: `github_reviews.upsert(rows, { onConflict: "id" })` — sibling of the above; independent commit.
- **evidence** — comment at `:576-579` explicitly documents "Supabase writes wrapped in try-catch: Cloudflare throws 'Too many subrequests' … re-thrown so the Workflow step fails and Cloudflare retries in a new invocation with a fresh 50-subrequest budget. Other exceptions are caught gracefully." **Design explicitly accepts partial success as a normal outcome inside a single batch.**
- **evidence** — no compensating mechanisms: no dead-letter table, no reconciliation job. Step-level retry (`worker.ts:312-316`) has `retries: { limit: 0 }`.

**B. History & intentionality.**

- **evidence** — write strategy oscillated deliberately across PRs (per `context/archive/2026-06-30-bugfix/research.md:380-430`):
  - PR #44 (`1a32fc7`): per-PR writes → hit 50-sub cap.
  - PR #47 (`36ad9eb`): end-of-loop batching → _"if the GQL calls exhausted the subrequest budget, the deferred Supabase writes also failed — losing all data from that batch, including already-fetched reviews"_.
  - PR #48 (`684c701`): per-GQL-batch flush → _"survived to final code"_.
- **evidence** — trade-off explicitly weighed: "lose whole chunk on failure" vs "flush per batch" — chosen for failure blast radius, not consistency. **Transactional wrapping of the pair was never proposed** in any commit or archive doc.
- **Verdict: intentional constraint on flush granularity; unexamined by-product on transactional wrap.**

**C. Migration feasibility — STOP.**

- **Target shape depends on the business decision** (open question §10.5): is partial iteration allowed?
  - If **allowed** (current behaviour): fix is observability-only (status column or per-batch ledger); no schema change.
  - If **not allowed**: single-transaction RPC accepting both `updates` + `reviews` (schema + RPC change) or saga/compensation (worker.ts change) — architectural, not refactor.
- Blast radius, safety nets, and first prerequisite step are all downstream of the decision. **Not sketched** per hard constraint.

---

### C9 — Route-URL strings not typed / lint-visible

**A. Current shape.**

- **evidence** — `SyncIndicator.tsx:46` (`/api/github/sync/status?…`), `:62` (`/api/github/sync`) verified.
- **evidence — enumeration of every `fetch("/api/…")` string in `src/components`** (11 files, **25 raw `fetch(` sites, ~28 URL literals when counting the 5 constructed inside `ImpactView.tsx:200-206` and 1 via the `url` param at `ThreadsView.tsx:86`) (raport: ~22 URLs)**; Explore agent produced full table):

  | File                      | URLs                                                                                                 |
  | ------------------------- | ---------------------------------------------------------------------------------------------------- |
  | `CreateBoardForm.tsx`     | 7 (validate-pat, repos, collaborators, profile/pat, board/check-name, validate-repo, board)          |
  | `ContributorManager.tsx`  | 3                                                                                                    |
  | `RepoManager.tsx`         | 3                                                                                                    |
  | `BoardNameEditor.tsx`     | 2                                                                                                    |
  | `SyncIndicator.tsx`       | 2                                                                                                    |
  | `DeleteAccountDialog.tsx` | 2                                                                                                    |
  | `ChangePasswordForm.tsx`  | 1                                                                                                    |
  | `PatUpdateForm.tsx`       | 1                                                                                                    |
  | `DeleteBoardDialog.tsx`   | 1                                                                                                    |
  | `ThreadsView.tsx`         | 2 (raport: 1) — `:86` via `url` param + `:271` literal `/api/board/{id}/threads/{login}/{root}/vote` |
  | `ImpactView.tsx`          | 1 raw `fetch(url)` at `:39` + 5 URL literals built at `:200-206` (5 sections × 1 endpoint each)      |

- **evidence — no typed route helper today**: no `src/lib/*route*` or `*api-client*` module.
- **evidence — no lint rule catches these**: `.dependency-cruiser.cjs` targets file-level imports only; `eslint.config.js` has no `no-restricted-syntax` for URL strings.
- **Mixed responsibilities**: each component owns UI state, URL construction, and response shape. Path templates like `` `/api/board/${boardId}/…` `` duplicated across ≥6 components.
- **Existing abstractions**: none. Zod schemas at each API route are duplicated implicitly on the client via untyped `res.json()` casts (e.g. `SyncIndicator.tsx:49`).
- **Adequate target shape**: typed API-client module (per-endpoint helpers or generated), route strings owned in one place.

**B. History & intentionality.**

- **evidence** — the incident is real: commit `034fa6d` (2026-06-15, "profile-raw-github-metrics p1"): _"renames `/boards/` -> `/board/` with 301 redirect"_. That's the PR #32 event.
- **evidence** — cushioned with a 301, but **no follow-up commit ever added a typed-routes utility, an Astro helper, or an ESLint rule.** `context/foundation/lessons.md`, `context/map/repo-map.md` name the gap; no change file targets it.
- **Verdict: accidental complexity.** Incident happened, was mitigated by redirect, catalogued as risk in the maps, no tooling proposed.

**C. Migration feasibility.**

- **Existing abstraction**: new — typed route-URL builder module or generated client from filesystem layout.
- **Blast radius** (per source): §3.1 lists `SyncIndicator.tsx` alongside `github-sync.ts` (2 joint commits) coupled only by URL strings; §3.4 landmine #3; §9 #19. 11 consumer files.
- **Safety nets**: zero. Astro's file-based routing gives strong nominal contract but no compile-time contract for callers. Only `sync-chain.spec.ts` validates two URL strings end-to-end.
- **First step**: add `src/lib/api-routes.ts` with `apiGithubSync(): "/api/github/sync"` and `apiGithubSyncStatus(query): string`. Refactor `SyncIndicator.tsx:46, :62` to call them. Establishes pattern; two references; reversible. Follow-up hermetic test reads `src/pages/api/**` and asserts every builder-returned URL resolves to an existing route file.

---

## 3. Cross-cutting notes on evidence

- No ADR/docs directory in this repo. All architectural reasoning lives in commit messages and per-change `research.md` / `plan.md` under `context/archive/`.
- The commit cluster `d22b80b, f62fdf6, 9176f74, 4b80ca4, ed37794, 070e781, ed4f364, 3ab026b, 2e32aa1, ea2fb61` + `context/archive/2026-06-30-bugfix/research.md` is the single richest source of design intent for the sync pipeline. Anything not documented there is de-facto **unknown** to the codebase.
- Every candidate got a decisive verdict — either a commit + archive doc settled intent (C1, C4, C7, C8) or the absence of any trace across the historical trail was itself decisive (C2, C3, C5, C6, C9). **No `unknown` verdicts** were forced.

---

## 4. CI / test posture summary (for feasibility)

- **`.github/workflows/ci.yml`** — `validate` job (lint + typecheck src + typecheck tests + vitest non-integration + build + `wrangler deploy --dry-run`); `test-integration` (real Supabase); `test-e2e` (real workerd + Playwright).
- **`.github/workflows/deploy.yml`** — pre-deploy typecheck + non-integration tests.
- **`lefthook.yml`** — pre-commit: eslint, prettier, tsc src, tsc tests, vitest non-integration.
- **`.dependency-cruiser.cjs`** — layer boundaries + circular + orphans + not-to-test. **No rule catches string-literal contracts** (URL, params, table names, class-name). Not wired into CI/lefthook — manual invocation only.
- **`vitest.config.ts`** — `environment: node`, 15 s default timeout.

---

## 5. Refactor opportunities (ranked, for a separate planning session)

Evidence-based ranking. The task is to identify **which** structural fixes are worth planning first — not to plan them. Selection weighs _cost of debt_ (how often the current shape hurts a change) against _cost of change_ (how disruptive the fix is, given existing abstractions and safety nets).

### 🥇 Rank 1 — C1: Cross-boundary contract for Workflow dispatch

- **Current → target shape.** Today: `ClassificationBatchParams` lives in `worker.ts:22-40`; the type crosses to `sync.ts` / `sync/status.ts` only through the `env.d.ts:13` generic; instance-ID convention and its authz-prefix check are open-coded string literals at three sites (`worker.ts:514`, `sync.ts:59`, `sync/status.ts:53`). Target: one shared `src/lib/workflow-contract.ts` module that re-exports the params type + owns `buildBoardInstanceId` / `parseBoardInstanceId` helpers.
- **Why this rank.** Highest coupling density in the app (source §3.1, §4.2); §9 #12 verifies 10 `.create()` sites in `worker.ts` + 2 in `sync.ts` + 3 `.get()` — every phase-chain edit walks this surface. The instance-ID prefix is an **authorization boundary with zero test coverage** (§2.2 #1) — a shared helper naturally comes with a round-trip test that closes that gap. Historical verdict is _intentional constraint_ on the interface shape (Cloudflare single-interface + past dedup bug `e05229b`) — a shared module does not violate any of that.
- **Cost of debt vs cost of change.** Debt: highest — pipeline is hotspot #1, and this is the surface every dispatch edit touches. Change: contained — one new leaf module, refactor of 3 call sites, one new hermetic test, no schema/migration involvement. Ratio: **high leverage**.
- **Blast radius.** `worker.ts`, `sync.ts`, `sync/status.ts`, `env.d.ts` (re-exports only), one new hermetic test. Zero DB, zero migration, zero Wrangler.
- **Incremental sketch.** (1) Add `src/lib/workflow-contract.ts` with `export type { ClassificationBatchParams } from "@/worker"` + builder/parser. (2) Add `tests/hermetic/workflow-contract.test.ts` for the round-trip and the authz prefix. (3) Refactor the 3 sites to call the helpers. Reversible at every step.
- **First prerequisite step.** Land the helper + test PR **before** touching any of the 3 call sites, so the test lives in isolation from behaviour change.

### 🥈 Rank 2 — C2: Row-shape type bridge for pipeline DB tables

- **Current → target shape.** Today: pipeline writers (`github-sync.ts`, `worker.ts`) use inline snake_case row types; readers re-declare their own (`impact-metrics.ts` has 5 such types, `classification.ts` has 2, `boards.ts` has 2); the camelCase mirrors in `src/types.ts:21-79` are decorative dead code (zero references outside the file). Target: a canonical snake_case `Row` module (generated by `supabase gen types`, or hand-maintained) imported by both writers and readers; delete the unused camelCase mirrors.
- **Why this rank.** Highest blast radius per repo-map — `types.ts` cascades to 19 files invisibly to `lint:deps` (source §3.4 landmine #1). Column-name drift is caught by nothing today except runtime — even `tsc --noEmit` misses it (source §4.2). This is the fix that turns the "silent coupling" theme from a documented risk into a compile-time contract. Historical verdict is _accidental complexity_ — no one would defend the current split.
- **Cost of debt vs cost of change.** Debt: very high (silent multi-file drift is the exact risk profile the source report calls out most persistently). Change: higher than C1 — needs a Supabase-types setup + migration of multiple readers. Reversible at every step (each reader migrates in its own PR). Ratio: **high leverage, longer runway.**
- **Blast radius.** Producer side: `github-sync.ts` writes (§3.2 `:87-100, :179-192, :562-568`). Reader side: `impact-metrics.ts` 12 `.from` chains + 5 RPC calls (§9 #11), `classification.ts:239,240,261`, `boards.ts:97,141,156`. Total ~20 code sites plus new generated file. No Wrangler / CI infra change.
- **Incremental sketch.** (1) Add `supabase gen types` config + generated `src/db/database.types.ts` + re-export module `src/db/rows.ts` for pipeline tables only (no consumers change). (2) Migrate one reader at a time, starting with `impact-metrics.ts`'s `github_pull_requests` reads (natural first sub-step). (3) Delete the camelCase mirrors in `types.ts` once no imports remain. Each PR reversible.
- **First prerequisite step.** Set up `supabase gen types typescript --local` in `package.json` scripts and land the generated file + re-export module as a **no-op landing pad PR**. Zero consumer changes; second PR starts the migration.

### 🥉 Rank 3 — C9: Typed API-route client for `fetch()` calls

- **Current → target shape.** Today: ~22 `/api/…` URL strings across 11 components; zero static tooling catches renames. Target: a `src/lib/api-routes.ts` module owning URL construction per endpoint (or generated from the `src/pages/api/**` filesystem), with a hermetic test that reads the pages tree and asserts every builder-returned URL resolves to an existing route file.
- **Why this rank.** Proven recurrence risk — commit `034fa6d` (PR #32) already broke this once, and no tooling was added afterward (source §3.4 landmine #3, repo-map §4). Verdict is _accidental complexity_; no historical defense. Fix is a solid structural win with a clean incremental path: two URLs at a time.
- **Cost of debt vs cost of change.** Debt: moderate-to-high (one incident already, no safety net, every future route rename is unsafe). Change: moderate — 11 files to migrate over multiple PRs, but each PR is small and reversible. Ratio: **medium-high leverage.**
- **Blast radius.** Consumer side: 11 component files. Producer side: file-based route tree under `src/pages/api/**` is the ground truth. Zero DB / migration / Wrangler.
- **Incremental sketch.** (1) Add `src/lib/api-routes.ts` with helpers for the two `SyncIndicator.tsx` URLs. (2) Refactor `SyncIndicator.tsx:46, :62` to call the helpers. (3) Add the filesystem-reads-vs-builder-output hermetic test. (4) Roll to remaining 10 components one PR at a time. Reversible.
- **First prerequisite step.** Two-URL bootstrap PR (helper module + `SyncIndicator.tsx` refactor + hermetic test). Establishes the pattern with the smallest possible commitment.

---

## 6. Considered and rejected / deferred

- **C3 — `SupabaseClient` alias dedupe (7 sites).** Trivial cost, trivial value. Recommended to **bundle** into the first PR of C1 or C2 rather than stand alone — a solo PR would be lower-value than either top-3 item. Not "rejected" in principle; just too small to rank on its own.
- **C4 — Dual env-var declaration.** Verdict: _intentional constraint_ — two runtimes (astro:env request-time; Cloudflare Env in Worker) genuinely require separate typings. Fix isn't a code-structure refactor, it's a small tooling addition (`scripts/check-env-schema.ts` in pre-commit + CI). Recommended alongside any C-track work but does not compete with the top three.
- **C5 — Dead `createGitHubClient`.** Trivial deletion, near-zero risk. Bundle with C3 into a "housekeeping" PR alongside C1 or C2. Not worth a standalone rank slot.
- **C6 — GitHub error-class catch surface.** Strong candidate on its own, but the fix has two halves: (a) code-only symmetric catch surface + Sentry classification; (b) user-facing signal decision (open question §10.1). Half (a) is structural refactor; half (b) is a product decision. **Deferred until the product-signal question is answered** — otherwise a partial fix leaves the same user-visible gap. The code-only half can then ship quickly.
- **C7 — `AbortSignal` plumbing.** **Rejected** for now. History proves this was tried (`324241c`, PR #60) and actively removed (`070e781`) after `step.sleep` broke plugin-set signals. Redoing it requires new Cloudflare knowledge about `WorkflowStep` cancellation that is currently `unknown` (source and Explore agent both). Return only after that Cloudflare-side gap is resolved.
- **C8 — Non-transactional per-batch writes.** **Explicitly stopped** — the target shape depends on the unanswered business-consistency question (§10.5: is partial iteration allowed?). Do not rank until that decision lands; the structural fix follows the decision, not the other way around.

---

## 7. Related research

- `context/changes/post-flow-analysis/research.md` — the source technical-debt report this analysis grounds in.
- `context/map/repo-map.md` — synthesis document that flagged `github-sync.ts` + `worker.ts` as hotspot #1 and named the un-tooled coupling channels (`import type`, `SupabaseClient`, `fetch()` URLs).
- `context/map/artifact-2-structure.md` — dependency-cruiser static graph.
- `context/map/artifact-4-changes-risk.md` — risk sensitivity classification.
- `context/archive/2026-06-30-bugfix/research.md` §6.2 — the PR #44 / #47 / #48 write-strategy trade-off documentation cited under C8.
- `context/archive/2026-05-30-github-ingestion-access/plan.md` — the "SupabaseClient template" line cited under C3.

## 8. Open questions

- Cloudflare-Workflow `WorkflowStep` cancellation semantics — does the runtime expose a signal that `.terminate()` fires? Answer would unblock C7.
- Business decision on `syncPrBatch` partial-iteration acceptability (source §10.5) — unblocks C8.
- Business decision on user-facing signalling for daily-cron sync failures (source §10.1) — unblocks the second half of C6.
- Whether Supabase-generated types are acceptable as a build-time artifact in this repo (impacts C2's target-shape choice — generated vs hand-maintained).

---

## 9. Weryfikacja twierdzeń (ast-grep)

Struktury liczbowe i lokalizacje `file:line`, na których stoi ranking, przeliczone o commit `683b9f201a522056d040c36617ac76a6f16e5fa8`. Każde zero z ast-grep potwierdzone klasycznym `grep -rn`. Werdykty w §5 ("Refactor opportunities") oraz w §2 ("Historia i intencjonalność") nie zostały zmienione — korekty dotyczą wyłącznie liczb i numerów linii.

| #   | Twierdzenie (skrót)                                                                                                                                                               | Werdykt                                | Dowód (plik:linia)                                                                                                                                                                                                                                                          | Metoda (wzorzec / reguła)                                                                                                                                         |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V1  | `ClassificationBatchParams` deklarowane w `worker.ts:22-40` z 12 polami                                                                                                           | **potwierdzone**                       | `src/worker.ts:22-40` (12 pól: `boardId`, `phase?`, `repoId?`, `owner?`, `repoName?`, `since?`, `syncStartedAt?`, `prChunk?`, `chunkIndex?`, `reviewPageIndex?`, `threadRootIds?`, `threadChunk?`)                                                                          | `ast-grep -p 'export interface ClassificationBatchParams { $$$ }' --lang typescript src/worker.ts`                                                                |
| V2  | Seam `env.d.ts:13` = `CLASSIFICATION_BATCH: Workflow<import("./worker").ClassificationBatchParams>`                                                                               | **potwierdzone**                       | `src/env.d.ts:13` — dokładny match                                                                                                                                                                                                                                          | `sed -n '13p' src/env.d.ts` + `grep -n 'CLASSIFICATION_BATCH' src/env.d.ts`                                                                                       |
| V3  | Komentarz o "single interface" przy `worker.ts:19-20`                                                                                                                             | **doprecyzowane**                      | Komentarz zajmuje `src/worker.ts:19-21` (3 linie, nie 2). Sedno claim niezmienione.                                                                                                                                                                                         | `sed -n '18,22p' src/worker.ts`                                                                                                                                   |
| V4  | `board-${boardId}-${dateStamp}` przy `worker.ts:514` i `sync.ts:58-59`                                                                                                            | **doprecyzowane**                      | `src/worker.ts:514` ✅; `src/pages/api/github/sync.ts:59` (nie :58-59; :58 to poprzedzająca linia z `dateStamp`)                                                                                                                                                            | `grep -rn 'board-\${boardId}-\${dateStamp}' src/`                                                                                                                 |
| V5  | Instance-ID authz gate `!instanceId.startsWith('board-${boardId}-')` w `status.ts:53`                                                                                             | **potwierdzone**                       | `src/pages/api/github/sync/status.ts:53` — dokładny match                                                                                                                                                                                                                   | `grep -n 'startsWith.*board-' src/pages/api/github/sync/status.ts`                                                                                                |
| V6  | 10 `CLASSIFICATION_BATCH.create(...)` w `worker.ts` + 2 w `sync.ts` + 3 `.get()`                                                                                                  | **potwierdzone**                       | worker.ts: `:135, :191, :202, :260, :281, :357, :386, :440, :449, :514` (=10); sync.ts: `:62, :74` (=2); .get: `sync.ts:67`, `status.ts:73, :96` (=3)                                                                                                                       | `ast-grep -p '$_.CLASSIFICATION_BATCH.create($$$)' --lang typescript src/worker.ts src/pages/api/github/sync.ts` + `.get($$$)`                                    |
| V7  | Prefiksy child-instancji `repo-`, `orchestrate-`, `prdetails-`, `reviews-`, `classify-`                                                                                           | **doprecyzowane**                      | Actual: `classify-`, `orchestrate-`, `reviews-`, `classify-dispatch-` widoczne w deklaracjach (`worker.ts:190, :201, :280, :385, :448`); `repo-` i `prdetails-` używane wewnętrznie w argumentach `.create({ id })` — nie w osobnych `const` declarations                   | `grep -n 'const .*Id = ` src/worker.ts`                                                                                                                           |
| V8  | 5 inline row types w `impact-metrics.ts`: `PrDb:27`, `ReviewDb:44`, `CommentDb:52`, `ClassifiedThreadRow:965`, `ThreadMessageRow:1120`                                            | **potwierdzone**                       | Dokładne dopasowanie linii                                                                                                                                                                                                                                                  | `grep -n '^interface ' src/lib/services/impact-metrics.ts`                                                                                                        |
| V9  | 2 inline row types w `classification.ts`: `CommentRow:32`, `PrRow:43`                                                                                                             | **potwierdzone**                       | Dokładne dopasowanie linii                                                                                                                                                                                                                                                  | `grep -n '^interface ' src/lib/services/classification.ts`                                                                                                        |
| V10 | 2 inline row types w `boards.ts`: `ContributorInput:4`, `BoardRow:12`                                                                                                             | **potwierdzone**                       | Dokładne dopasowanie linii                                                                                                                                                                                                                                                  | `grep -n '^interface ' src/lib/services/boards.ts`                                                                                                                |
| V11 | Mirrors camelCase w `types.ts`: `GitHubRepo:13`, `GitHubPullRequest:21`, `GitHubReview:39`, `GitHubReviewComment:65`; zero referencji poza plikiem                                | **potwierdzone**                       | Linie zgodne; 0 hitów w `src/` i `tests/` poza `src/types.ts` dla wszystkich 4 nazw                                                                                                                                                                                         | `grep -n '^export interface GitHubPullRequest\|GitHubReview\|GitHubReviewComment\|GitHubRepo' src/types.ts` + `grep -rn '\b<Name>\b' src/ tests/` per name (zero) |
| V12 | Pipeline files (`worker.ts`, `github-sync.ts`, `github.ts`) nie importują z `@/types`                                                                                             | **potwierdzone**                       | `grep -n 'from "@/types"'` na trzech plikach → 0 hitów                                                                                                                                                                                                                      | `grep -n 'from "@/types"' src/worker.ts src/lib/services/github-sync.ts src/lib/github.ts`                                                                        |
| V13 | 7 aliasów `type SupabaseClient = NonNullable<ReturnType<typeof createClient>>` w `src/`                                                                                           | **potwierdzone**                       | Dokładnie 7 hitów w podanych plikach/liniach: `github.ts:10`, `token-status.ts:3`, `services/classification.ts:6`, `services/boards.ts:10`, `services/github-sync.ts:22`, `services/impact-metrics.ts:23`, `pages/api/github/sync/status.ts:20`                             | `ast-grep -p 'type SupabaseClient = NonNullable<ReturnType<typeof createClient>>' --lang typescript src/`                                                         |
| V14 | 4 dodatkowe aliasy `SupabaseClient` w `tests/`                                                                                                                                    | **potwierdzone**                       | `tests/hermetic/sync-pr-batch.test.ts:6`, `classification-voting.test.ts:5`, `sync-review-comments.test.ts:6`, `list-and-upsert-prs.test.ts:6`                                                                                                                              | `ast-grep -p 'type SupabaseClient = NonNullable<ReturnType<typeof createClient>>' --lang typescript tests/`                                                       |
| V15 | `env.d.ts:10-22` deklaruje 11 pól w `Cloudflare.Env`                                                                                                                              | **potwierdzone**                       | Zakres `Cloudflare.Env` faktycznie `:10-23` (11 pól: `ASSETS`, `AI`, `CLASSIFICATION_BATCH`, `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SERVICE_KEY`, `GITHUB_TOKEN_ENCRYPTION_KEY`, `HOMEPAGE_CACHE`, `SENTRY_DSN`, `GITHUB_API_BASE_URL?`, `AI_MOCK?`)                     | `sed -n '1,30p' src/env.d.ts`                                                                                                                                     |
| V16 | `astro.config.mjs:34-38` deklaruje 4 zmienne w `env.schema`                                                                                                                       | **doprecyzowane**                      | Zakres faktycznie `:33-38` (schema key at :34, zawartość `:35-38`). 4 zmienne (`SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SERVICE_KEY`, `GITHUB_TOKEN_ENCRYPTION_KEY`) — wszystkie `optional: true`                                                                          | `sed -n '25,50p' astro.config.mjs`                                                                                                                                |
| V17 | `createGitHubClient` w `github.ts:159-166`, 0 call sites w `src/` i `tests/`                                                                                                      | **potwierdzone**                       | Definicja `:159-166` (8 linii); jedyne inne wystąpienie to komentarz w `tests/integration/pat-leak.test.ts:186`                                                                                                                                                             | `grep -rn 'createGitHubClient' src/ tests/` + `ast-grep -p 'createGitHubClient($$$)' --lang typescript src/ tests/` (0 wywołań)                                   |
| V18 | Throw sites: `github.ts:106` (RateLimit), `:121, :124` (Auth), `:139, :148, :153` (TokenMissing)                                                                                  | **potwierdzone**                       | Dokładne dopasowanie linii                                                                                                                                                                                                                                                  | `grep -n 'throw new GitHub' src/lib/github.ts`                                                                                                                    |
| V19 | `GitHubAuthError` catche: 5 plików, 6 sites (`repos.ts:80`, `validate-repo.ts:73`, `validate-pat.ts:63`, `collaborators.ts:107, :117`, `profile/pat.ts:70`)                       | **potwierdzone**                       | Dokładne dopasowanie linii; 0 catchy w `sync.ts`, `sync/status.ts`, `worker.ts`, `services/github-sync.ts`                                                                                                                                                                  | `grep -rn 'instanceof GitHubAuthError' src/`                                                                                                                      |
| V20 | `GitHubRateLimitError` — 0 catchy w `src/`                                                                                                                                        | **potwierdzone (grep-confirmed zero)** | 3 hity razem: definicja `:19`, przypisanie `.name` `:23`, throw `:106` — brak `catch`                                                                                                                                                                                       | `grep -rn 'GitHubRateLimitError' src/` (0 `instanceof`, 0 `catch (err: GitHubRateLimitError)`)                                                                    |
| V21 | `GitHubTokenMissingError` — 0 catchy w `src/`                                                                                                                                     | **potwierdzone (grep-confirmed zero)** | 5 hitów: definicja `:12`, `.name` `:15`, 3 throw (`:139, :148, :153`) — brak `catch`                                                                                                                                                                                        | `grep -rn 'GitHubTokenMissingError' src/` (0 `instanceof`)                                                                                                        |
| V22 | `runReviews` classify-spawn try/catch @ `worker.ts:383-395` (catch block `:391-394`)                                                                                              | **potwierdzone**                       | `spawn-classify` runStep zaczyna się `:383`, `try` `:384`, `catch (err)` `:391`, `return { classifyId: null }` `:393`, zamknięcie `:395`. Uwaga: drugie `spawn-classify` istnieje w `runSyncRepo` przy `:189` (empty-repo shortcut) — nie jest to ten, o którym mówi raport | `grep -n 'spawn-classify\|Failed to spawn classify' src/worker.ts` + `sed -n '380,398p' src/worker.ts`                                                            |
| V23 | 0 użyć `AbortSignal` / `signal:` / `abort(` w pipeline (`worker.ts`, `github-sync.ts`, `github.ts`) — jedyny hit to komentarz w `github-sync.ts:47`                               | **potwierdzone (grep-confirmed zero)** | Jedyny match: `src/lib/services/github-sync.ts:47` (komentarz `// … AbortSignal timeouts (60s) are NOT …`). 0 użyć runtime                                                                                                                                                  | `grep -n 'AbortSignal\|signal:\|abort(' src/worker.ts src/lib/services/github-sync.ts src/lib/github.ts`                                                          |
| V24 | `BATCH_DEADLINE_MS = 180_000` definiowane w `github-sync.ts:340`, sprawdzane w `:353`                                                                                             | **doprecyzowane**                      | Definicja `:340` ✅; **sprawdzenie w `:350 (raport: :353)`** — `const dl = deadline ?? Date.now() + BATCH_DEADLINE_MS;`                                                                                                                                                     | `grep -n 'BATCH_DEADLINE_MS' src/lib/services/github-sync.ts`                                                                                                     |
| V25 | `rpc("batch_update_pr_sizes", ...)` w `github-sync.ts:583`, blok `:583-595`                                                                                                       | **potwierdzone**                       | Wywołanie `:583`; blok try/catch `:582-595` (odpowiada zakresowi z raportu)                                                                                                                                                                                                 | `grep -n 'batch_update_pr_sizes' src/lib/services/github-sync.ts`                                                                                                 |
| V26 | `github_reviews.upsert(...)` w `github-sync.ts:598`, blok `:596-611`                                                                                                              | **potwierdzone**                       | Upsert `:598`; blok try/catch `:597-610` (odpowiada zakresowi z raportu)                                                                                                                                                                                                    | `grep -n '"github_reviews"' src/lib/services/github-sync.ts`                                                                                                      |
| V27 | `SyncIndicator.tsx:46` (status URL) i `:62` (dispatch URL)                                                                                                                        | **potwierdzone**                       | Oba matche dokładnie na wskazanych liniach                                                                                                                                                                                                                                  | `grep -n 'fetch(' src/components/impact/SyncIndicator.tsx`                                                                                                        |
| V28 | 11 plików w `src/components` zawiera `fetch(`; ~22 URL literals                                                                                                                   | **doprecyzowane**                      | 11 plików ✅; **25 raw `fetch(` sites + ~5 URL literals zbudowanych w `ImpactView.tsx:200-206` (5) = ~30 URL literals łącznie (raport: ~22)**                                                                                                                               | `grep -rn 'fetch(' src/components/`                                                                                                                               |
| V29 | `ThreadsView.tsx` — 1 fetch site                                                                                                                                                  | **obalone**                            | **2 fetch sites (raport: 1)**: `:86` (`fetch(url)` przez zmienną) + `:271` (literał `/api/board/{id}/threads/{login}/{root}/vote`)                                                                                                                                          | `grep -n 'fetch(' src/components/threads/ThreadsView.tsx`                                                                                                         |
| V30 | `/api/github/*` URLs — 7 across 5 files (`CreateBoardForm:58,106,127,251`, `ContributorManager:69`, `RepoManager:100`, `SyncIndicator:62`) — cytowany z §9 #19 raportu źródłowego | **obalone**                            | **8 URLs across 5 files** — lista raportu **omija `SyncIndicator.tsx:46`** (`/api/github/sync/status`). Pełna lista: 4 w CreateBoardForm (:58, :106, :127, :251), 1 w ContributorManager (:69), 1 w RepoManager (:100), 2 w SyncIndicator (:46, :62)                        | `grep -rn 'fetch(.*"/api/github/' src/components/`                                                                                                                |

**Konsekwencje dla rankingu (do decyzji na etapie planowania)**

Żaden werdykt nie zmienia pozycji kandydatów w §5 — potwierdzone są wszystkie kluczowe liczby, na których stał ranking (10 `.create()` sites w `worker.ts`, 7 aliasów `SupabaseClient`, 0 catchy dla `GitHubRateLimitError`/`GitHubTokenMissingError`, 5+2+2 inline row types, zero referencji do camelCase mirrors, 0 użyć `AbortSignal`). Doprecyzowania (V3, V4, V7, V16, V24) dotyczą numerów linii ±3 lub granic bloków — nie zmieniają charakteru dowodu.

Dwa **obalone** twierdzenia dotyczą C9 (V29, V30) i idą w **stronę wzmocnienia** rankingu tego kandydata, nie osłabienia: rzeczywista liczba stringów URL i sites jest wyższa niż raportowana, `SyncIndicator.tsx:46` jest dodatkowym `/api/github/*` konsumentem którego lista raportu nie ujmowała. C9 pozostaje na **Rank 3** — do decyzji na etapie planowania, czy podnieść jego wagę względem C2.

**Metoda weryfikacji**

- Dla twierdzeń o istnieniu i strukturze: `ast-grep -p '<pattern>' --lang typescript <path>`.
- Dla twierdzeń o braku (zerowej liczności) — `ast-grep` daje 0, następnie `grep -rn '<name>' <path>` sprawdza czy nie ma odniesień w komentarzach lub jako string literal (V17, V20, V21, V23).
- Dla twierdzeń o linii: `sed -n '<line>p' <path>` bezpośrednio, plus `grep -n` do zliczeń w pliku.
- Dla twierdzeń o enumeracji plików: `grep -rn '<pattern>' src/components/` — ast-grep pomija ekspresje templatek stringowych, więc dla `fetch("/api/…")` grep jest właściwszy.

Baza commitu weryfikacji: `683b9f201a522056d040c36617ac76a6f16e5fa8` (branch `project-map`, tożsamy z `git_commit` w frontmatter).
