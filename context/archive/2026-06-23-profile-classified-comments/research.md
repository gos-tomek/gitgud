---
date: "2026-06-23T12:00:00+02:00"
researcher: Claude (10x-research)
git_commit: c5c385edb96644d6fc07d800e8a984d164da792c
branch: changes/profile-classified-comments
repository: gitgud
topic: "How to present classified comment data on the contributor profile — UI/UX patterns"
tags: [research, classification, profile, ui-ux, impact-view, thread-quality, intent-categories, visual-patterns]
status: complete
last_updated: "2026-06-23"
last_updated_by: Claude (10x-research)
last_updated_note: "Added UI proposal from Impact.html prototype — resolves open questions 1-5"
---

# Research: How to Present Classified Comment Data on the Contributor Profile

**Date**: 2026-06-23T12:00:00+02:00
**Researcher**: Claude (10x-research)
**Git Commit**: c5c385e
**Branch**: changes/profile-classified-comments
**Repository**: gitgud

## Research Question

The classification batch system (`classification-batch` change) now writes `intent` and `domain` labels for every root review comment into `thread_classifications`. The profile page ("Impact view") does not yet read or display this data. How should classified comment data be presented on the contributor profile — what UI/UX patterns fit the existing design system and satisfy PRD requirements?

## Summary

The profile page already has a natural integration point: the **ThreadQualitySection** (the purple "GitGud signal" section). Its `MetricCard` component accepts a `categoryBreakdown` prop (`{ label: string; count: number }[]`) that is already built but never populated — it was scaffolded for exactly this purpose. The classified data lives in `thread_classifications` (10 intent categories, 5 domain categories) but has **zero read path** today: no queries, no API endpoints, no service functions to aggregate it. The full pipeline — query → service → API → component — needs to be built.

Three UI surface options emerged from the research, all compatible with the existing dark glassmorphism design:

1. **Inline enrichment** — add `categoryBreakdown` data to existing MetricCards in ThreadQualitySection (lowest effort, uses existing scaffold).
2. **Dedicated classification section** — a new full-width section below ThreadQualitySection with stacked bars, donut chart, or badge grid for intent/domain distribution.
3. **Per-comment labels in PrTable** — show intent badges on individual comments in the PR table's thread column.

The PRD (FR-012) requires "review comments with assigned semantic category" visible as "category counts shown as an aggregated breakdown" with drill-down to "individual labels per comment" (Business Logic section). This means option 1 alone is insufficient — at minimum, an aggregate breakdown view plus per-comment labels are needed.

## Detailed Findings

### 1. Current Profile Architecture

The Impact page (`src/pages/board/[id]/impact/[githubLogin]/[...dateRange].astro`) uses a two-phase architecture:

- **Phase 1 (SSR)**: Astro frontmatter authenticates user, fetches board metadata and contributor list, passes lightweight props to React.
- **Phase 2 (CSR)**: `ImpactView` (`src/components/impact/ImpactView.tsx:168`) mounts as `client:only="react"` and fires 4 parallel `fetch()` calls to API endpoints under `/api/board/[boardId]/impact/[login]/`:
  - `/summary` → KpiCards (6 KPIs)
  - `/author` → AuthorSection (PR state donut, size distribution)
  - `/reviewer` → ReviewerSection + ThreadQualitySection (verdicts, pickup time, thread metrics)
  - `/activity` → ContributionHeatmap

Classification data could be served through:

- **Extending `/reviewer`**: Add classification aggregates to `ReviewerMetrics` (since thread quality already lives there).
- **New `/classifications` endpoint**: Separate fetch, loaded independently (consistent with the parallel-fetch pattern).

### 2. Data Available for Display

**`thread_classifications` table** (final schema after `20260621120000_classification_batch_voting_schema.sql`):

| Column                   | Type          | Notes                                                   |
| ------------------------ | ------------- | ------------------------------------------------------- |
| `thread_root_comment_id` | `bigint`      | PK, FK to `github_review_comments(id)`                  |
| `pull_request_id`        | `bigint`      | FK to `github_pull_requests(id)`                        |
| `intent`                 | `text`        | 10 values (see below)                                   |
| `domain`                 | `text`        | 5 values (see below)                                    |
| `model_id`               | `text`        | Always `@cf/meta/llama-3.3-70b-instruct-fp8-fast` today |
| `classified_at`          | `timestamptz` | When classification ran                                 |

