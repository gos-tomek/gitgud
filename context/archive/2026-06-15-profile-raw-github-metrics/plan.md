# Contributor Impact Page — Implementation Plan

## Overview

Build the product's first data-heavy page — a contributor impact view at `/board/[id]/impact/[login]/[dateRange]` showing 20 GitHub metrics across 4 tiers, with thread-level review analysis as GitGud's differentiator. Includes period filtering (7d/30d/90d/6m/ytd/all), period-over-period delta comparisons, an activity chart (Recharts via shadcn/ui), a GitHub-style contribution heatmap (custom SVG), and progressive section loading via parallel API calls.

## Current State Analysis

**What exists:**

- 4 GitHub tables populated by `syncBoardGitHubData()` — `github_pull_requests`, `github_reviews`, `github_review_comments`, `board_contributors`
- Join path: `board_contributors.github_id` → `github_*.author_github_id` / `reviewer_github_id` / `commenter_github_id`
- RLS policies on all GitHub tables using `is_board_member()` helper
- Board detail page at `src/pages/boards/[id].astro` — shows repos + contributor avatars, no metrics
- Sync service at `src/lib/services/github-sync.ts` with upsert functions for PRs, reviews, comments
- API routes under `src/pages/api/` following a consistent guard pattern (supabase → auth → zod → business logic)
- shadcn/ui components: badge, button, card, checkbox, input, skeleton
- React islands use `client:load`; only form-heavy pages have React (auth forms, board creation wizard)

**What's missing:**

- `in_reply_to_id` on `github_review_comments` (needed for thread reconstruction)
- `additions`, `deletions`, `changed_files` on `github_pull_requests` (needed for PR size)
- Any aggregation/query layer for metrics
- Any impact/profile API endpoints
- Any impact/profile UI components
- No charting library in the project
- Route structure uses plural `/boards/` — needs rename to `/board/`

### Key Discoveries:

- `src/lib/services/github-sync.ts:29-48` — PR upsert maps most Octokit fields but skips `additions`, `deletions`, `changed_files` (all present on the API response)
- `src/lib/services/github-sync.ts:69-88` — Comment upsert skips `in_reply_to_id` (present on every REST response item as `in_reply_to_id`)
- `src/types.ts:22-35` — `GitHubPullRequest` interface needs 3 new fields
- `src/types.ts:56-69` — `GitHubReviewComment` interface needs `inReplyToId` field
- Thread reconstruction: `WHERE in_reply_to_id IS NULL` = thread roots; non-null = replies. `GROUP BY COALESCE(in_reply_to_id, id)` groups all messages in a thread
- `supabase/migrations/20260531100000_github_ingestion_access.sql:24-37` — PR table schema, `20260531100000_github_ingestion_access.sql:57-70` — comment table schema
- Recharts 3.x can't SSR (uses Redux + useEffect) — must use `client:only="react"` for chart islands
- shadcn/ui ships chart wrappers (`ChartContainer`, `ChartTooltip`, `ChartLegend`) over Recharts — install via `npx shadcn@latest add chart`

## Desired End State

A board member navigates to `/board/:id/impact/:login/90d` and sees a rich, interactive metrics dashboard matching the prototype (`context/prototype/dashboard.html`):

1. **Header**: Contributor avatar, name, login, role badge, joined date, board count, "Synced X ago" + refresh button, Export button (placeholder)
2. **Period selector**: Dropdown with 6 presets (7d, 30d, 90d, 6m, ytd, all); changing period updates URL and refetches all sections
3. **KPI cards row**: 6 cards (PRs authored, Reviews given, Threads started, Time to merge, Pickup time, Discussion ratio) — each with value, delta %, and sparkline
4. **Activity chart**: Weekly area chart (3 series: PRs, reviews, threads) via Recharts
5. **As a PR author**: PR counts by state, merge rate, PR size (additions/deletions/files), median time to merge
6. **As a reviewer**: Review verdict mix, pickup time distribution, involvement %, unique PRs reviewed
7. **Review thread quality** (GitGud signal, purple-highlighted): Avg thread depth, discussion-sparking ratio, deep discussions, multi-person threads, inline ratio, author engagement, first-reply time, threads/reviewed PR
8. **Daily activity heatmap**: GitHub-style 52-week contribution calendar (custom SVG)
9. **Top collaborators**: PR authors whose work this person reviewed
10. **Repository activity**: Per-repo breakdown of PRs, reviews, threads
11. **Recent PRs table**: Sortable, with authored/reviewed tabs

