# Frame Brief: Profile Raw GitHub Metrics

> Framing step before /10x-plan. This document captures what is _actually_
> at issue, separated from what was initially assumed.

## Reported Observation

S-04 (`profile-raw-github-metrics`) is proposed and next in line, but the scope feels undefined — the user isn't sure what metrics to show, whether a UI design step is needed, and whether the slice should use mocks or real data.

## Initial Framing (preserved)

- **User's stated cause or approach**: The change may be too vague to plan without settling the metrics list, UI design, and data-source strategy first.
- **User's proposed direction**: Discuss and resolve these open questions before planning.
- **Pre-dispatch narrowing**: PRD metrics list needs expansion (user confirmed). UI prototype with mocks before wiring real data (user confirmed). Design step needed before implementation (user confirmed). Metrics list should emerge from research, not be predefined (user's own framing — "I would like to discover it as part of the research to this work").

## Dimension Map

The observation could originate at any of these dimensions:

1. **Metrics definition gap** — The PRD's FR-009/010/011 (PRs authored, reviews given, comment count) may be insufficient for a useful profile. The DB stores richer data (PR state, draft flag, review verdicts, timestamps, file paths) that could surface additional metrics.
2. **UI design gap** — This is the product's first data-heavy page. No visual spec, wireframe, or layout exists. All prior slices (board CRUD, auth, invite) were form-based. ← initial framing lands here
3. **Scope packaging** — S-04 is written as one slice but may need to decompose into research/design → prototype → data wiring.
4. **Data shape readiness** — F-02 delivers raw Octokit access, but no profile-specific query/aggregation layer exists yet.

## Hypothesis Investigation

| Hypothesis                                     | Evidence                                                                                                                                                                                                                                                                                              | Verdict |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Metrics definition gap — PRD list insufficient | PRD defines 3 metrics (FR-009/010/011). DB stores 4 tables with state, dates, verdict, path, position data. User confirmed list needs expansion and wants research to surface the right metrics.                                                                                                      | STRONG  |
| UI design gap — no visual spec                 | Zero profile UI in codebase. `boards/[id].astro` shows repos + avatars only. `dashboard.astro` shows board list only. No component renders PR/review/comment data. First data-heavy surface. User confirmed design step needed.                                                                       | STRONG  |
| Scope packaging — single slice too broad       | S-04 roadmap entry lists one unknown ("empty-state copy"). User expects 3 phases: research → design/prototype → implementation. Roadmap assumed PRD settled the scope.                                                                                                                                | MEDIUM  |
| Data shape readiness — no query layer          | Data IS persisted in DB (4 `github_*` tables, synced via `POST /api/github/sync`). Join path `board_contributors.github_id` → `github_*.author_github_id` exists. Types defined in `src/types.ts`. No aggregation service or profile API endpoint exists yet, but this is normal implementation work. | WEAK    |

## Narrowing Signals

- User selected "PRD list needs expansion" — the 3 PRD metrics are a floor, not a ceiling.
- User selected "UI prototype first" — wants to see layout before wiring data.
- User selected "Design step needed" — this is the first user-visible data page.
- User chose to discover metrics through research rather than predefine them — the metric list should emerge from research (competitive analysis, available data shape, user needs), not be locked before design.

## Cross-System Convention

The first data-heavy page in a product typically receives a research/design pass before implementation. Prior slices (F-01, F-02, S-01, S-02, S-03) were all infrastructure or form-based CRUD that didn't require visual design. S-04 is the transition from "building the engine" to "building the dashboard" — the convention is to research + design first.

## Reframed (or Confirmed) Problem Statement

> **The actual problem to plan around is**: S-04 needs a research and design phase before implementation, because the metrics to display should emerge from research (not be predefined by the PRD minimums), and the UI for the product's first data surface needs a deliberate design pass.

The PRD's FR-009/010/011 define the _minimum viable_ metrics, but the DB already stores richer data (PR states, review verdicts, timestamps, file paths) that could surface more valuable insights. The user wants research to determine which metrics matter — not just implement the PRD floor. Additionally, this is the first page where users see the product's core value proposition (contribution visibility), so a mocks-first prototype validated before data wiring avoids expensive rework.

The data layer is NOT a blocker — 4 GitHub tables are populated, join paths exist, and types are defined. What's missing is the _what_ (which metrics) and the _how it looks_ (UI design), not the _how it works_ (data pipeline).

## Confidence

- **HIGH** — strong evidence on dimensions 1 and 2 + direct user confirmation + matches convention for first data-heavy surface.

## What Changes for /10x-plan

The plan should start with a research phase that explores available data, competitive profile patterns, and user needs to produce a metrics list and UI wireframe. Implementation follows the design, not the other way around. The PRD metrics are the floor — research may expand them using data already in the DB.

## References

- Source files: `src/lib/services/github-sync.ts` (sync service), `src/lib/github.ts` (client), `src/types.ts` (data types)
- DB schema: `supabase/migrations/20260531100000_github_ingestion_access.sql` (4 GitHub tables), `supabase/migrations/20260602120000_board_contributors.sql`
- Existing UI: `src/pages/boards/[id].astro` (board detail — no metrics), `src/pages/dashboard.astro` (board list only)
- PRD: `context/foundation/prd.md` §Metrics (FR-009, FR-010, FR-011), §NFR (progressive-load, data-parity)
- Roadmap: `context/foundation/roadmap.md` §S-04
