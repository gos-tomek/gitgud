# Refactor opportunities — Plan Brief

> Full plan: `context/changes/refactor-opportunities/plan.md`
> Research: `context/changes/refactor-opportunities/research.md`

## What & Why

Ship the top-3 structural refactor opportunities that `research.md` identified and ranked out of the ~40 problems catalogued in `post-flow-analysis/research.md`: (1) extract the cross-boundary Workflow-dispatch contract into a single owned module (C1), (2) close the silent DB row-shape drift with a generated `Row` type bridge (C2), and (3) replace ~30 hand-written `/api/…` URL literals across 11 components with a typed helper module and a hermetic route-contract test (C9). Two verified-trivial housekeeping items (C3 dedupe 7× `SupabaseClient` aliases, C5 delete dead export `createGitHubClient`) fold into Phase 1's PR because it touches the same services anyway.

## Starting Point

At commit `683b9f2` (`project-map` branch): the Workflow-dispatch contract is spread across four files as one type generic + open-coded string literals at three sites, one of which (`sync/status.ts:53`) doubles as an authorization gate with zero test coverage. Pipeline writers ignore `@/types`; readers each re-declare their own snake_case row types (`impact-metrics.ts` has 5, `classification.ts` 2, `boards.ts` 2); the camelCase mirrors in `src/types.ts` have zero references and are decorative dead code. The 11 client components contain ~30 `/api/…` URL literals; PR #32 already broke this once via a route rename and only a 301 redirect saved it. No lint or type-check tool catches any of these string-literal contracts today.

## Desired End State

`src/lib/workflow-contract.ts` is the sole owner of `ClassificationBatchParams`, `buildBoardInstanceId`, and `parseBoardInstanceId`; `worker.ts` and `env.d.ts:13` are consumers, and the authz gate at `sync/status.ts:53` has a hermetic test. `src/db/database.types.ts` (generated from `supabase gen types --local`, diff-checked in the `test-integration` CI job) plus `src/db/rows.ts` re-exports own DB row shapes; every reader and writer in the pipeline consumes them; the unused camelCase mirrors are deleted. `src/lib/api-routes.ts` owns every `/api/…` URL the client uses; every component `fetch`s via a helper; a hermetic test walks the pages tree and fails if any helper points at a non-existent route.

## Key Decisions Made

| Decision                         | Choice                                                                               | Why (1 sentence)                                                                                                                                                      | Source |
| -------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Which candidates to plan         | Top-3 (C1 + C2 + C9)                                                                 | Research ranked these as highest leverage; bundling captures the whole ranking in one plan the implementer can sequence.                                              | Plan   |
| C2 source of truth for Row types | Generated via `supabase gen types typescript --local`                                | Column-name drift becomes a build error automatically; single source of truth is the migration files.                                                                 | Plan   |
| C9 helper shape                  | Per-endpoint helpers in `src/lib/api-routes.ts`                                      | Matches research's incremental-sketch (two URLs at a time, reversible) and pairs naturally with a filesystem-scan enforcement test.                                   | Plan   |
| C3 / C5 housekeeping placement   | Bundled into Phase 1's PR alongside C1                                               | The workflow-contract PR already re-touches the services that alias `SupabaseClient`; no standalone tiny-PR tax; C1 diff stays small enough for review.               | Plan   |
| Safety-net tooling               | Two hermetic tests only (workflow-contract round-trip; api-routes filesystem-scan)   | Adequate coverage on the two silent contracts; declined `knip`/`ts-prune` and dep-cruiser URL rule to keep this change focused on structure, not lint infrastructure. | Plan   |
| Sequencing                       | Strict sequence C1 → C2 → C9 on one branch                                           | Matches research ranking; C1 and C2 both touch services so serial ordering keeps diffs clean; UI-side C9 composes cleanly last.                                       | Plan   |
| Phase 1 ownership direction      | `workflow-contract.ts` **defines** `ClassificationBatchParams`; `worker.ts` consumes | Re-exporting from `worker.ts` would leave it as source of truth and change nothing structurally — flagged during plan review.                                         | Plan   |
| Phase 2 CI diff-check placement  | `test-integration` job (has running Supabase), not `validate`                        | `supabase gen types --local` needs a live Supabase; placing the step in `validate` would fail with no DB to talk to — flagged during plan review.                     | Plan   |

## Scope

**In scope:**

- C1 workflow-contract module + 3 call-site migrations + hermetic round-trip test
- C3 `SupabaseClient` type dedupe (7 `src/` sites + 4 test sites)
- C5 delete `createGitHubClient` + fix stale comment
- C2 `supabase gen types` wiring + `src/db/rows.ts` re-export module + reader migration (`impact-metrics.ts`, `classification.ts`, `boards.ts`) + writer migration (`github-sync.ts`, `worker.ts`) + deletion of unused camelCase mirrors in `src/types.ts` + CI diff-check in `test-integration`
- C9 `src/lib/api-routes.ts` + hermetic filesystem-scan test + migration of 11 component files (~30 URL literals)