IC and EM see identical data (NFR data-parity). Each section loads independently with its own skeleton state. Sections with no data show contextual empty states.

## What We're NOT Doing

- Semantic classification overlay (S-05)
- EM IC-switching dropdown (S-06 — separate slice)
- Board Activity tab content
- Board Settings tab content
- Auto-sync on stale data
- Custom date range picker (beyond 6 presets)
- Materialized views / query caching
- GraphQL `isResolved` for thread resolution (REST heuristic T7 is sufficient)
- Ranking, percentiles, or comparative views (PRD guardrail)
- Export functionality (placeholder button only)

## Implementation Approach

Four phases: (1) extend the data layer with 4 new columns + rename routes, (2) build the metrics aggregation service and API endpoints, (3) build the full impact page UI as a single React island, (4) integrate into board navigation.

The React island (`client:only="react"`) fires parallel fetch calls to 4 sectioned API endpoints on mount. Each endpoint runs parameterized SQL aggregations against the GitHub tables. Period filtering converts a slug (e.g., `90d`) to a date threshold applied to all queries. Delta computation runs each query twice — once for the selected period, once for the previous equivalent period.

---

## Phase 1: Schema + Sync + Route Rename

### Overview

Extend the DB schema with 4 columns needed for thread metrics and PR size, update the sync service to store these fields, update TypeScript types, and rename the route prefix from `/boards/` to `/board/`.

### Changes Required:

#### 1. Database migration

**File**: `supabase/migrations/YYYYMMDDHHMMSS_add_pr_size_and_thread_columns.sql`

**Intent**: Add `additions`, `deletions`, `changed_files` to `github_pull_requests` and `in_reply_to_id` to `github_review_comments`. All columns are nullable — existing rows will have NULL until next sync.

**Contract**: 4 `ALTER TABLE ... ADD COLUMN` statements. All columns nullable (no NOT NULL constraint) because existing synced data predates these columns. `in_reply_to_id` is `bigint` referencing a comment's own `id` within the same table (self-reference, but no FK constraint needed — it's a GitHub-provided value). Follow the lesson: `REVOKE ALL` is not needed here since we're altering existing tables that already have RLS + revocations.

#### 2. Sync service mapper updates

**File**: `src/lib/services/github-sync.ts`

**Intent**: Store the 4 new fields during sync. The Octokit response already contains these values — the mappers just skip them.

**Contract**: In `upsertPullRequests` (~line 29), add `additions`, `deletions`, `changed_files` to the mapped object from the Octokit PR response fields of the same names. In `upsertComments` (~line 69), add `in_reply_to_id` from `c.in_reply_to_id`. Both are simple field additions to the existing upsert objects.

> **Addendum (implementation deviation, flagged in impl-review F3)**: The list-PRs Octokit endpoint used by `upsertPullRequests` does not actually return `additions`/`deletions`/`changed_files` — those fields are only present on the single-PR detail endpoint (`pulls.get`). Implementation adds a separate `updatePullRequestSize` function (`src/lib/services/github-sync.ts:70-76`) that calls `pulls.get` per PR to backfill these 3 fields after the list-based upsert, instead of including them directly in the `upsertPullRequests` mapper as originally planned. The plan's assumption about field availability on the list endpoint was incorrect; no other behavior changes.

#### 3. TypeScript type updates

**File**: `src/types.ts`

**Intent**: Add the 4 new fields to the corresponding interfaces.

**Contract**: Add `additions: number | null`, `deletions: number | null`, `changedFiles: number | null` to `GitHubPullRequest`. Add `inReplyToId: number | null` to `GitHubReviewComment`.

#### 4. Route rename: `/boards/` → `/board/`

**Files**: `src/pages/boards/` → `src/pages/board/`, all files referencing `/boards/` paths

**Intent**: Switch to singular route convention. This is a structural change that affects the existing board detail page, board creation page, and all internal links (dashboard, middleware, components).

