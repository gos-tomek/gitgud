# Contributor Impact Page — Plan Brief

> Full plan: `context/changes/profile-raw-github-metrics/plan.md`
> Frame brief: `context/changes/profile-raw-github-metrics/frame.md`
> Research: `context/changes/profile-raw-github-metrics/research.md`

## What & Why

Build GitGud's first data-heavy page — a contributor impact view showing 20 GitHub metrics across 4 tiers, with thread-level review analysis as the differentiator no competitor has. The PRD defines 3 metrics as the floor (FR-009/010/011); research discovered 17 more that are FREE or CHEAP to derive from data already in the DB. This is the first page where users see the product's core value proposition: making invisible "glue work" visible.

## Starting Point

Four GitHub tables are populated by the sync service (`github_pull_requests`, `github_reviews`, `github_review_comments`, `board_contributors`). Join paths exist. No aggregation service, no profile/impact API endpoints, no profile UI components exist. The board detail page (`boards/[id].astro`) shows repos and avatars only. Four columns needed for thread metrics and PR size are in the API response but not stored (`in_reply_to_id`, `additions`, `deletions`, `changed_files`).

## Desired End State

A board member navigates to `/board/:id/impact/:login/90d` and sees a rich, interactive metrics dashboard: 6 KPI cards with period-over-period deltas, an activity chart, a GitHub-style heatmap, PR author/reviewer sections, a thread quality section (the "GitGud signal"), collaborator and repo breakdowns, and a PR table — all filtered by a period selector (7d/30d/90d/6m/ytd/all). Data loads progressively via parallel API calls. IC and EM see identical data (NFR data-parity). Each section handles its own empty state.

## Key Decisions Made

| Decision                  | Choice                                            | Why (1 sentence)                                                                | Source            |
| ------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------- |
| Metric scope              | All 4 tiers (20 metrics)                          | Maximizes value from a single migration; thread metrics are the differentiator. | Plan              |
| Migration timing          | Part of S-04, Phase 1                             | Migration is meaningless without the profile that consumes it.                  | Plan              |
| Period filtering          | Full presets (7d/30d/90d/6m/ytd/all), default 90d | Prototype already designed this; 90d is the natural 1:1 prep window.            | Frame (prototype) |
| Period-over-period deltas | Include on KPI cards                              | High signal for 1:1 prep ("PRs up 33% this quarter").                           | Plan              |
| Charts — line/area        | Recharts via shadcn/ui `chart`                    | Native shadcn/ui integration; theme-consistent with zero custom theming code.   | Research          |
| Charts — heatmap          | Custom React + SVG                                | No library provides a good GitHub-style heatmap with shadcn theming; ~60 lines. | Research          |
| Page architecture         | Single React island (`client:only="react"`)       | Period filter state flows to all sections; Recharts can't SSR anyway.           | Plan              |
| Aggregation queries       | Sectioned, parallel                               | Enables progressive load — each section renders when its query completes.       | Plan              |
| URL route                 | `/board/[id]/impact/[login]/[...dateRange]`       | "Impact" captures what the page shows; short slugs are bookmarkable.            | Plan              |
| Route prefix              | Singular `/board/` (rename from `/boards/`)       | Cleaner convention; done alongside new route structure.                         | Plan              |
| Sync UX                   | "Synced X ago" + manual refresh                   | Matches prototype; sets freshness expectations without auto-sync complexity.    | Plan              |

## Scope

**In scope:**

- 4-column DB migration + sync mapper updates
- Route rename `/boards/` → `/board/`
- Impact metrics service with sectioned parallel queries
- 4 API endpoints (summary, author, reviewer, activity)
- Full impact page UI matching prototype layout
- Period filtering with 6 presets + delta comparisons
- Activity chart (Recharts) + contribution heatmap (custom SVG)
- "Synced X ago" indicator + manual refresh
- Per-section empty states
- shadcn/ui `chart` component installation

**Out of scope:**

- Semantic classification (S-05)
- EM IC-switching dropdown (S-06)
- Board Activity tab content (future)
- Board Settings tab content (future)
- Auto-sync on stale data
- Custom date range picker (beyond presets)
- Materialized views / query optimization
- GraphQL `isResolved` for threads (REST heuristic is sufficient)

## Architecture / Approach

Astro SSR page at `/board/[id]/impact/[login]/[...dateRange].astro` validates board membership and renders a single React island (`ImpactView`) with `client:only="react"`. The island mounts, fires 4 parallel API calls to sectioned endpoints, and progressively renders each section as data arrives. Each API endpoint calls the impact metrics service which runs parameterized SQL aggregations against the existing GitHub tables. Period filtering is a date threshold applied to all queries; deltas require a second pass over the previous equivalent period.

## Phases at a Glance

| Phase                           | What it delivers                                                           | Key risk                                                                                  |
| ------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 1. Schema + Sync + Route rename | 4 new DB columns stored by sync; `/board/` routes work                     | Existing synced data has NULLs until next sync; route rename must update all links        |
| 2. Impact Metrics Service + API | 4 API endpoints returning sectioned metrics with period filtering + deltas | SQL aggregation correctness — especially thread reconstruction and percentile computation |
| 3. Impact Page UI               | Full interactive impact page matching prototype                            | Recharts React 19 compatibility; large component tree in single island                    |
| 4. Board Navigation             | Board nav tabs + contributor listing linking to impact pages               | Must not regress existing board detail functionality                                      |

**Prerequisites:** S-03 (invite-and-join-board) done; F-02 (github-ingestion-access) done; local Supabase running for integration tests.
**Estimated effort:** ~4-5 sessions across 4 phases.

## Open Risks & Assumptions

- Recharts 3.x has known `defaultProps` edge cases with React 19 — fallback to visx v4 if issues surface (research §4)
- Existing synced data will have NULL in new columns until next sync — UI must handle gracefully
- Route rename from `/boards/` to `/board/` requires updating all internal links and redirecting old URLs
- Thread reconstruction via `in_reply_to_id` assumes all reply comments reference the root (not nested) — verify with real GitHub data

## Success Criteria (Summary)

- Board member can view any contributor's impact page with 20 metrics across 4 tiers
- Period filtering works with all 6 presets; KPI cards show delta vs previous period
- Activity chart and heatmap render correctly with real data
- IC and EM see identical data on the same contributor's page (data parity)
- Each metric section loads independently with its own skeleton/empty state