**Intent categories** (10): `mentoring`, `architecture`, `bug-catch`, `nitpick`, `unblocking`, `question`, `praise`, `joke`, `self-review`, `unknown`

**Domain categories** (5): `functional`, `refactoring`, `documentation`, `discussion`, `false-positive`

**Current read gap**: No service function, API endpoint, or component reads from `thread_classifications`. The `ThreadClassification` type in `src/types.ts:95` exists but is unused. The worker writes data via upsert in `src/worker.ts:186-189` — that's the only touchpoint.

**Join path for aggregation**: `thread_classifications.thread_root_comment_id` → `github_review_comments.id` (filtered by `commenter_github_id` for per-IC view) → `github_review_comments.pull_request_id` → `github_pull_requests` (filtered by date range and board repos).

### 3. Existing UI Scaffold: MetricCard.categoryBreakdown

`ThreadQualitySection.tsx:18-24` defines:

```typescript
interface MetricCardProps {
  label: string;
  value: string;
  sub?: string;
  description?: string;
  categoryBreakdown?: { label: string; count: number }[];
}
```

Lines 44-53 render the breakdown as a key-value list:

```tsx
{
  categoryBreakdown && categoryBreakdown.length > 0 && (
    <div className="mt-1.5 space-y-0.5">
      {categoryBreakdown.map(({ label: l, count }) => (
        <div key={l} className="flex justify-between text-xs text-purple-200/40">
          <span>{l}</span>
          <span>{count}</span>
        </div>
      ))}
    </div>
  );
}
```

This is a ready-made slot for showing intent counts inside an existing metric card. For example, the "Threads started" card could show `mentoring: 5, architecture: 3, nitpick: 12` beneath the total.

### 4. PRD Requirements for Presentation

**FR-012** (`context/foundation/prd.md:142-147`): "Contribution profile shows review comments with assigned semantic category." — Must-have.

**Business Logic** (`context/foundation/prd.md:172-178`):

> "On the profile surface, category counts are shown as an aggregated breakdown (e.g. '13 architecture, 4 mentoring, 22 nitpick'). Clicking through reveals individual labels per comment."

**Success Criteria — Secondary** (`context/foundation/prd.md:46-47`):

> "Comment classification is visible to the IC: each classified comment shows its assigned category and allows the IC to signal agreement or correction."

This defines **two presentation layers**:

1. **Aggregate view**: category count breakdown (the "13 architecture, 4 mentoring" pattern).
2. **Detail view**: per-comment intent label visible on individual comments (the "clicking through" pattern).

FR-013 (IC can flag a category as inaccurate) is nice-to-have with a dependency gate — not in scope for this change unless the correction-signal pathway exists.

### 5. UI Pattern Options

#### Option A: Enrich ThreadQualitySection with category breakdown

**What**: Add a new MetricCard (or repurpose "Threads started") inside the existing 8-card grid, populated with `categoryBreakdown` data from classified threads.

**Fits because**:

- The MetricCard scaffold already renders `categoryBreakdown` lists (lines 44-53).
- ThreadQualitySection is the "GitGud signal" section — classification is the core GitGud signal.
- Purple accent theme visually separates it as the AI-powered section.

**Limitations**:

- The MetricCard layout (small card, key-value list) works for ~4-5 categories but may feel cramped with 10 intent categories.
- No chart or visual weight — just numbers.
- No drill-down to per-comment labels.

**Effort**: Low — wire data through existing props.

#### Option B: Dedicated classification section (new component)

**What**: A new full-width section (like AuthorSection/ReviewerSection) placed after ThreadQualitySection, showing:

- **Stacked horizontal bar** (like the review verdict mix in `ReviewerSection.tsx:69-104`) for intent distribution.
- **Donut chart** (like `AuthorSection.tsx:116-135`) for intent or domain breakdown.
- **Category cards** with counts and color-coded badges.
- Optional: top-N commented PRs per category.

**Fits because**:

- The app already uses stacked bars (verdict mix) and donut charts (PR states) for categorical distributions — visual consistency.
- Full-width section gives room for 10 intent categories.
- Can use the purple accent theme from ThreadQualitySection to visually tie it to the "GitGud signal" brand.

