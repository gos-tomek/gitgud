# Structure Map — Dependency Analysis

> Generated: 2026-07-28 | Tool: dependency-cruiser 18.1.0 | Scope: `src/` (110 modules, 346 dependencies)
> Complements: `artifact-1-territory.md` (git activity) — this artifact covers static import structure.

## 1. Setup

`dependency-cruiser` added to `devDependencies` and configured in `.dependency-cruiser.cjs`.
Active rules: `no-circular`, `not-to-unresolvable` (virtual modules excluded), `no-orphans`, `not-to-test`, `no-non-package-json`, `not-to-deprecated`, plus five layer-boundary guards (see §4).

Scripts added to `package.json`:

| Script | Purpose |
| --- | --- |
| `npm run lint:deps` | Validate rules — exit code > 0 on violations. CI candidate. |
| `npm run graph` | Full dependency graph → SVG (requires `graphviz`) |
| `npm run graph:archi` | High-level architecture view → SVG |

## 2. Graph Shape

**Zero circular dependencies.** The import graph is a DAG.

**Effective layer order** (dependency direction flows downward — lower layers must not import upper):

```
types.ts  ←  lib/  ←  lib/services/  ←  components/  ←  pages/ / layouts/ / entry
```

All five layer-boundary rules verified clean on current codebase (0 violations).

## 3. Coupling Hubs (fan-in, I = instability)

Modules with high fan-in are the highest blast-radius targets for any change.

| Module | fan-in | I | Notes |
| --- | ---: | ---: | --- |
| `src/lib/logger.ts` | 29 | 0.00 | Most depended-on module. Not in territory map. |
| `src/lib/supabase.ts` | 28 | 0.00 | DB client. Mechanism behind `src/lib + src/pages` git co-change (17×). |
| `src/lib/utils.ts` | 19 | 0.00 | `cn()` helper. Imported by every shadcn/ui component. |
| `src/types.ts` | **0*** | — | *Runtime fan-in only. See §5. |
| `src/lib/services/boards.ts` | 14 | 0.00 | Board service. Zero dedicated tests. |
| `src/lib/services/impact-metrics.ts` | 8 | 0.00 | Imported by 5 API endpoints. Refactor candidate #1 (see §6). |
| `src/lib/date-range.ts` | 8 | 0.00 | Imported by both `pages/` and `components/`. |
| `src/lib/github.ts` | 6 | 0.14 | Octokit wrapper + PAT decryption. Three external deps (Octokit, Supabase, env). |

**Highest fan-out** (most exposed to upstream changes):

| Module | fan-out | I | Notes |
| --- | ---: | ---: | --- |
| `src/components/impact/ImpactView.tsx` | 12 | 0.92 | Composition root for impact feature. |
| `src/components/CreateBoardForm.tsx` | 10 | 1.00 | Hotspot #7. 769 lines. |
| `src/components/threads/ThreadsView.tsx` | 10 | 1.00 | 625 lines. |

## 4. Layer Boundary Rules (enforced in `.dependency-cruiser.cjs`)

| Rule | Severity | What it prevents |
| --- | --- | --- |
| `no-lib-to-components` | error | `lib/` importing UI components |
| `no-lib-to-pages` | error | `lib/` importing routes |
| `no-components-to-pages` | error | Components importing pages |
| `no-ui-to-feature-components` | error | shadcn/ui primitives importing feature components |
| `no-cross-service` | warn | Services importing each other |

## 5. Three Invisible Coupling Channels (not visible to dependency-cruiser)

### 5a. `import type` — TypeScript-only coupling

`src/types.ts` has runtime fan-in = 0 but **19 files** import from it via `import type`:

- All 11 `components/impact/` subcomponents
- `ContributorManager.tsx`, `ThreadsView.tsx`
- `lib/classification-colors.ts`, `lib/date-range.ts`
- `lib/services/boards.ts`, `lib/services/classification.ts`, `lib/services/impact-metrics.ts`

**Consequence:** Changing any exported type in `types.ts` cascades through `tsc` errors across 3 layers. `npm run lint:deps` stays green; only `npm run test:typecheck` (or `tsc --noEmit`) catches the blast.

