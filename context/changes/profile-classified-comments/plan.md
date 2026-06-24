# Profile Classified Comments — Implementation Plan

## Overview

Build the full read path for classified comment data: a "What kind of feedback" aggregate section on the Impact page and a dedicated Threads page with filters, pagination, and deep-linking. The classification batch system already writes `intent` and `domain` labels into `thread_classifications` — this change surfaces that data to users.

## Current State Analysis

The classification batch (`classification-batch` change) writes per-thread `intent` (10 categories) and `domain` (5 categories) labels into `thread_classifications`. Today there is **zero read path**: no aggregation query, no service function, no API endpoint, and no component reads from this table. The `ThreadClassification` type in `src/types.ts:95` exists but is unused.

The Impact page (`ImpactView.tsx`) fires 4 parallel fetches (`/summary`, `/author`, `/reviewer`, `/activity`) and renders independent sections. A 5th `/classifications` endpoint fits naturally. The board navigation (`BoardNav.astro`) has three tabs: Impact, Activity, Settings — a Threads tab can be inserted between Impact and Activity.

### Key Discoveries:

- `MetricCard.categoryBreakdown` prop (`ThreadQualitySection.tsx:23`) is scaffolded but never populated — it was built for this purpose but won't be used because the prototype calls for a dedicated section instead.
- `thread_classifications` RLS SELECT policy (`20260618120000_thread_classifications.sql:23-25`) already allows board members to read — no new policies needed.
- The prototype (`prototype/Impact.html`) locks down the visual spec: 3-tier stacked bar for intent, SVG donut for domain, coverage footer, light purple glassmorphism theme.
- Join path: `thread_classifications.thread_root_comment_id` → `github_review_comments.id` (filtered by `commenter_github_id` or `pull_request_id`) → `github_pull_requests` (filtered by board repos + date range).
- PrTable (`PrTable.tsx:44`) shows thread counts per PR — these can become clickable links to the Threads page with a PR filter applied.

## Desired End State

The contributor profile includes a "What kind of feedback" section showing the intent distribution as a 3-tier stacked bar (high-signal / routine / low-signal) and domain distribution as an SVG donut chart. A new "Threads" page accessible from the board navigation lists all classified threads with intent/domain badges, filterable by period, intent, domain, and PR. The PrTable's thread count links directly to the Threads page filtered by that PR.

**Verification**: Navigate to a contributor's Impact page → the classification section appears between ThreadQualitySection and the heatmap, showing correct counts. Click "Inspect threads" → navigates to the Threads page showing individual classified comments. Apply filters → list updates. Click a thread count in PrTable → opens Threads page filtered to that PR.

## What We're NOT Doing

- FR-013 (IC can flag a category as inaccurate) — nice-to-have, dependency-gated, out of scope.
- Trend data / time-series for classification counts — flat counts per period only.
- Per-repo classification breakdown — aggregate across all board repos.
- Cursor-based pagination — offset pagination is sufficient for current data volumes.
- Any changes to the classification write path or batch system.

## Implementation Approach

Five phases, each building on the previous:

1. **Data pipeline for aggregates** — SQL query + service function + API endpoint for intent/domain counts.
2. **Classification section component** — React component matching the prototype visual spec.
3. **Data pipeline for thread list** — Service function + API endpoint for paginated classified threads with filters.
4. **Threads page** — Astro page + React ThreadsView component with filters, pagination, thread table.
5. **Navigation & integration** — BoardNav update, "Inspect threads" link wiring, PrTable deep-linking.

## Critical Implementation Details

### Timing & lifecycle

The classification section fetches independently from existing sections (5th parallel fetch in ImpactView). The Threads page is a separate Astro route — it does NOT share state with ImpactView. Both pages resolve the contributor's `github_id` server-side (Astro frontmatter) the same way the Impact page does.

### State sequencing