**Contract**: Rename `src/pages/boards/` directory to `src/pages/board/`. Update `PROTECTED_ROUTES` in `src/middleware.ts` to use `/board` prefix. Update all `href` attributes referencing `/boards/` across Astro pages and components (dashboard, board detail, topbar, etc.). The existing `src/pages/boards/[id].astro` becomes `src/pages/board/[id].astro`.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npx supabase db reset`
- Existing tests still pass: `npm test`
- Type checking passes: `npx tsc --noEmit` and `npm run test:typecheck`
- Linting passes: `npm run lint`
- Build succeeds: `npm run build`
- After a sync (`POST /api/board/[id]/github/sync`), new columns are populated (query DB directly)

#### Manual Verification:

- Run `npx supabase start` + trigger a sync → verify `github_pull_requests` rows have non-null `additions`/`deletions`/`changed_files`
- Verify `github_review_comments` rows have non-null `in_reply_to_id` for reply comments and NULL for thread roots
- Navigate to `/board/[id]` → board detail page renders correctly (route rename works)
- Navigate to `/boards/[id]` → verify behavior (redirect or 404 — decide during implementation)
- Dashboard links point to `/board/` routes

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Impact Metrics Service + API

### Overview

Build the aggregation query layer and expose it via 4 API endpoints. Each endpoint returns one section of metrics, accepting board ID, contributor GitHub login, and period slug as parameters. Queries run against existing GitHub tables using the Supabase client (RLS enforces access control automatically).

### Changes Required:

#### 1. Period utility

**File**: `src/lib/date-range.ts`

**Intent**: Convert period slugs (7d, 30d, 90d, 6m, ytd, all) to date ranges and compute previous-period offsets for delta comparison.

**Contract**: Export a function that takes a slug string and returns `{ start: Date | null, end: Date, previousStart: Date | null, previousEnd: Date }`. `null` start means "all time." Invalid slugs fall back to `90d`. Also export the list of valid slugs and a type for them.

#### 2. Impact metrics service

**File**: `src/lib/services/impact-metrics.ts`

**Intent**: Encapsulate all profile metric SQL aggregations in one service with 4 sectioned query functions. Each function accepts a Supabase client, board ID, contributor GitHub ID, and date range — and returns typed metric data.

**Contract**: Four exported async functions:

- `getImpactSummary(supabase, boardId, githubId, dateRange)` → `ImpactSummary` — KPI values (PR count, review count, threads started, median time-to-merge, median pickup time, discussion ratio) + delta percentages vs previous period. Also returns `lastSyncedAt` (max `fetched_at` across tables).

- `getAuthorMetrics(supabase, boardId, githubId, dateRange)` → `AuthorMetrics` — PRs by state (open/merged/closed/draft), merge rate, PR size aggregates (total additions/deletions/changed files, median per PR), time-to-merge distribution (p50/p75/p90).

- `getReviewerMetrics(supabase, boardId, githubId, dateRange)` → `ReviewerMetrics` — Reviews by verdict (approved/changes_requested/commented/dismissed), pickup time distribution (p50/p75/p90 + histogram buckets: <1h, 1-4h, 4-24h, 1-3d, 3d+), involvement (% of board PRs reviewed, excluding own), unique PRs reviewed, unique collaborators. Also includes all thread metrics (T1–T10): threads started, avg thread depth, discussion-sparking ratio, deep discussions count, multi-person threads count, inline thread ratio, thread resolution signal, avg first-reply time, threads per reviewed PR.

- `getActivityData(supabase, boardId, githubId, dateRange)` → `ActivityData` — Weekly time series (PRs authored, reviews given, threads started per week), daily heatmap data (date → count for last 52 weeks), top collaborators (login, avatar, PR count), per-repo breakdown (repo name, PR count, review count, thread count), recent PRs list (id, number, title, repo, state, additions, deletions, thread count, time-to-merge, updated_at) with both authored and reviewed tabs.

Thread reconstruction: group comments by `COALESCE(in_reply_to_id, id)` — roots have `in_reply_to_id IS NULL` so they group by their own `id`; replies group by the root's `id`. All T1–T10 metrics derive from this grouping.

Percentile computation: use Postgres `percentile_cont(0.5) WITHIN GROUP (ORDER BY ...)` for medians. For p75/p90, use the same function with different percentile values.

#### 3. Impact metric types

**File**: `src/types.ts`

**Intent**: Add TypeScript interfaces for the 4 API response shapes.

**Contract**: Add `ImpactSummary`, `AuthorMetrics`, `ReviewerMetrics`, `ActivityData` interfaces matching the service function return types. Also add `PeriodSlug` type union and `DateRange` interface.

#### 4. API endpoints

**Files**:

- `src/pages/api/board/[boardId]/impact/[login]/summary.ts`
- `src/pages/api/board/[boardId]/impact/[login]/author.ts`
- `src/pages/api/board/[boardId]/impact/[login]/reviewer.ts`
- `src/pages/api/board/[boardId]/impact/[login]/activity.ts`

**Intent**: Expose each metric section as an independent GET endpoint. Follow the existing API guard pattern (supabase → auth → validation → business logic).

**Contract**: Each endpoint is a `GET` handler. URL params: `boardId` (UUID), `login` (GitHub login string). Query param: `period` (slug, defaults to `90d`). Guard sequence: create Supabase client → check auth → resolve contributor's `github_id` from `board_contributors` by login + board → call the corresponding service function → return JSON. Error responses: 401 (unauthenticated), 404 (contributor not found on board), 400 (invalid period slug), 503 (Supabase unavailable).

The contributor lookup (`board_contributors WHERE board_id = :boardId AND github_login = :login`) implicitly verifies board membership via RLS — if the requesting user isn't a board member, the query returns no rows → 404.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx tsc --noEmit` and `npm run test:typecheck`
- Linting passes: `npm run lint`
- Build succeeds: `npm run build`
- Unit tests for `date-range.ts`: all 6 slugs produce correct date ranges; invalid slug falls back to 90d; previous-period computation is correct
- Unit tests for `impact-metrics.ts`: test each query function with mock Supabase responses (or integration tests against local Supabase)
- API endpoint tests: correct HTTP status codes for auth, missing contributor, invalid period

