# Change Risk Classification

> Generated: 2026-07-28 | Sources: `artifact-1-territory.md`, `artifact-2-structure.md`, `artifact-3-contributors.md`
> Scope: areas relevant from a change-risk perspective only — non-sensitive areas omitted or noted briefly at the end.

Sensitivity rated on evidence: high fan-in, public contract, frequent changes, co-change with other layers, cycles, runtime config, integrations, auth / data / cache / migrations / build.

Labels marked `unknown` or `needs verification` where evidence is insufficient.

---

## 1. Sync pipeline — `github-sync.ts` + `worker.ts`

| attribute            | value                                                    |
| -------------------- | -------------------------------------------------------- |
| role                 | core                                                     |
| depth                | deep                                                     |
| change profile       | volatile                                                 |
| blast radius         | load-bearing                                             |
| sensitivity          | **high**                                                 |
| contract layer       | `worker.ts` — Workflow phases, step orchestration        |
| implementation layer | `github-sync.ts` — `syncPrBatch` (fetch + map + persist) |

**Evidence:** 67 combined changes, one full revert (PR #68), zero unit tests for `worker.ts`. Cloudflare Workers constraints (50 subrequests per step, GQL batching, adaptive backoff) are encoded in method bodies with no inline documentation — no static tool sees them. A change can silently violate the runtime budget. Decision history lives only in commit messages.

---

## 2. `src/types.ts` — type contract hub

| attribute      | value                                                    |
| -------------- | -------------------------------------------------------- |
| role           | core                                                     |
| depth          | shallow (278 lines)                                      |
| change profile | volatile                                                 |
| blast radius   | load-bearing                                             |
| sensitivity    | **high**                                                 |
| contract layer | the file itself — exported types are the public contract |

**Evidence:** 19 files import via `import type` across 3 layers. `lint:deps` gives a false green — the cascade is only visible via `tsc --noEmit`. Co-change with 10 distinct directories: migrations (9×), services (8×), pages (7×), components (6×), all test layers. Acts as the bridge between schema changes and application code. Notable: `github-sync.ts` (hotspot #1) does **not** import from `types.ts` — it uses local types or infers from the Supabase schema.

---

## 3. `supabase/migrations/`

| attribute      | value                                      |
| -------------- | ------------------------------------------ |
| role           | core                                       |
| depth          | deep (44 migrations)                       |
| change profile | volatile → stabilising (35 in Q2, 9 in Q3) |
| blast radius   | load-bearing                               |
| sensitivity    | **high**                                   |

**Evidence:** Co-commit pairs: lib+migrations 16×, pages+migrations 13×. Triple co-commit `lib+pages+migrations` 12×. Schema does not roll back with a Worker rollback (only `wrangler rollback` reverts the Worker — per CLAUDE.md, expand/contract is mandatory). RLS policies are coupled to migration steps. Every schema change forces an update chain: migrations → types.ts → services → pages. No contract/implementation split — the SQL migration file is the contract.

---

## 4. `src/lib/supabase.ts` — DB client

| attribute            | value                                                                            |
| -------------------- | -------------------------------------------------------------------------------- |
| role                 | core (infrastructure)                                                            |
| depth                | shallow                                                                          |
| change profile       | stable                                                                           |
| blast radius         | load-bearing                                                                     |
| sensitivity          | **high**                                                                         |
| contract layer       | `createClient` + `SupabaseClient` shape (used as DI parameter in all 4 services) |
| implementation layer | cookie adapter, `@supabase/ssr` wiring                                           |

**Evidence:** fan-in 28 (2nd highest in static graph). Explains the lib+pages git co-change (17×). Cookie-based sessions — security-adjacent. All 4 services copy-paste `type SupabaseClient = NonNullable<ReturnType<typeof createClient>>` — any API surface change requires 4 manual edits. Stable module, but any change cascades across nearly the entire stack.

---

## 5. `src/lib/github.ts` — GitHub API client

| attribute            | value                                                                             |
| -------------------- | --------------------------------------------------------------------------------- |
| role                 | core (external integration)                                                       |
| depth                | medium (165 lines, 12 changes)                                                    |
| change profile       | volatile                                                                          |
| blast radius         | contained (fan-in 6)                                                              |
| sensitivity          | **high**                                                                          |
| contract layer       | client factory (PAT → Octokit instance)                                           |
| implementation layer | PAT decryption, `@octokit/plugin-throttling`, retry/backoff, AbortSignal handling |

**Evidence:** Security boundary — PAT encryption/decryption. Zero unit tests. Three external dependencies (Octokit, Supabase, env). Security decisions (non-leakage, AbortSignal override that broke GQL after `step.sleep`, throttling strategy) were built iteratively and are undocumented — they live only in commit history. Co-changes with the sync pipeline.

---

## 6. `src/lib/services/boards.ts` — board service

| attribute            | value                                                          |
| -------------------- | -------------------------------------------------------------- |
| role                 | core (board CRUD)                                              |
| depth                | medium (189 lines)                                             |
| change profile       | stable (9 changes, stabilising)                                |
| blast radius         | load-bearing                                                   |
| sensitivity          | **high**                                                       |
| contract layer       | function signatures (14 consumers depend on them)              |
| implementation layer | Supabase query chains (invisible to depcruiser via DI pattern) |

**Evidence:** fan-in 14 — every board operation routes through here. Zero dedicated tests — no safety net for changes. Integrates RLS, access control, invitations, and deletion across multiple migration phases. Static graph severely understates actual coupling because the Supabase client is injected as a parameter rather than imported.

---

## 7. `src/lib/logger.ts`

| attribute      | value        |
| -------------- | ------------ |
| role           | supporting   |
| depth          | shallow      |
| change profile | stable       |
| blast radius   | load-bearing |
| sensitivity    | **medium**   |

fan-in 29 (highest in the static graph), but a utility module — low probability of a fundamental change. No coupling with auth, data, or migrations. Fan-in is the sole evidence here.

---

## 8. `src/middleware.ts` — auth gate

| attribute      | value                                |
| -------------- | ------------------------------------ |
| role           | core                                 |
| depth          | shallow                              |
| change profile | stable (settled in Q2)               |
| blast radius   | load-bearing (runs on every request) |
| sensitivity    | **medium**                           |

Security-adjacent: controls the protected route list, populates `context.locals.user`. No churn since Q2. A change to the protected routes list is a silent auth gap — qualitative risk, not structural.

---

## 9. `src/lib/services/impact-metrics.ts`

| attribute      | value                                  |
| -------------- | -------------------------------------- |
| role           | supporting                             |
| depth          | deep (1150 lines, 24 functions)        |
| change profile | stable                                 |
| blast radius   | contained (fan-in 8, isolated subtree) |
| sensitivity    | **medium**                             |

**Evidence:** 1150 lines and an atomicity constraint on any split (all 5 API endpoints import the same `{boards, impact-metrics}` pair — a partial migration leaves endpoints on mixed imports). The API and UI subtrees are disconnected — changes do not propagate to components. Primarily a maintainability concern, not a cross-layer coupling risk.

---

## 10. `fetch()` URL coupling — cross-cutting

| attribute      | value                                                 |
| -------------- | ----------------------------------------------------- |
| role           | peripheral (coupling anti-pattern)                    |
| depth          | shallow (dispersed)                                   |
| change profile | stable (but a route rename already happened — PR #32) |
| blast radius   | **unknown**                                           |
| sensitivity    | **medium**                                            |

25 hardcoded URL strings across 11 components. TypeScript and depcruiser are both blind to them. A route rename produces a silent runtime failure with no static warning. `CreateBoardForm.tsx` is the most exposed (7 calls). Not a single module — a systemic coupling mechanism.

---

## Not classified (not sensitive enough)

| area                                | reason                                                                      |
| ----------------------------------- | --------------------------------------------------------------------------- |
| `classification.ts`                 | clean pipeline, good test coverage (unit + hermetic), contained             |
| `src/components/ui/`                | additive-only changes; shadcn primitives                                    |
| `src/components/auth/` + auth pages | settled in Q2, no recent churn                                              |
| `src/lib/utils.ts`                  | pure utility (`cn()`); fan-in 19 but stable                                 |
| `src/components/impact/`            | well-tested, isolated subtree                                               |
| `CreateBoardForm.tsx`               | complex but contained; primary risk is the `fetch()` URL coupling (see §10) |
| `src/lib/token-status.ts`           | possible dead code — verify before touching (marked in structure map)       |