**Out of scope:**

- C4 dual env-var declaration (intentional constraint per research; would be tooling, not refactor)
- C6 GitHub error-class catch surface (needs product decision on user-facing signal)
- C7 `AbortSignal` plumbing (proven regression at `070e781`; needs Cloudflare-side knowledge)
- C8 non-transactional per-batch writes (needs business decision on partial-iteration semantics)
- Additional lint tooling: `knip`/`ts-prune`, dep-cruiser URL rule (declined during planning)
- Restructuring `src/types.ts` beyond deleting the four unused camelCase GitHub mirrors

## Architecture / Approach

One branch (`change/refactor-opportunities`), three sequential phases, one PR per phase. Each phase adds one canonical module owning what was previously drift-prone string literals or duplicated shapes, migrates existing consumers, and adds a hermetic safety net where absent. All three phases are pure structural refactors — zero runtime hot paths change, zero schema migrations, zero Wrangler changes. Every phase is fully reversible via `git revert` of its merge commit.

```
Phase 1  →  src/lib/workflow-contract.ts   (owns ClassificationBatchParams + instance-ID helpers)
            src/lib/supabase.ts             (exports SupabaseClient type)
            deletion of createGitHubClient
            hermetic: workflow-contract round-trip + authz reject

Phase 2  →  src/db/database.types.ts        (generated from Supabase)
            src/db/rows.ts                  (curated re-exports for pipeline tables)
            CI test-integration diff-check  (blocks migration/type drift)

Phase 3  →  src/lib/api-routes.ts           (per-endpoint URL builders)
            hermetic: filesystem-scan asserts every helper resolves to a route file
```

## Phases at a Glance

| Phase                                        | What it delivers                                                                                                               | Key risk                                                                                                                                                                                                                 |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. C1 workflow-contract + C3/C5 housekeeping | Single module owns dispatch contract; 7×`SupabaseClient` aliases deduped; dead export deleted; first coverage on authz gate.   | Silent semantic drift at the authz gate — mitigated by Commit 1a (module + characterization test asserting predicate equivalence) landing **before** Commit 1b touches any call site.                                    |
| 2. C2 row-shape type bridge                  | Generated `Database` types own DB row shapes; readers + writers consume them; unused camelCase mirrors gone; CI catches drift. | Migration/type drift while consumers are mid-migration — mitigated by Commit 2a (landing pad) → 2b (CI diff-check on) → 2c-g (consumer migrations) sequence. Diff-check must live in `test-integration`, not `validate`. |
| 3. C9 typed API-route helpers                | Every `/api/…` URL in components goes through a typed helper; filesystem-scan test blocks route-rename breakage à la PR #32.   | Rolling through 11 component files creates many small diffs — mitigated by one commit per file, or a single bundled PR if diffs stay small. Full Worker `wrangler deploy --dry-run` gates the SSR bundle at CI.          |

**Prerequisites:** Local Supabase (`npx supabase start`) needed for Phase 2 verification. Cloudflare account for Wrangler validation (already required by repo). Branch `change/refactor-opportunities` created from `main`.

**Estimated effort:** ~3 sessions (one per phase); Phase 3 is the widest surface but each file is a mechanical migration. Total under one week for a single implementer.

## Open Risks & Assumptions

- **Assumption**: `supabase gen types typescript --local` output at CLI version `2.101.0` is stable enough that a diff-check won't produce spurious churn between local and CI. Mitigation: CLI is already pinned exact-version in `package.json`.
- **Assumption**: The 4 unused camelCase `types.ts` mirrors are truly unreferenced — verified via `git grep` in research §9 V11, but re-verify at Phase 2 execution time in case any late PR reintroduced references.
- **Risk**: A parametric route helper in Phase 3 could disagree with Astro's actual dynamic-segment pattern (`[boardId]` etc.). Mitigation: the filesystem-scan test's normalization step is the canonical check; if it passes for a helper, that helper is contract-correct.
- **Risk**: Rolling through 11 components in Phase 3 as one PR could produce a large diff. Mitigation: implementer's discretion to split into per-component commits (or per-component PRs on the same branch) as needed.

## Success Criteria (Summary)

- After Phase 1, triggering a sync from the dashboard `SyncIndicator` still works end-to-end, cross-board status polls still 403, and no `SupabaseClient` alias declaration remains in `src/` or `tests/`.
- After Phase 2, a full sync writes PRs/reviews/comments and the impact view reads them back with no runtime shape errors; `git grep` finds zero inline snake_case row declarations in the migrated services; the CI diff-check would fail on a migration that lands without regenerating types.
- After Phase 3, no `fetch("/api/…")` string literal remains in `src/components/`; the hermetic filesystem-scan test fails when a route is renamed without updating the helper.