#### Manual Verification:

- With local Supabase running + synced data, `curl /api/board/[id]/impact/[login]/summary?period=90d` returns correct KPI values
- Delta percentages are sensible (positive when current > previous, negative otherwise, null when previous period has no data)
- Thread metrics return non-null values for contributors with review comments
- Empty response shape (zero counts, empty arrays) for contributors with no activity in the period

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Impact Page UI

### Overview

Build the full impact page as an Astro route with a single React island. Install the shadcn/ui chart component. The React island (`ImpactView`) mounts, fires 4 parallel API calls, and renders each section progressively as data arrives. Period changes update the URL and refetch all sections.

### Changes Required:

#### 1. Install shadcn/ui chart component

**Intent**: Add Recharts + shadcn chart wrappers to the project.

**Contract**: Run `npx shadcn@latest add chart`. This creates `src/components/ui/chart.tsx` and adds `recharts` to dependencies.

#### 2. Astro page route

**File**: `src/pages/board/[id]/impact/[githubLogin]/[...dateRange].astro`

**Intent**: Server-side entry point for the impact page. Validates board membership, resolves contributor info, and renders the React island.

**Contract**: Astro frontmatter creates Supabase client, verifies `context.locals.user` is authenticated and is a board member (via `getBoardWithRole`), resolves the contributor from `board_contributors` by login. Redirects to `/auth/signin` if unauthenticated, to `/board/[id]` if contributor not found. Parses `dateRange` rest param (defaults to `90d` if empty). Renders `<ImpactView client:only="react" />` passing `boardId`, `githubLogin`, `period`, and basic contributor info (avatar, login, name) as props. The page is wrapped in `<Layout>`.

#### 3. ImpactView — main React island

**File**: `src/components/impact/ImpactView.tsx`

**Intent**: Orchestrator component that owns the fetch lifecycle and layout. Fires 4 parallel API calls on mount and on period change. Renders the full page layout with progressive loading.

**Contract**: Accepts props: `boardId`, `githubLogin`, `period`, `contributor` (basic info). On mount, calls all 4 API endpoints in parallel via `Promise.allSettled`. Each section has independent loading/error/ready state. Period changes via `PeriodSelector` update the URL (using `history.replaceState` to change the `dateRange` path segment) and refetch all sections. Layout matches prototype: header → KPI cards → activity chart → author section → reviewer section → thread quality section → heatmap → collaborators → repo activity → PR table.