`github-sync.ts` (hotspot #1) does **not** import from `types.ts` — its types are defined locally or inferred from Supabase schema.

### 5b. Dependency Injection — Supabase client as parameter

All four services (`boards.ts`, `impact-metrics.ts`, `github-sync.ts`, `classification.ts`) receive the Supabase client as a first parameter rather than importing it. This is correct DI and makes services testable in isolation, but:

- Each service copy-pastes `type SupabaseClient = NonNullable<ReturnType<typeof createClient>>` locally — 4 identical definitions. A migration to a different client requires 4 edits.
- The static graph shows services with fan-out = 1 (only `logger.ts`), which **severely understates** their actual coupling.

### 5c. `fetch()` URL strings — runtime API coupling

25 `fetch()` calls across 11 components reference API endpoints by hardcoded string URL. TypeScript does not verify these; dependency-cruiser does not see them. A route rename is invisible to all static tooling.

| Component | fetch() calls | Distinct endpoints |
| --- | ---: | ---: |
| `CreateBoardForm.tsx` | 7 | 7 |
| `ContributorManager.tsx` | 3 | 2 |
| `RepoManager.tsx` | 3 | 1 |
| `ThreadsView.tsx` | 2 | 2 |
| `SyncIndicator.tsx` | 2 | 2 |
| Others (5 dialogs/forms) | 1–2 each | 1 each |

**Note:** A route rename already happened once (`boards/` → `board/`, PR #32 per territory map).

## 6. Refactor #1 Blast Radius — `impact-metrics.ts`

Rendered as dependency graph: https://claude.ai/code/artifact/ab4ae83c-6745-44b9-81e2-5d7564eb9d9a

Scope: `--include-only "impact-metrics|boards|api/board/[boardId]/impact|components/impact"` — 19 nodes, 16 edges.

**Key finding from graph:** The API layer and UI layer form two disconnected subtrees — no edge crosses from services to components. Splitting `impact-metrics.ts` into 6 files touches only the left subtree (5 API endpoints + 2 service files). The 11 UI components are unaffected.

**Atomicity requirement:** All 5 impact API endpoints import the same `{boards, impact-metrics}` pair. The split must land in one PR; partial migration leaves endpoints on mixed imports.

## 7. Testability Profile

| Module | Unit test | Integration | E2E | Blocker |
| --- | :---: | :---: | :---: | --- |
| `boards.ts` | ⚠ hard | ✅ preferred | — | Supabase mock surface (query chain) |
| `impact-metrics.ts` | ⚠ hard | ✅ preferred | — | 13 functions × complex SQL |
| `github-sync.ts` | ⚠ hard | ✅ hermetic exists | — | Supabase + Octokit mock combined |
| `classification.ts` | ⚠ partial | ⚠ CF env | ✅ | Workers AI binding (`ai.run()`) |
| `worker.ts` | ❌ | ⚠ CF env | ✅ | CF Workflow + Sentry + DurableObject |
| `github.ts` | ⚠ partial | ✅ preferred | — | Supabase + env var + crypto in one function |
| `CreateBoardForm.tsx` | ⚠ fragile | — | ✅ golden path | 7 fetch() via `vi.stubGlobal` — shape changes silent |
| `ImpactView.tsx` | — | — | ✅ | Dynamic fetch; subcomponents are pure props → unit-testable |
| `SyncIndicator.tsx` | ❌ | — | ✅ | **No tests exist.** Polling pattern needs `vi.useFakeTimers()`. |

**Already well-covered:** `impact/` area has 4 test files (component + integration + 2 hermetic). `classification.ts` has both unit and hermetic tests including timer control. `sync-pr-batch` hermetic covers GQL errors and subrequest re-throw.

**Gaps:** `SyncIndicator.tsx` (zero tests), `boards.ts` (zero dedicated tests), `github.ts` (zero tests).

## 8. Orphans (fan-in = 0 in runtime graph)

Confirmed orphans requiring investigation:

| File | Likely reason | Action |
| --- | --- | --- |
| `src/types.ts` | `import type` only — see §5a | No action needed |
| `src/lib/token-status.ts` | Possibly unused or loaded from `.astro` | Verify — may be dead code |
| `src/components/ActivityChart.tsx` | Loaded from `.astro` page (depcruise blind spot) | Verify `.astro` import exists |
| Most `src/components/*.tsx` leaves | Loaded from `.astro` pages — framework entry points invisible to depcruise | Expected pattern |

Root cause for most component orphans: Astro pages load React components via `client:*` directives in `.astro` files. Dependency-cruiser resolves `.astro` → `.tsx` edges partially; orphan warnings for components that are demonstrably in use can be suppressed by extending `no-orphans.pathNot`.
