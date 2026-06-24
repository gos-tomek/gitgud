# Profile Classified Comments — Plan Brief

> Full plan: `context/changes/profile-classified-comments/plan.md`
> Research: `context/changes/profile-classified-comments/research.md`

## What & Why

The classification batch system already writes intent and domain labels for every review thread into `thread_classifications`, but no UI reads this data. FR-012 requires that classified comments are visible on the contributor profile as an aggregated breakdown with drill-down to individual labels. This change builds the full read path — from database aggregation through to a "What kind of feedback" section on Impact and a dedicated Threads page.

## Starting Point

The Impact page has 4 parallel-fetched sections (KPIs, Author, Reviewer/ThreadQuality, Activity) with no classification data. `thread_classifications` has data but zero read path — no queries, no service, no API, no component. The `MetricCard.categoryBreakdown` prop was scaffolded but will be superseded by a dedicated section. BoardNav has 3 tabs (Impact, Activity, Settings). The HTML prototype locks down the visual spec.

## Desired End State

The contributor's Impact page includes a "What kind of feedback" section showing intent distribution (3-tier stacked bar: high-signal / routine / low-signal) and domain distribution (SVG donut). A new "Threads" page accessible from the board nav lists all classified threads with intent/domain badges, filterable by period, intent, domain, PR, and role (started/received). Thread counts in PrTable deep-link to the Threads page.

## Key Decisions Made

| Decision            | Choice                                                                 | Why (1 sentence)                                                     | Source   |
| ------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------- | -------- |
| Threads view format | Thread-level rows with PR info                                         | Maps directly to PRD's "individual labels per comment" requirement.  | Plan     |
| Threads placement   | New "Threads" tab in BoardNav (Impact → Threads → Activity → Settings) | User preference for top-level navigation rather than inline section. | Plan     |
| Thread scope        | All threads (started + received), filterable by role                   | Full picture of feedback given and received, with toggle.            | Plan     |
| Phasing             | Ship together (classification section + Threads page)                  | Complete feature on first ship — no dead links.                      | Plan     |
| Pagination          | Offset-based, 25 items/page                                            | Simple, sufficient for current data volumes.                         | Plan     |
| Tooltips            | shadcn Tooltip (Radix-based)                                           | Consistent with existing components, accessible by default.          | Plan     |
| Charts              | CSS flex stacked bar + SVG donut (no Recharts)                         | Lighter, matches prototype exactly, no library dependency.           | Research |
| Deep-linking        | PrTable thread count → Threads page with PR filter                     | User-requested cross-page linking for thread inspection.             | Plan     |

## Scope

**In scope:**

- Classification aggregation service + API endpoint
- "What kind of feedback" section component (stacked bar, donut, coverage footer)
- Classified threads list service + API endpoint (paginated, filtered)
- Threads page (Astro route + React component)
- BoardNav "Threads" tab
- PrTable thread count deep-linking
- "Inspect threads" link wiring

**Out of scope:**

- FR-013 (IC flags inaccurate category)
- Trend/time-series data
- Per-repo classification breakdown
- Changes to the classification write path

## Architecture / Approach

Two new API endpoints (`/impact/[login]/classifications` for aggregates, `/threads/[login]` for paginated list) feed two new React components (`ClassificationSection` on Impact, `ThreadsView` on its own page). Both join `thread_classifications` → `github_review_comments` → `github_pull_requests`, filtered by board repos and date range. Colors and tier assignments are shared constants. The Threads page is a new Astro route with its own contributor/period resolution, mirroring the Impact page's auth/access pattern.

## Phases at a Glance

| Phase                          | What it delivers                                  | Key risk                                                       |
| ------------------------------ | ------------------------------------------------- | -------------------------------------------------------------- |
| 1. Data pipeline (aggregates)  | Service function + `/classifications` API         | Query performance on large boards (mitigated: indexed columns) |
| 2. Classification section      | "What kind of feedback" component on Impact       | Stacked bar/donut visual fidelity vs prototype                 |
| 3. Data pipeline (thread list) | Service function + `/threads` API with filters    | Filter combination edge cases                                  |
| 4. Threads page                | Astro route + ThreadsView with filters/pagination | ContributorSelector reuse across pages                         |
| 5. Navigation & integration    | BoardNav, deep-linking, "Inspect threads" wiring  | BoardNav needs githubLogin prop on non-contributor pages       |

**Prerequisites:** Classification batch must have run at least once to populate `thread_classifications`. Local Supabase must be running for manual testing.
**Estimated effort:** ~2-3 sessions across 5 phases.

## Open Risks & Assumptions

- BoardNav currently doesn't know the contributor's `githubLogin` — pages without a contributor context (Activity, Settings) need a strategy for the Threads tab URL (link to index or disable).
- `ContributorSelector` is defined inside `ImpactView.tsx` — ThreadsView imports it directly, which is fine but may warrant extraction later.
- The `role` filter ("started" vs "received") creates a union query that may need optimization if data volumes grow.

## Success Criteria (Summary)

- Classification section shows correct intent/domain aggregates with visual fidelity to the prototype
- Threads page lists individual classified threads with working filters and pagination
- Deep-linking from PrTable and "Inspect threads" navigates correctly with pre-applied filters