The Threads page needs to show threads from both perspectives: threads the contributor **started** (as reviewer) and threads **received** on their authored PRs. The API must accept a `role` filter (`started` | `received` | `all`, default `all`) to support this. The classification section on Impact always shows aggregate counts for threads started by the contributor (consistent with ThreadQualitySection's "threads started" metric).

---

## Phase 1: Data Pipeline for Classification Aggregates

### Overview

Build the service function that aggregates classification counts and the API endpoint that serves them. This is the foundation for both the classification section component and provides the data contract.

### Changes Required:

#### 1. Types for classification aggregates

**File**: `src/types.ts`

**Intent**: Add the `ClassificationAggregates` type that the API returns and the component consumes. Includes intent counts with tier assignment, domain counts, coverage stats, and high-signal percentage.

**Contract**: New exported interface `ClassificationAggregates` with fields:

- `intentCounts: { category: IntentCategory; count: number; tier: "high-signal" | "routine" | "low-signal" }[]`
- `domainCounts: { category: TechnicalDomain; count: number }[]`
- `totalClassified: number`
- `totalThreads: number`
- `highSignalPercent: number`

#### 2. Classification aggregation service function

**File**: `src/lib/services/impact-metrics.ts`

**Intent**: Add `getClassificationAggregates()` that queries `thread_classifications` joined to `github_review_comments` and `github_pull_requests`, filtered by board repos, contributor (`commenter_github_id`), and date range. Returns flat intent/domain counts plus coverage ratio.

**Contract**:

```typescript
export async function getClassificationAggregates(
  supabase: SupabaseClient,
  boardId: string,
  githubId: number,
  dateRange: DateRange,
): Promise<ClassificationAggregates>;
```

The function:

1. Gets board repo IDs (reuse `getBoardRepoIds`).
2. Queries `thread_classifications tc` joined to `github_review_comments grc` on `tc.thread_root_comment_id = grc.id`, filtered by `grc.commenter_github_id = githubId` and `grc.pull_request_id` in board PRs within date range.
3. Groups by `tc.intent` and `tc.domain` separately.
4. Counts total root comments (classified + unclassified) for the coverage denominator — reuse the root-comment counting logic from `getReviewerMetrics` or query `github_review_comments` where `in_reply_to_id IS NULL`.
5. Assigns tier to each intent category (constant map, not DB-driven):
   - high-signal: `architecture`, `bug-catch`, `mentoring`, `unblocking`
   - routine: `nitpick`, `question`, `praise`
   - low-signal: `joke`, `self-review`, `unknown`
6. Computes `highSignalPercent` = sum of high-signal counts / totalClassified × 100.

#### 3. API endpoint

**File**: `src/pages/api/board/[boardId]/impact/[login]/classifications.ts`

**Intent**: New GET endpoint following the exact pattern of `reviewer.ts` — auth, board access check, contributor lookup, period parsing, then delegates to the service function.

**Contract**: `GET /api/board/[boardId]/impact/[login]/classifications?period=90d` → returns `ClassificationAggregates` as JSON. Same auth/access pattern as `reviewer.ts` (supervisor sees all, contributor sees only own).

### Success Criteria:

#### Automated Verification:

- Type-check passes: `npx tsc --noEmit`
- Lint passes: `npm run lint`
- Tests pass: `npm test`

#### Manual Verification:

- `curl` the endpoint with a valid session → returns correct JSON shape with intent/domain counts matching the DB data
- Empty state: contributor with no classified threads → returns zero counts, `totalClassified: 0`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Classification Section Component

### Overview

Build the "What kind of feedback" React component matching the prototype's visual spec and wire it into ImpactView as a 5th parallel fetch.

### Changes Required:

#### 1. ClassificationSection component

**File**: `src/components/impact/ClassificationSection.tsx` (new)

**Intent**: Full-width section placed between ThreadQualitySection and the heatmap, rendering:

- Section header: "AI classified" purple pill + "What kind of feedback" heading + subtitle + "Inspect threads" link (top-right).
- Two-column grid (`grid-template-columns: 1.7fr 1fr`): intent panel (left) with high-signal % KPI, 3-tier stacked bar (CSS flex with 3px tier gaps), tier scale labels, and 2-column legend grid (8 rows, low-signal grouped); domain panel (right) with SVG donut (104×104, stroke-width 13, r=42) and 5-row legend.
- Coverage footer: "N of M threads classified" + progress bar + "pending" count + model attribution.
- Uses shadcn Tooltip for category hover definitions (the tooltip text table from research §5).

**Contract**:

```typescript
interface Props {
  data: ClassificationAggregates | null;
  loading: boolean;
  threadsUrl: string; // "Inspect threads" link target
}
export function ClassificationSection({ data, loading, threadsUrl }: Props);
```

The component uses the prototype's color maps:

- Intent: architecture=#3b82f6, bug-catch=#ef4444, mentoring=#10b981, unblocking=#06b6d4, nitpick=#f59e0b, question=#8b5cf6, praise=#eab308, joke=#ec4899, self-review=#a1a1aa, unknown=#d4d4d8
- Domain: functional=#7c3aed, refactoring=#0ea5e9, documentation=#10b981, discussion=#f59e0b, false-positive=#d4d4d8

Light purple gradient background (`#faf5ff → #ffffff`), border `1px solid #e9d5ff`.

The stacked bar is pure CSS flex (not Recharts). The donut is hand-crafted SVG using `stroke-dasharray` (not Recharts PieChart). The tier signal model (high-signal / routine / low-signal) is a constant map inside the component.

#### 2. Wire into ImpactView

**File**: `src/components/impact/ImpactView.tsx`

**Intent**: Add a 5th parallel fetch to `/classifications`, manage its `SectionState<ClassificationAggregates>`, and render `ClassificationSection` between ThreadQualitySection and the heatmap section.

**Contract**: New state `const [classifications, setClassifications] = useState<SectionState<ClassificationAggregates>>(idle())`. Fetch fires in the same `useEffect` as the other 4. Reset to `idle()` on period/contributor change. Component placed after `<ThreadQualitySection>` and before the heatmap `<section>`.

### Success Criteria:

#### Automated Verification:

- Type-check passes: `npx tsc --noEmit`
- Lint passes: `npm run lint`
- Tests pass: `npm test`

#### Manual Verification:

- Classification section appears on Impact page between thread quality and heatmap
- Stacked bar shows correct tier grouping with 3px gaps between tiers
- SVG donut renders 5 segments with center text showing top category
- Tooltips appear on hover for each category label
- Empty state shows "No classified threads" message
- Loading state shows skeleton placeholders
- Coverage footer shows correct "N of M classified" with progress bar
- Section uses light purple gradient background matching ThreadQualitySection

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Data Pipeline for Thread List

### Overview

Build the service function and API endpoint that return paginated, filterable classified threads for the Threads page.

### Changes Required:

#### 1. Types for thread list

**File**: `src/types.ts`

**Intent**: Add `ClassifiedThread` type for individual thread rows and `ClassifiedThreadsPage` for paginated response.

**Contract**: New exported interfaces:

```typescript
export interface ClassifiedThread {
  threadRootCommentId: number;
  pullRequestId: number;
  prNumber: number;
  prTitle: string;
  prRepo: string;
  prUrl: string;
  commentSnippet: string; // first ~200 chars of root comment body
  intent: IntentCategory;
  domain: TechnicalDomain;
  commenterLogin: string;
  classifiedAt: string;
  createdAt: string; // comment creation date
}

export interface ClassifiedThreadsPage {
  threads: ClassifiedThread[];
  total: number;
  page: number;
  pageSize: number;
}
```

#### 2. Thread list service function

**File**: `src/lib/services/impact-metrics.ts`

**Intent**: Add `getClassifiedThreads()` that returns paginated classified thread rows for a contributor, with optional filters for intent, domain, and PR ID.

**Contract**:

```typescript
export async function getClassifiedThreads(
  supabase: SupabaseClient,
  boardId: string,
  githubId: number,
  dateRange: DateRange,
  filters: {
    intent?: IntentCategory;
    domain?: TechnicalDomain;
    pullRequestId?: number;
    role?: "started" | "received" | "all"; // default "all"
  },
  page: number,
  pageSize: number,
): Promise<ClassifiedThreadsPage>;
```

The function:

1. Gets board repo IDs.
2. Queries `thread_classifications tc` joined to `github_review_comments grc` on `tc.thread_root_comment_id = grc.id`, joined to `github_pull_requests gpr` on `grc.pull_request_id = gpr.id`.
3. Filters by board repos, date range, and optional intent/domain/PR filters.
4. For `role`:
   - `"started"`: `grc.commenter_github_id = githubId` (threads the contributor started).
   - `"received"`: `gpr.author_github_id = githubId AND grc.commenter_github_id != githubId` (threads on their PRs by others).
   - `"all"`: union of both (default).
5. Selects: `tc.thread_root_comment_id`, `tc.pull_request_id`, `tc.intent`, `tc.domain`, `tc.classified_at`, `grc.body` (truncated to 200 chars), `grc.commenter_login`, `grc.created_at`, `gpr.number`, `gpr.title`, `gpr.repo_id`.
6. Orders by `grc.created_at DESC`.
7. Paginates with `.range()`.
8. Resolves repo names from repo IDs (same pattern as `getActivityData`).

#### 3. API endpoint for thread list

**File**: `src/pages/api/board/[boardId]/threads/[login].ts` (new)

**Intent**: New GET endpoint returning paginated classified threads. Follows the auth/access pattern from `reviewer.ts`.

**Contract**: `GET /api/board/[boardId]/threads/[login]?period=90d&page=1&pageSize=25&intent=architecture&domain=functional&prId=123&role=all` → returns `ClassifiedThreadsPage` as JSON.

Query params validated with zod:

- `period`: PeriodSlug (default `"90d"`)
- `page`: positive integer (default `1`)
- `pageSize`: 10-50 (default `25`)
- `intent`: optional IntentCategory
- `domain`: optional TechnicalDomain
- `prId`: optional positive integer
- `role`: optional `"started" | "received" | "all"` (default `"all"`)

### Success Criteria:

#### Automated Verification:

- Type-check passes: `npx tsc --noEmit`
- Lint passes: `npm run lint`
- Tests pass: `npm test`

#### Manual Verification:

- `curl` the endpoint → returns paginated thread rows with correct classification data
- Filters work: `?intent=architecture` returns only architecture threads
- Pagination works: `?page=2&pageSize=10` returns correct offset
- Role filter: `?role=started` vs `?role=received` returns different sets
- Empty state: contributor with no classified threads → empty array, `total: 0`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Threads Page

### Overview

Build the Threads page — an Astro route and React component with filter bar, paginated table of classified threads, and responsive layout.

### Changes Required:

#### 1. Astro page

**File**: `src/pages/board/[id]/threads/[githubLogin]/[...dateRange].astro` (new)

**Intent**: Server-side rendered page following the exact pattern of the Impact page (`[id]/impact/[githubLogin]/[...dateRange].astro`). Authenticates user, resolves board + contributor, passes props to ThreadsView React component.

**Contract**: Same auth/access checks as the Impact page — supervisor sees all contributors, contributor sees only own. Renders `<ThreadsView client:only="react" ... />` with props: `boardId`, `githubLogin`, `period`, `contributor`, `contributors` (for ContributorSelector).

#### 2. ThreadsView React component

**File**: `src/components/threads/ThreadsView.tsx` (new)

**Intent**: Main orchestrator for the Threads page. Renders ContributorSelector (reused from ImpactView), PeriodSelector, filter bar (intent, domain, PR, role dropdowns), paginated thread table, and pagination controls.

**Contract**:

```typescript
interface Props {
  boardId: string;
  githubLogin: string;
  period: PeriodSlug;
  contributor: ContributorInfo;
  contributors: ContributorInfo[];
  initialFilters?: { prId?: number; intent?: IntentCategory; domain?: TechnicalDomain };
}
export default function ThreadsView({ ... }: Props)
```

The component:

1. Manages filter state (intent, domain, PR, role, page) in React state.
2. Fetches `/api/board/[boardId]/threads/[login]` with filter query params on mount and on filter/period/page change.
3. Renders a filter bar with select dropdowns for intent (10 options + "All"), domain (5 + "All"), role ("All" | "Started" | "Received").
4. Renders a table with columns: Comment (snippet + commenter), PR (title + repo), Intent (colored badge), Domain (colored badge), Date.
5. Renders pagination controls (Previous / Page X of Y / Next).
6. Updates URL query params when filters change (for deep-linking).
7. Reuses `ContributorSelector` and `PeriodSelector` from impact components (may need to extract these to a shared location or import directly).

#### 3. ThreadRow component

**File**: `src/components/threads/ThreadsView.tsx` (same file, internal component)

**Intent**: Renders a single classified thread row in the table with intent/domain badges using the same color map as ClassificationSection.

**Contract**: Internal component. Intent badge uses the same hex color map as ClassificationSection (extract to a shared constant file). Domain badge uses the domain color map. Badge styling follows the existing pattern: `rounded px-1.5 py-0.5 text-xs font-semibold`.

#### 4. Shared color constants

**File**: `src/lib/classification-colors.ts` (new)

**Intent**: Extract the intent and domain color maps into a shared module so both ClassificationSection and ThreadsView use the same colors.

**Contract**: Exports `INTENT_COLORS: Record<IntentCategory, string>`, `DOMAIN_COLORS: Record<TechnicalDomain, string>`, `INTENT_TIERS: Record<IntentCategory, "high-signal" | "routine" | "low-signal">`, and `CATEGORY_TOOLTIPS: Record<string, string>`.

### Success Criteria:

#### Automated Verification:

- Type-check passes: `npx tsc --noEmit` and `npm run test:typecheck`
- Lint passes: `npm run lint`
- Tests pass: `npm test`
- Build succeeds: `npm run build`

#### Manual Verification:

- Navigate to `/board/[id]/threads/[login]` → thread list renders with classification badges
- Period selector works and filters threads by date range
- Intent/domain/role filter dropdowns work correctly
- Pagination controls navigate between pages
- Contributor selector switches to another contributor's threads
- Empty state shows appropriate message
- Deep-link with query params (e.g., `?prId=123`) pre-fills filters

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 5: Navigation & Integration

### Overview

Add "Threads" to the board navigation, wire the "Inspect threads" link from the classification section, and add deep-linking from PrTable's thread count to the Threads page.

### Changes Required:

#### 1. BoardNav update

**File**: `src/components/BoardNav.astro`

**Intent**: Add a "Threads" nav tab between Impact and Activity. The Threads URL needs the contributor's `githubLogin` in the path, which requires passing it as a prop.

**Contract**: Add a new prop `githubLogin?: string` to BoardNav. When present, render the Threads link: `<a href={/board/${boardId}/threads/${githubLogin}}>Threads</a>` between Impact and Activity. Add `isThreads` path check for active state. When `githubLogin` is not provided (e.g., on Settings or Activity pages that don't have a contributor context), still show the Threads tab but link to the threads index (which could redirect to the first contributor, or show a contributor picker).

#### 2. Update Astro pages to pass githubLogin to BoardNav

**File**: `src/pages/board/[id]/impact/[githubLogin]/[...dateRange].astro`
**File**: `src/pages/board/[id]/threads/[githubLogin]/[...dateRange].astro`

**Intent**: Pass the current `githubLogin` to `<BoardNav>` so the Threads tab links to the correct contributor.

**Contract**: `<BoardNav boardId={board.id} githubLogin={contributor.githubLogin} />`

#### 3. Wire "Inspect threads" link

**File**: `src/components/impact/ClassificationSection.tsx`

**Intent**: The "Inspect threads" link at the top-right of the classification section navigates to the Threads page for the current contributor.

**Contract**: The `threadsUrl` prop (already defined in Phase 2) is constructed in `ImpactView.tsx` as `/board/${boardId}/threads/${currentLogin}/${period}` and passed to `ClassificationSection`.

#### 4. PrTable thread count deep-linking

**File**: `src/components/impact/PrTable.tsx`

**Intent**: Make the thread count in each PR row a clickable link that navigates to the Threads page filtered by that PR.

**Contract**: Add a `threadsBaseUrl` prop to PrTable. The thread count cell becomes `<a href={${threadsBaseUrl}?prId=${pr.id}}>` when `pr.threadCount > 0`. The `threadsBaseUrl` is `/board/${boardId}/threads/${currentLogin}/${period}`, passed from ImpactView.

#### 5. Extract ContributorSelector and PeriodSelector

**File**: `src/components/impact/ImpactView.tsx` → shared location

**Intent**: `ContributorSelector` and `PeriodSelector` are used by both ImpactView and ThreadsView. Move them to a shared location if they aren't already importable.

**Contract**: Check if `ContributorSelector` is already exported from `ImpactView.tsx` (it is — line 68). `PeriodSelector` is a separate file (`src/components/impact/PeriodSelector.tsx`). ThreadsView imports both directly — no move needed if the import paths work. If `ContributorSelector` should not live inside `ImpactView.tsx` long-term, extract it to `src/components/impact/ContributorSelector.tsx` — but this is optional cleanup, not blocking.

### Success Criteria:

#### Automated Verification:

- Type-check passes: `npx tsc --noEmit` and `npm run test:typecheck`
- Lint passes: `npm run lint`
- Tests pass: `npm test`
- Build succeeds: `npm run build`

#### Manual Verification:

- BoardNav shows 4 tabs: Impact, Threads, Activity, Settings
- Threads tab highlights when on the Threads page
- "Inspect threads" link in classification section navigates to Threads page
- Clicking thread count in PrTable opens Threads page filtered to that PR
- Navigation between Impact and Threads preserves the contributor and period context
- Contributor switching on the Threads page works and updates the URL

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- `getClassificationAggregates` returns correct counts for mixed intent/domain data
- `getClassifiedThreads` pagination returns correct offset/total
- `getClassifiedThreads` filters by intent, domain, PR, and role correctly
- `highSignalPercent` calculation edge cases: 0 classified, all high-signal, all low-signal
- Tier assignment constant map covers all 10 intent categories

### Integration Tests:

- Classification API endpoint returns correct aggregates for a seeded contributor
- Threads API endpoint returns paginated results with filters applied
- RLS: contributor can only see threads from boards they belong to

### Manual Testing Steps:

1. Navigate to a contributor with classified threads → classification section renders with correct counts
2. Hover over intent/domain labels → tooltips show definitions
3. Click "Inspect threads" → Threads page opens showing individual threads
4. Apply intent filter → only matching threads shown
5. Apply PR filter → only threads from that PR shown
6. Click thread count in PrTable → Threads page opens with PR filter pre-applied
7. Switch contributor → both classification section and threads page update
8. Change period → both pages reflect the new date range
9. Navigate via BoardNav between Impact and Threads → correct tab highlighted
10. Test with contributor who has no classified threads → empty states render correctly

## Performance Considerations

- The classification aggregation query is a simple GROUP BY on `thread_classifications` joined to `github_review_comments` — indexed on `pull_request_id` and filtered by `commenter_github_id`. For current data volumes (tens to low hundreds of threads per contributor), this is fast.
- The threads list query uses `.range()` for pagination, keeping response sizes bounded at 25-50 rows.
- The 5th parallel fetch for classifications adds one network request but does not block existing sections.
- The SVG donut and CSS flex stacked bar are lightweight — no chart library dependency added.

## Migration Notes

No database migrations needed. The `thread_classifications` table and its RLS policies already exist. The only new SQL is the aggregation query executed at read time by the service function.

## References

- Research: `context/changes/profile-classified-comments/research.md`
- UI prototype: `context/changes/profile-classified-comments/prototype/Impact.html`
- PRD FR-012: `context/foundation/prd.md:144`
- PRD Business Logic: `context/foundation/prd.md:172-178`
- Existing impact service: `src/lib/services/impact-metrics.ts`
- Existing API pattern: `src/pages/api/board/[boardId]/impact/[login]/reviewer.ts`
- Classification types: `src/types.ts:81-102`
- ImpactView orchestrator: `src/components/impact/ImpactView.tsx`
- ThreadQualitySection: `src/components/impact/ThreadQualitySection.tsx`
- BoardNav: `src/components/BoardNav.astro`
- PrTable: `src/components/impact/PrTable.tsx`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Data Pipeline for Classification Aggregates

#### Automated

- [x] 1.1 Type-check passes — 100b7c7
- [x] 1.2 Lint passes — 100b7c7
- [x] 1.3 Tests pass — 100b7c7

#### Manual

- [x] 1.4 API endpoint returns correct JSON shape via curl — 100b7c7
- [x] 1.5 Empty state returns zero counts — 100b7c7

### Phase 2: Classification Section Component

#### Automated

- [x] 2.1 Type-check passes — f78f6f9
- [x] 2.2 Lint passes — f78f6f9
- [x] 2.3 Tests pass — f78f6f9

#### Manual

- [x] 2.4 Section appears between thread quality and heatmap — f78f6f9
- [x] 2.5 Stacked bar shows correct 3-tier grouping — f78f6f9
- [x] 2.6 SVG donut renders with center text — f78f6f9
- [x] 2.7 Tooltips appear on category label hover — f78f6f9
- [x] 2.8 Empty and loading states render correctly — f78f6f9
- [x] 2.9 Coverage footer shows correct counts and progress bar — f78f6f9

### Phase 3: Data Pipeline for Thread List

#### Automated

- [x] 3.1 Type-check passes — e989309
- [x] 3.2 Lint passes — e989309
- [x] 3.3 Tests pass — e989309

#### Manual

- [x] 3.4 API returns paginated thread rows via curl — e989309
- [x] 3.5 Filters work correctly (intent, domain, PR, role) — e989309
- [x] 3.6 Pagination returns correct offset — e989309

### Phase 4: Threads Page

#### Automated

- [x] 4.1 Type-check passes (src and tests) — e2f7506
- [x] 4.2 Lint passes — e2f7506
- [x] 4.3 Tests pass — e2f7506
- [x] 4.4 Build succeeds — e2f7506

#### Manual

- [x] 4.5 Thread list renders with classification badges — e2f7506
- [x] 4.6 Filter dropdowns work correctly — e2f7506
- [x] 4.7 Pagination controls navigate between pages — e2f7506
- [x] 4.8 Contributor selector switches threads — e2f7506
- [x] 4.9 Deep-link with query params pre-fills filters — e2f7506

### Phase 5: Navigation & Integration

#### Automated

- [x] 5.1 Type-check passes (src and tests) — e2f8f54
- [x] 5.2 Lint passes — e2f8f54
- [x] 5.3 Tests pass — e2f8f54
- [x] 5.4 Build succeeds — e2f8f54

#### Manual

- [x] 5.5 BoardNav shows 4 tabs with correct active states — e2f8f54
- [x] 5.6 "Inspect threads" link navigates to Threads page — e2f8f54
- [x] 5.7 PrTable thread count links to Threads page with PR filter — e2f8f54
- [x] 5.8 Navigation preserves contributor and period context — e2f8f54