#### 4. PeriodSelector component

**File**: `src/components/impact/PeriodSelector.tsx`

**Intent**: Dropdown for selecting the time period preset.

**Contract**: Renders a button with current period label + dropdown menu with 6 options (7d, 30d, 90d, 6m, ytd, all). Selected option has a checkmark. Calls `onPeriodChange(slug)` callback. Uses shadcn/ui button + a simple dropdown (either shadcn `DropdownMenu` or a custom select — install `npx shadcn@latest add dropdown-menu` if not present).

#### 5. SyncIndicator component

**File**: `src/components/impact/SyncIndicator.tsx`

**Intent**: Show data freshness and allow manual refresh.

**Contract**: Accepts `lastSyncedAt: string | null` and `boardId: string`. Displays "Synced X ago" (relative time) or "Never synced" if null. Refresh button triggers `POST /api/board/[boardId]/github/sync` and shows a loading spinner during sync. On completion, refetches all metric sections.

#### 6. KpiCards component

**File**: `src/components/impact/KpiCards.tsx`

**Intent**: Row of 6 summary KPI cards matching the prototype's top section.

**Contract**: Accepts `ImpactSummary` data (or null for loading state). Renders 6 cards: PRs authored, Reviews given, Threads started, Time to merge (median), Pickup time (median), Discussion ratio. Each card shows: label, value, delta % with color (green positive, red negative, gray neutral), and a sparkline (small inline trend — can be a simple SVG path from the weekly data, or deferred to a later enhancement). Loading state: shadcn `Skeleton` components matching card dimensions.

#### 7. ActivityChart component

**File**: `src/components/impact/ActivityChart.tsx`

**Intent**: Weekly activity area chart using Recharts via shadcn/ui chart wrappers.

**Contract**: Accepts weekly time series data (array of `{ week, prs, reviews, threads }`). Renders inside `ChartContainer` with `AreaChart`, 3 `Area` series, `CartesianGrid`, `XAxis` (week labels), `ChartTooltip`, `ChartLegend`. Colors from shadcn chart CSS variables (`--chart-1`, `--chart-2`, `--chart-3`). Loading state: skeleton rectangle matching chart dimensions.

#### 8. ContributionHeatmap component

**File**: `src/components/impact/ContributionHeatmap.tsx`

**Intent**: GitHub-style 52-week × 7-day contribution heatmap using custom SVG.

**Contract**: Accepts daily data (array of `{ date, count }`). Renders an SVG with 52 columns × 7 rows of `<rect>` elements. 5 intensity levels mapped to opacity steps of the accent color CSS variable. Day labels (Mon, Wed, Fri) on the left, month labels on top. Tooltip on hover showing date + count (use Radix `Tooltip` for accessibility). "Less" / "More" legend.

#### 9. AuthorSection component

**File**: `src/components/impact/AuthorSection.tsx`

**Intent**: "As a PR author" section from the prototype.

**Contract**: Accepts `AuthorMetrics` data. Renders: total PR count + breakdown by state (merged/open/closed/draft as colored badges or bar segments), merge rate percentage, PR size summary (total additions/deletions/changed files), time-to-merge display (p50 + p90). Loading/empty states.

#### 10. ReviewerSection component

**File**: `src/components/impact/ReviewerSection.tsx`

**Intent**: "As a reviewer" section from the prototype.

**Contract**: Accepts reviewer portion of `ReviewerMetrics`. Renders: review verdict mix (horizontal stacked bar or segmented bar showing approved/changes_requested/commented/dismissed percentages), pickup time (median + distribution histogram with 5 buckets), involvement percentage, unique PRs reviewed count. Loading/empty states.

#### 11. ThreadQualitySection component

**File**: `src/components/impact/ThreadQualitySection.tsx`

**Intent**: "Review thread quality" section — the GitGud signal, visually distinct (purple-highlighted in prototype).

**Contract**: Accepts thread portion of `ReviewerMetrics`. Renders with a distinct visual treatment (purple border/background matching prototype). Displays 8 metrics in a card grid: avg thread depth, discussion-sparking ratio (% + fraction), deep discussions (count + "3+ messages" label), multi-person threads (count + "≥2 participants" label), inline thread ratio (% + counts), author engagement / thread resolution (% + acknowledged/no-response breakdown), first-reply time (median + range), threads per reviewed PR (average + counts). Each metric card has a label, value, and brief description. Loading/empty states.

