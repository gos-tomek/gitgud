# Territory Map — Project Activity Analysis

> Generated: 2026-07-28 | Data range: 2026-05-21 (project inception) – 2026-07-28 | 252 commits total

## 1. Timeline & Phases

The project started on 2026-05-21. Two distinct phases emerged:

| Phase                              | Period                 | Commits | Character                                                                             |
| ---------------------------------- | ---------------------- | ------: | ------------------------------------------------------------------------------------- |
| **Bootstrap + Core Features**      | May–Jun 2026 (Q2)      |     171 | Schema evolution (35 migrations), full-stack feature build, parallel UI + backend     |
| **Stabilisation + Classification** | Jul 2026 (Q3, partial) |      81 | Schema settling (9 migrations), worker refactoring, new classification voting feature |

Key shift: migration frequency dropped 4×, UI component churn nearly stopped, unit tests started appearing for the first time.

## 2. Hotspot Files (by change frequency)

Noise-filtered (no lockfiles, configs, context/, generated files).

| #   | File                                       | Changes | Lines | Role                                  |
| --- | ------------------------------------------ | ------: | ----: | ------------------------------------- |
| 1   | `src/lib/services/github-sync.ts`          |      37 |   620 | GitHub sync logic — #1 hotspot by far |
| 2   | `src/worker.ts`                            |      30 |   521 | Cloudflare Workflow entry point       |
| 3   | `src/lib/github.ts`                        |      12 |   165 | GitHub API client                     |
| 4   | `src/types.ts`                             |      10 |   278 | Shared types — hidden coupling hub    |
| 5   | `src/lib/services/boards.ts`               |       9 |   189 | Board CRUD                            |
| 6   | `tests/integration/pat-leak.test.ts`       |       8 |     — | PAT security test                     |
| 7   | `src/components/CreateBoardForm.tsx`       |       8 |   769 | Board creation wizard                 |
| 8   | `tests/component/CreateBoardForm.test.tsx` |       7 |     — | Wizard tests                          |
| 9   | `src/pages/dashboard.astro`                |       7 |    52 | Main dashboard                        |
| 10  | `tests/hermetic/board-creation.test.ts`    |       5 |     — | Board creation test                   |

### Deleted files (no longer valid targets)

| Former path                            | Reason                                                     | Successor                              |
| -------------------------------------- | ---------------------------------------------------------- | -------------------------------------- |
| `src/pages/api/boards/index.ts`        | Route refactored (`boards/` → `board/` singular) in PR #32 | `src/pages/api/board/index.ts`         |
| `tests/unit/github-sync-batch.test.ts` | Reverted in PR #68                                         | `tests/hermetic/sync-pr-batch.test.ts` |

## 3. Hotspot Directories

| #   | Directory                | Changes | Profile                                |
| --- | ------------------------ | ------: | -------------------------------------- |
| 1   | `src/lib/services/`      |      55 | Business logic — sync, boards, metrics |
| 2   | `supabase/migrations/`   |      44 | DB schema evolution                    |
| 3   | `src/components/impact/` |      30 | Impact feature UI views                |
| 4   | `tests/hermetic/`        |      24 | Most active test layer                 |
| 5   | `src/lib/` (root)        |      23 | GitHub client, utils                   |
| 6   | `tests/integration/`     |      18 | Supabase integration tests             |
| 7   | `tests/component/`       |      15 | React component tests                  |
| 8   | `src/components/ui/`     |      13 | shadcn/ui additions                    |
| 9   | `src/pages/api/github/`  |      12 | GitHub API endpoints                   |
| 10  | `src/components/auth/`   |      12 | Auth flow components                   |

## 4. Coupling Analysis

### Top directory pairs (co-occurrence in same commit)

| Pair                                | Co-commits | Interpretation                                      |
| ----------------------------------- | :--------: | --------------------------------------------------- |
| `src/lib` + `src/pages`             |     17     | Service → page coupling (SSR direct calls)          |
| `src/lib` + `supabase/migrations`   |     16     | Schema change = service change (types.ts as bridge) |
| `src/components` + `src/pages`      |     15     | Astro island pattern (component embedded in .astro) |
| `src/pages` + `supabase/migrations` |     13     | Full-stack features landing in one commit           |
| `src/components` + `src/lib`        |     12     | Components consuming services                       |

### Top directory triples

| Triple                                                 | Co-commits |
| ------------------------------------------------------ | :--------: |
| `src/lib` + `src/pages` + `supabase/migrations`        |     12     |
| `src/components` + `src/lib` + `src/pages`             |     12     |
| `src/components` + `src/pages` + `supabase/migrations` |     9      |
| `src/components` + `src/lib` + `supabase/migrations`   |     9      |

### Hub file: `src/types.ts`

Co-changes with 10 distinct directories (migrations 9×, services 8×, pages 7×, components 6×, all test layers). Every data-shape change cascades through the full stack. At 278 lines it's manageable now; splitting into domain-scoped type files (`types/boards.ts`, `types/impact.ts`) would reduce blast radius when it grows.

## 5. File Size & Complexity

### Largest source files

| File                                     | Lines | Concern                                   |
| ---------------------------------------- | ----: | ----------------------------------------- |
| `src/lib/services/impact-metrics.ts`     |  1150 | 6 independent query functions in one file |
| `src/components/CreateBoardForm.tsx`     |   769 | Single monolithic wizard component        |
| `src/components/threads/ThreadsView.tsx` |   625 | Thread list view                          |
| `src/lib/services/github-sync.ts`        |   620 | Hotspot #1 — sync logic                   |
| `src/worker.ts`                          |   521 | Workflow orchestrator (6-phase switch)    |
| `src/lib/services/classification.ts`     |   432 | AI classification pipeline                |
| `src/components/wizard-reducer.ts`       |   424 | Wizard state management                   |

### Call-depth analysis

| File                  |      Functions      | Max depth | Verdict                                                                   |
| --------------------- | :-----------------: | :-------: | ------------------------------------------------------------------------- |
| `classification.ts`   |         10          |     4     | Healthy pipeline — depth = separation of concerns                         |
| `github-sync.ts`      |         15          |     3     | `syncPrBatch` (211 lines) does too much — fetch, map, persist             |
| `impact-metrics.ts`   |         24          |     2     | Flat tree — 6 independent features sharing helpers; easy mechanical split |
| `worker.ts`           | 3 (+ class methods) |     1     | Depth is low because logic lives in class methods; size is the issue      |
| `CreateBoardForm.tsx` |          1          |     0     | 769 lines, zero internal decomposition                                    |

### Refactoring candidates (priority order)

1. **`impact-metrics.ts`** (1150 lines, 6 independent exports) — mechanical split into per-feature modules, zero risk.
2. **`CreateBoardForm.tsx`** (769 lines, 8 changes, 13-dir coupling) — size × churn × coupling = highest maintenance cost. Split into step components.
3. **`github-sync.ts`** (620 lines, 37 changes, depth 3) — hotspot #1. `syncPrBatch` (211 lines) is the main target: extract `fetchPrDetails`, `fetchReviews`, `persistResults`.

## 6. Healthy Patterns Observed

- **Tests track production code**: `CreateBoardForm` has 8+7 changes in prod/test pair.
- **Schema is stabilising**: migrations dropped from 35 (Q2) to 9 (Q3).
- **Classification pipeline** (`classification.ts`): deep call chain but clean separation — each function is short and single-purpose.
- **Worker phases** are well-structured internally despite living in one file — each phase is a separate class method.