**Limitations**:

- New component + API endpoint = more code.
- 5 dark chart colors exist (`--chart-1` through `--chart-5`) — 10 intent categories need a custom palette.
- No drill-down unless combined with PrTable changes.

**Effort**: Medium — new section component, new API endpoint, color palette extension.

#### Option C: Per-comment intent badges in PrTable

**What**: In the existing PrTable (`src/components/impact/PrTable.tsx`), add an intent badge (like the PR state badge pattern) to each PR row's "Threads" column, or expand to show individual comments with their classification.

**Fits because**:

- PRD Business Logic says "clicking through reveals individual labels per comment."
- The PrTable already shows thread counts — natural place for thread-level detail.
- Badge styling pattern exists: `rounded px-1.5 py-0.5 text-xs font-semibold` with category-specific bg/text colors.

**Limitations**:

- PrTable shows PR-level rows, not comment-level — expanding to comments needs an expandable row or a detail panel.
- Requires joining `thread_classifications` to PR-level data in the author/reviewer API responses.
- May overload the table visually.

**Effort**: Medium-high — expandable rows, per-comment data fetch, badge color system.

#### Chosen design: dedicated "What kind of feedback" section (from Impact.html prototype)

The HTML prototype (`context/changes/profile-classified-comments/prototype/Impact.html`) locks down the UI. It is a **new full-width section** placed between ThreadQualitySection and the Activity heatmap, using the same purple glassmorphism treatment (`linear-gradient(180deg, #faf5ff 0%, #ffffff 55%)`, `border: 1px solid #e9d5ff`).