**S-05 affordance**: The section structure should accommodate a future "by category" sub-breakdown per metric (e.g., "8 architecture threads, 3 mentoring threads") without restructuring — this means each metric card should be a component that can accept an optional category breakdown prop.

#### 12. CollaboratorsSection component

**File**: `src/components/impact/CollaboratorsSection.tsx`

**Intent**: "Top collaborators" section from the prototype.

**Contract**: Accepts array of `{ login, avatarUrl, prCount }`. Renders a list of collaborator cards with avatar, display name (or login), GitHub handle, and PR count. Sorted by PR count descending.

#### 13. RepoActivitySection component

**File**: `src/components/impact/RepoActivitySection.tsx`

**Intent**: "Repository activity" section from the prototype.

**Contract**: Accepts array of `{ repoName, prCount, reviewCount, threadCount }`. Renders per-repo cards with repo name, and counts for PRs/reviews/threads. First repo can be marked "primary" if it has the most activity.

#### 14. PrTable component

**File**: `src/components/impact/PrTable.tsx`

**Intent**: "Recent pull requests" table from the prototype with authored/reviewed tabs.

**Contract**: Accepts arrays of authored and reviewed PRs. Renders a tabbed table with two tabs (Authored / Reviewed). Columns: PR number + title, repo, state badge (merged/open/closed/draft), lines changed (+/-), thread count, time to merge (for merged PRs), updated date. "View all" link at bottom if truncated. Rows link to GitHub PR URL (external link).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx tsc --noEmit` and `npm run test:typecheck`
- Linting passes: `npm run lint`
- Build succeeds: `npm run build`
- Component tests for key components (PeriodSelector, KpiCards with mock data)
- React Compiler lint rule passes (no `useMemo`/`useCallback` violations)

#### Manual Verification:

- Navigate to `/board/[id]/impact/[login]/90d` → full page renders with real synced data
- All 20 metrics display correct values
- Period selector: changing period updates URL and refetches all sections
- Loading states: each section shows skeleton while its API call is in flight
- Empty states: contributor with no activity shows contextual messages per section
- Activity chart: hover tooltips show correct values; legend toggles series
- Heatmap: hover shows date + count; intensity levels look correct
- PR table: authored/reviewed tabs switch correctly; links open GitHub PRs
- Sync indicator: shows correct relative time; refresh button triggers sync and updates data
- Thread quality section has purple visual treatment matching prototype
- Page is responsive (works on narrow viewport)
- IC viewing own page sees same data as EM viewing that IC's page (data parity)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Board Navigation Integration

### Overview

Update the board detail page to include navigation tabs (Impact / Activity / Settings) matching the prototype, and make contributors clickable links to their impact pages. The Activity and Settings tabs are stub/placeholder routes for future slices.

### Changes Required:

#### 1. Board navigation component

**File**: `src/components/BoardNav.astro` (or React if interactivity needed)

**Intent**: Shared navigation tabs for board sub-pages. Appears on the board detail page and the impact page.

**Contract**: Renders 3 tabs: Impact (links to contributor listing or first contributor), Activity (stub), Settings (stub). Active tab is highlighted based on current URL path. The impact page also renders this nav above the `ImpactView` island.

#### 2. Update board detail page

**File**: `src/pages/board/[id].astro`

**Intent**: Add the board nav tabs and make contributor avatars link to their impact pages.

**Contract**: Add `BoardNav` component below the board header. Each contributor in the contributors list links to `/board/[id]/impact/[login]/90d`. The page now serves as the board overview / contributor listing.

#### 3. Add nav to impact page

**File**: `src/pages/board/[id]/impact/[githubLogin]/[...dateRange].astro`

**Intent**: Render the board nav above the React island so the user can navigate back to the board or to other tabs.

**Contract**: Add `BoardNav` in the Astro template above the `ImpactView` island. This is server-rendered (not part of the React island).

#### 4. Stub routes for Activity and Settings

**Files**:

- `src/pages/board/[id]/activity/[...dateRange].astro`
- `src/pages/board/[id]/settings.astro`

**Intent**: Placeholder pages so the nav tabs link to real routes instead of dead links.

**Contract**: Minimal Astro pages with board nav + "Coming soon" message. Protected routes (require auth + board membership).

> **Addendum (unplanned addition, flagged in impl-review F4)**: `src/pages/board/[id]/impact/index.astro` was added but not described above. `BoardNav`'s Impact tab links to `/board/[id]/impact`, which has no contributor/date-range segment and would otherwise 404. This index route redirects to the first contributor's impact page (or to `/board/[id]/settings` if the board has no contributors yet). Reasonable scope addition needed to make the nav tab actually resolve; no other behavior change.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx tsc --noEmit` and `npm run test:typecheck`
- Linting passes: `npm run lint`
- Build succeeds: `npm run build`
- Existing board-related tests still pass

#### Manual Verification:

- Board detail page shows nav tabs; clicking a contributor navigates to their impact page
- Impact page shows nav tabs; "Impact" tab is active
- Activity and Settings tabs navigate to stub pages with "Coming soon"
- Navigation between board detail ↔ impact page ↔ stubs works smoothly
- Dashboard → board → contributor impact → back navigation works
- No regressions in existing board detail functionality

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding.

---

## Testing Strategy

### Unit Tests:

- `date-range.ts`: all 6 slugs → correct date ranges; invalid slug fallback; previous-period computation; edge cases (YTD on Jan 1, "all" returns null start)
- `impact-metrics.ts` query functions: mock Supabase client returning known data → verify aggregation logic, especially thread reconstruction, percentile computation, and delta calculation
- React components: `PeriodSelector` renders all options and fires callback; `KpiCards` renders loading/data/empty states correctly

### Integration Tests:

- Against local Supabase with seeded data: verify each API endpoint returns correct metrics for a known contributor
- RLS enforcement: unauthenticated request → 401; non-board-member → 404 (contributor not found due to RLS)
- Period filtering: same endpoint with different period slugs returns different counts

### Manual Testing Steps:

1. Seed a board with synced GitHub data (multiple PRs, reviews, comments with reply chains)
2. Navigate to a contributor's impact page → verify all 20 metrics render
3. Change period to 7d → verify counts decrease; change to "all" → verify all data shown
4. Verify delta percentages make sense (positive/negative/null)
5. Test empty states: navigate to a contributor with no activity → each section shows appropriate message
6. Test with NULLs in new columns (data synced before migration): verify no crashes, metrics show "N/A" or graceful fallback
7. Verify IC self-view matches EM view of same contributor

## Performance Considerations

- **Query performance**: On-the-fly SQL aggregations are sufficient for MVP data volumes (≤200 PRs per repo, small teams). If performance degrades, add indexes on `author_github_id`, `reviewer_github_id`, `commenter_github_id` + `created_at` columns, or introduce materialized views.
- **Client bundle**: The React island (ImpactView + all sub-components + Recharts) is the page's only significant JS. Estimated ~150-200 kB gzipped. Acceptable for a lazy-loaded island.
- **4 parallel API calls**: Slightly more HTTP overhead than a single call, but enables progressive rendering and keeps each query simple. On localhost, all 4 should complete in <200ms total.
- **Heatmap rendering**: 52×7 = 364 SVG `<rect>` elements is trivial for React to render.

## Migration Notes

- The 4-column migration is additive (ALTER TABLE ADD COLUMN, all nullable) — no data loss, no backfill needed, backward-compatible with existing code
- Existing synced data will have NULL in new columns until the next sync. The UI must handle this: show "N/A" or "—" for PR size when null; exclude from aggregations with `WHERE additions IS NOT NULL`
- The route rename (`/boards/` → `/board/`) is a breaking change for any bookmarked URLs. Consider adding a redirect from `/boards/*` to `/board/*` in middleware during Phase 1

## References

- Research: `context/changes/profile-raw-github-metrics/research.md` — full metrics inventory, competitive analysis, cost mapping, data visualization research
- Frame: `context/changes/profile-raw-github-metrics/frame.md` — problem framing
- Prototype: `context/prototype/dashboard.html` — UI design reference
- PRD: `context/foundation/prd.md` §Contribution profile (FR-006, FR-008, FR-009, FR-010, FR-011), §NFR (progressive-load, data-parity)
- Roadmap: `context/foundation/roadmap.md` §S-04
- Sync service: `src/lib/services/github-sync.ts:29-88`
- DB schema: `supabase/migrations/20260531100000_github_ingestion_access.sql:24-70`
- Types: `src/types.ts:1-69`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schema + Sync + Route Rename