**Section header**: "AI classified" badge (star icon + purple pill) + heading "What kind of feedback" + subtitle explaining intent/domain axes. An "Inspect threads" link at top-right provides drill-down to per-comment labels (satisfies PRD's "clicking through reveals individual labels per comment").

**Layout**: `grid-template-columns: 1.7fr 1fr` — intent on the left (wider), domain on the right (separated by `border-left: 1px solid #ede9fe`).

##### Intent panel (left, ~63% width)

1. **KPI callout** (top-right): "50%" + "high-signal" — percentage of threads in the high-signal tier.
2. **Signal-ordered stacked bar** (34px tall, gap: 3px between tiers):
   - **High-signal tier** (flex:18): Architecture (blue-500), Bug-catch (red-500), Mentoring (emerald-500), Unblocking (cyan-500).
   - **Routine tier** (flex:15): Nitpick (amber-500), Question (violet-500), Praise (yellow-500).
   - **Low-signal tier** (flex:3): Joke (pink-500), Self-review (zinc-400), Unknown (zinc-300).
   - The three tiers are visually separated by the 3px gap, making the signal-to-noise ratio instantly scannable.
3. **Tier scale labels** (below bar, monospace 10px): "High-signal · 18", "Routine · 15", "Low · 3" — each with a colored dot matching the tier.
4. **Legend grid** (2-column, 8 rows): Each row has a 9×9 colored square, label with tooltip (on hover, shows definition), and count in monospace. Low-signal categories (`joke`, `self-review`, `unknown`) are grouped into a single "Joke / self-review / other" row with muted gray styling.

**Intent color map** (confirmed by prototype):

| Intent         | Color                   | Tier        |
| -------------- | ----------------------- | ----------- |
| `architecture` | `#3b82f6` (blue-500)    | high-signal |
| `bug-catch`    | `#ef4444` (red-500)     | high-signal |
| `mentoring`    | `#10b981` (emerald-500) | high-signal |
| `unblocking`   | `#06b6d4` (cyan-500)    | high-signal |
| `nitpick`      | `#f59e0b` (amber-500)   | routine     |
| `question`     | `#8b5cf6` (violet-500)  | routine     |
| `praise`       | `#eab308` (yellow-500)  | routine     |
| `joke`         | `#ec4899` (pink-500)    | low-signal  |
| `self-review`  | `#a1a1aa` (zinc-400)    | low-signal  |
| `unknown`      | `#d4d4d8` (zinc-300)    | low-signal  |

##### Domain panel (right, ~37% width)

1. **Donut chart** (SVG, 104×104px, stroke-width 13, r=42): 5 segments, with the largest slice percentage + label shown as center text ("42% functional").
2. **Legend** (vertical list beside donut, 5 rows): colored circle (9px, rounded-full) + label with tooltip + count in monospace. `false-positive` is muted gray like the low-signal intents.

**Domain color map** (confirmed by prototype):

| Domain           | Color                   | Shape  |
| ---------------- | ----------------------- | ------ |
| `functional`     | `#7c3aed` (violet-600)  | circle |
| `refactoring`    | `#0ea5e9` (sky-500)     | circle |
| `documentation`  | `#10b981` (emerald-500) | circle |
| `discussion`     | `#f59e0b` (amber-500)   | circle |
| `false-positive` | `#d4d4d8` (zinc-300)    | circle |

##### Coverage footer

Below both panels, separated by `border-top: 1px solid #ede9fe`:

- "36 of 41 threads classified" + progress bar (width % = classified/total, accent color) + "5 pending" label.
- Right-aligned model attribution: "llama-3.3-70b · daily batch · majority vote ×3" (monospace 11px, zinc-400).

##### Tooltip content (from prototype)

Each intent/domain label has a hover tooltip with a one-line definition:

| Category                   | Tooltip                                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Architecture               | Feedback on how the code is structured — design patterns, abstractions, module boundaries, system-level decisions. |
| Bug-catch                  | Points out a defect, edge case, or incorrect behaviour before it ships.                                            |
| Mentoring                  | Teaches or explains — shares context, rationale, or guidance to help the author grow.                              |
| Unblocking                 | Clears the path to merge — answers a blocking question or resolves what was holding the PR up.                     |
| Nitpick                    | Minor, non-blocking point — naming, formatting, or personal preference.                                            |
| Question                   | Asks for clarification or rationale without asserting a specific change.                                           |
| Praise                     | Positive reinforcement — calls out something done well.                                                            |
| Joke / self-review / other | Off-topic banter, the author commenting on their own PR, or comments the model couldn't classify.                  |
| Functional                 | Touches runtime behaviour — logic, features, and whether the code does the right thing.                            |
| Refactoring                | Changes structure without changing behaviour — cleanups, renames, reorganisation.                                  |
| Documentation              | Docstrings, READMEs, and code comments — explanatory text rather than logic.                                       |
| Discussion                 | Meta-conversation — process, scope, or planning not tied to a specific line of code.                               |
| False-positive             | Not genuine review feedback — bot noise, accidental, or a misfired comment.                                        |

### 6. Color Palette (confirmed by prototype)

The prototype uses Tailwind's 500-level palette for intent (not the existing `--chart-*` CSS vars) and a separate 5-color palette for domain. Both are used on a light purple gradient background (`#faf5ff → #ffffff`), not the dark glassmorphism. See the color tables in §5 "Chosen design" above for the exact hex values.

Key design decisions:

- **500-level colors** (not 400-level as originally suggested) for sufficient contrast on the light background.
- **No shared colors between intent and domain** except emerald-500 (used for both `mentoring` and `documentation`). This is acceptable because intent and domain are always displayed in separate panels.
- **Three-tier grouping** for intent (high-signal / routine / low-signal) replaces the flat 10-item list from the original research. The low-signal tier (`joke`, `self-review`, `unknown`) is collapsed into one legend row.
- **Domain uses `--chart-*` independent colors**: violet-600, sky-500, emerald-500, amber-500, zinc-300.

### 7. Data Flow for Classification Display

```
 ┌──────────────────────────────┐
 │  thread_classifications      │
 │  (intent, domain per thread) │
 └──────────┬───────────────────┘
            │ JOIN thread_root_comment_id
 ┌──────────▼───────────────────┐
 │  github_review_comments      │
 │  (commenter_github_id,       │
 │   pull_request_id, date)     │
 └──────────┬───────────────────┘
            │ filter by contributor + date range + board repos
 ┌──────────▼───────────────────┐
 │  Service: classificationAgg  │
 │  ── intentCounts[]           │  { category, count, tier }
 │  ── domainCounts[]           │  { category, count }
 │  ── totalClassified          │
 │  ── totalThreads             │
 │  ── highSignalPct            │  (architecture+bug-catch+mentoring+unblocking) / total
 └──────────┬───────────────────┘
            │
 ┌──────────▼───────────────────┐
 │ API: /api/board/[id]/impact/ │
 │   [login]/classifications    │
 └──────────┬───────────────────┘
            │
 ┌──────────▼────────────────────────────────────────────┐
 │ Component: ClassificationSection                      │
 │                                                       │
 │  ┌─ Intent panel (1.7fr) ──────┬─ Domain panel (1fr)─┐│
 │  │ highSignalPct KPI           │ Donut SVG (5 slices) ││
 │  │ 3-tier stacked bar          │ Legend (5 rows)      ││
 │  │ Tier scale labels           │                      ││
 │  │ Legend grid (2-col, 8 rows) │                      ││
 │  └─────────────────────────────┴──────────────────────┘│
 │  Coverage footer: "N of M classified" + progress bar   │
 │  Model attribution: "llama-3.3-70b · daily batch · ×3" │
 └────────────────────────────────────────────────────────┘
```

### 8. Unclassified Threads Indicator (confirmed by prototype)

The prototype resolves this with a **coverage footer** at the bottom of the classification section:

- Text: "36 of 41 threads classified" (left-aligned).
- Progress bar: percentage fill in accent color, max-width 220px, 5px tall, rounded.
- "5 pending" label (right of bar, monospace, zinc-400).
- Unclassified threads are excluded from intent/domain counts — they are "pending", not "unknown". The `unknown` intent category is for threads that were classified but the model couldn't determine intent.

## Code References

- `context/changes/profile-classified-comments/prototype/Impact.html` — **UI prototype** (full-page HTML mockup with all sections including classification)
- `src/components/impact/ThreadQualitySection.tsx:18-56` — MetricCard with unused categoryBreakdown prop
- `src/components/impact/ImpactView.tsx:168-318` — Main orchestrator, parallel fetch pattern
- `src/components/impact/ReviewerSection.tsx:69-104` — Stacked bar pattern (verdict mix)
- `src/components/impact/AuthorSection.tsx:116-135` — Donut chart pattern (PR states)
- `src/components/impact/PrTable.tsx:8-12` — Badge color pattern (PR state badges)
- `src/components/impact/KpiCards.tsx:46-78` — KPI card pattern
- `src/types.ts:81-102` — IntentCategory, TechnicalDomain, ThreadClassification types
- `src/lib/services/impact-metrics.ts` — Impact service (no classification queries today)
- `src/lib/services/classification.ts` — Classification service (write-only, no read aggregation)
- `src/worker.ts:186-189` — Only write to thread_classifications
- `supabase/migrations/20260621120000_classification_batch_voting_schema.sql` — Final schema
- `src/styles/global.css` — OKLCH color system, chart-1 through chart-5
- `context/foundation/prd.md:142-178` — FR-012, Business Logic (aggregate + drill-down)

## Architecture Insights

1. **Parallel-fetch pattern**: ImpactView fires 4 independent fetches. A 5th `/classifications` endpoint fits naturally — no refactoring needed.
2. **Section independence**: Each section manages its own loading/empty/data states via `SectionState<T>`. A new ClassificationSection follows the same pattern.
3. **No server-side aggregation exists**: The `impact-metrics.ts` service computes thread metrics from raw comments. Classification aggregation (GROUP BY intent) is a new service function, not an extension of existing queries.
4. **RLS already covers reads**: `thread_classifications` has a SELECT policy for board members (`20260618120000_thread_classifications.sql`). No new policies needed.
5. **Donut chart — SVG vs Recharts**: The prototype uses a hand-crafted SVG donut (stroke-dasharray on `<circle>` elements), not the Recharts `<PieChart>` component used in AuthorSection. This is simpler (no library dependency for 5 segments) and matches the exact radius/stroke-width from the prototype. Recommend keeping the SVG approach.
6. **Stacked bar — CSS flex vs Recharts**: The intent stacked bar is pure CSS flex (`display:flex; flex:<count>`) with 3 sub-groups (tiers) separated by gaps. Not a Recharts `<BarChart>`. This is lighter and gives precise control over the tier-gap visual.
7. **Light purple theme, not dark**: The prototype uses a light gradient (`#faf5ff → #ffffff`) with `border: 1px solid #e9d5ff` — same as ThreadQualitySection. This is NOT the dark glassmorphism from the earlier research. Colors are Tailwind 500-level hex, not OKLCH `--chart-*` vars.
8. **Three-tier signal model**: The stacked bar introduces a concept not present in the data layer: grouping intents into high-signal / routine / low-signal tiers. This is a presentation concern — the API returns flat counts, the component groups them. The tier assignment should be a constant map in the component, not in the DB or service layer.
9. **Tooltip pattern**: The prototype uses a custom CSS tooltip (`.tt` / `.tt-pop` classes), not a shadcn `<Tooltip>` component. Need to decide whether to port the CSS pattern or use shadcn's Radix-based Tooltip.

## Historical Context (from prior changes)

- `context/changes/classification-batch/change.md` — Documents the narrowing from 5 classification axes to 2 (intent + domain). The `categoryBreakdown` MetricCard prop was likely added in anticipation of this simplified schema.
- `context/changes/classification-batch/research.md` — Workers AI chosen as the classification engine. Model: `@cf/meta/llama-3.3-70b-instruct-fp8-fast`. Majority voting (3 repeats) for accuracy.
- `context/archive/2026-06-15-profile-raw-github-metrics/` — The change that built the current Impact view with all its sections. Established the parallel-fetch, section-state, glassmorphism patterns.
- `context/archive/2026-06-22-em-switch-ic-dropdown/` — Added the ContributorSelector for client-side IC switching without page reload.

## Open Questions (resolved by prototype)

All five original open questions are resolved by the Impact.html prototype:

1. **Intent and domain: separate or combined?** → **Side-by-side in one section** (1.7fr / 1fr grid). Intent is primary (wider, with tier grouping and KPI); domain is secondary (narrower, donut chart).

2. **Aggregation granularity?** → **Simple counts per category**, scoped to the contributor + date range. No per-PR, per-repo, or trend breakdown. The `highSignalPct` KPI is the only derived metric.

3. **Low-signal categories?** → **Grouped into one legend row** ("Joke / self-review / other") with muted gray styling. They still appear as individual segments in the stacked bar (keeping the total accurate) but the legend avoids clutter.

4. **Classification progress as KPI?** → **No, it's a footer indicator** inside the classification section, not a KpiCard. "36 of 41 threads classified" + progress bar + "5 pending".

5. **Drill-down UX?** → **"Inspect threads" link** at section top-right. The prototype shows it as a styled link (`#7c3aed` text, white bg, purple border, right-chevron icon). Target destination TBD — likely a filtered view of the PrTable or a dedicated thread list page.

## Remaining Open Questions

1. **"Inspect threads" link target**: The prototype shows the link but not where it navigates. Options: (a) anchor to PrTable with a classification filter applied, (b) a new `/threads` page showing individual classified comments, (c) a drawer/modal overlay.

2. **Section placement in ImpactView**: The prototype places the classification section _after_ ThreadQualitySection and _before_ Activity heatmap. The current `ImpactView.tsx` renders sections in a fixed order — need to confirm this insertion point in the component.

## Follow-up Research — 2026-06-23T14:00:00+02:00

### UI Proposal from Impact.html Prototype

The HTML prototype (`prototype/Impact.html`) was analyzed to resolve all original open questions and lock down the visual specification for the classification section. Key findings:

1. **Section design confirmed**: A dedicated "What kind of feedback" section with purple glassmorphism treatment, placed between ThreadQualitySection and Activity heatmap.

2. **Intent visualization**: Signal-ordered 3-tier stacked bar (not a Recharts chart) with CSS flex. Tiers: high-signal (architecture, bug-catch, mentoring, unblocking), routine (nitpick, question, praise), low-signal (joke, self-review, unknown). KPI: "X% high-signal".

3. **Domain visualization**: Hand-crafted SVG donut (stroke-dasharray, not Recharts PieChart) with center text showing top category percentage. 5 segments with legend.

4. **Coverage footer**: "N of M threads classified" progress bar + "pending" count + model attribution line.

5. **Color palette finalized**: Tailwind 500-level hex values for all 10 intent and 5 domain categories (see tables in §5).

6. **All 5 original open questions resolved** — see "Open Questions (resolved by prototype)" section above.

7. **New architecture insights**: SVG donut > Recharts for this use case; CSS flex stacked bar > Recharts BarChart; three-tier signal model is a presentation concern (constant map in component); tooltip pattern needs decision (CSS custom vs shadcn Tooltip).