#### Automated

- [x] 1.1 Migration applies cleanly: `npx supabase db reset` — 034fa6d
- [x] 1.2 Existing tests pass: `npm test` — 034fa6d
- [x] 1.3 Type checking passes: `npx tsc --noEmit` and `npm run test:typecheck` — 034fa6d
- [x] 1.4 Linting passes: `npm run lint` — 034fa6d
- [x] 1.5 Build succeeds: `npm run build` — 034fa6d
- [x] 1.6 After sync, new columns are populated in DB — 034fa6d

#### Manual

- [x] 1.7 Synced PRs have non-null additions/deletions/changed_files — 034fa6d
- [x] 1.8 Synced comments have correct in_reply_to_id (NULL for roots, non-null for replies) — 034fa6d
- [x] 1.9 `/board/[id]` route renders correctly after rename — 034fa6d
- [x] 1.10 Dashboard links use `/board/` prefix — 034fa6d

### Phase 2: Impact Metrics Service + API

#### Automated

- [x] 2.1 Type checking passes: `npx tsc --noEmit` and `npm run test:typecheck` — 5c68a85
- [x] 2.2 Linting passes: `npm run lint` — 5c68a85
- [x] 2.3 Build succeeds: `npm run build` — 5c68a85
- [x] 2.4 Unit tests for date-range.ts pass — 5c68a85
- [x] 2.5 Unit tests for impact-metrics.ts pass — 5c68a85
- [x] 2.6 API endpoint tests pass (auth, 404, invalid period) — 5c68a85

#### Manual

- [x] 2.7 Summary endpoint returns correct KPI values with real data — 5c68a85
- [x] 2.8 Delta percentages are sensible — 5c68a85
- [x] 2.9 Thread metrics return non-null for contributors with comments — 5c68a85
- [x] 2.10 Empty response for contributors with no activity in period — 5c68a85

### Phase 3: Impact Page UI

#### Automated

- [x] 3.1 Type checking passes: `npx tsc --noEmit` and `npm run test:typecheck` — 6a18a4b
- [x] 3.2 Linting passes: `npm run lint` — 6a18a4b
- [x] 3.3 Build succeeds: `npm run build` — 6a18a4b
- [x] 3.4 Component tests pass — 6a18a4b
- [x] 3.5 React Compiler lint rule passes — 6a18a4b

#### Manual

- [x] 3.6 Full page renders with real data at `/board/[id]/impact/[login]/90d` — 6a18a4b
- [x] 3.7 All 20 metrics display correct values — 6a18a4b
- [x] 3.8 Period selector changes URL and refetches sections — 6a18a4b
- [x] 3.9 Loading skeletons show during API calls — 6a18a4b
- [x] 3.10 Empty states render for no-activity contributors — 6a18a4b
- [x] 3.11 Activity chart tooltips and legend work — 6a18a4b
- [x] 3.12 Heatmap hover shows date + count — 6a18a4b
- [x] 3.13 PR table tabs (authored/reviewed) switch correctly — 6a18a4b
- [x] 3.14 Sync indicator shows correct time; refresh works — 6a18a4b
- [x] 3.15 Thread quality section has purple visual treatment — 6a18a4b
- [x] 3.16 Data parity: IC self-view matches EM view — 6a18a4b

### Phase 4: Board Navigation Integration

#### Automated

- [x] 4.1 Type checking passes: `npx tsc --noEmit` and `npm run test:typecheck` — b13bdde
- [x] 4.2 Linting passes: `npm run lint` — b13bdde
- [x] 4.3 Build succeeds: `npm run build` — b13bdde
- [x] 4.4 Existing board tests still pass — b13bdde

#### Manual

- [x] 4.5 Board detail page shows nav tabs; contributors link to impact pages — b13bdde
- [x] 4.6 Impact page shows nav tabs with "Impact" active — b13bdde
- [x] 4.7 Activity and Settings stubs render correctly — b13bdde
- [x] 4.8 Navigation between all board sub-pages works — b13bdde
- [x] 4.9 No regressions in existing board detail functionality — b13bdde
