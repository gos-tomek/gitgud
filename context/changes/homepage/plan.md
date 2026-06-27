# GitGud Public Homepage — Implementation Plan

## Overview

Replace the generic "10x Astro Starter" landing page with a branded GitGud homepage: light green palette, logo, custom favicon (white cat icon in green circle), value proposition content derived from the PRD, and live usage stats cached in Cloudflare KV (1h TTL). Then migrate the existing app pages from the dark cosmic theme to the new brand color system.

## Current State Analysis

- **Homepage**: `src/pages/index.astro` redirects authenticated users to `/dashboard`, renders `Welcome.astro` for unauthenticated visitors. `Welcome.astro` is a dark cosmic-themed placeholder with purple gradients, star fields, and generic "10x Astro Starter" text.
- **Topbar**: `src/components/Topbar.astro` uses dark theme classes (`text-white/80`, `bg-white/5`, `text-purple-300`).
- **Token system**: `src/styles/global.css` has the full shadcn/ui oklch token system with `:root` (light) and `.dark` variants. `--primary` is currently neutral gray — needs to become green.
- **Layout**: `src/layouts/Layout.astro` uses `bg-background text-foreground` base tokens. Default title is "10x Astro Starter".
- **Design assets**: `context/changes/homepage/design/logo_gitgud.png` (cat head + "GitGud" wordmark, dark gray on white), `palette.html` defines green-centric colors (`#22c55e` primary, `#f0fdf4` background, `#16a34a` dark green, `#3b82f6` blue accent).
- **Stats**: No existing aggregation endpoint or caching. Service-role client exists (`src/lib/supabase-admin.ts`). All tables have `REVOKE ALL FROM anon`. Tables available: `boards`, `board_contributors`, `github_repos`, `github_pull_requests`, `thread_classifications`.
- **Env**: `SUPABASE_SERVICE_KEY` declared in `astro.config.mjs` env schema. No KV namespace configured.
- **Dark theme files**: ~30+ files across pages and components use cosmic dark classes (`bg-cosmic`, `text-purple-*`, `border-white/10`, `bg-white/5`).

### Key Discoveries:

- `global.css:113-115` defines `@utility bg-cosmic` — the dark gradient utility used by `Welcome.astro` and most app pages
- `src/env.d.ts:9-18` declares `Cloudflare.Env` — KV binding type must be added here
- `wrangler.jsonc` has no KV namespace — needs adding
- `astro.config.mjs` env schema already has `SUPABASE_SERVICE_KEY` — stats service can use it
- The `session` config in `astro.config.mjs:18` explicitly disables the Cloudflare adapter's auto-wired KV — our KV namespace is separate and unaffected

## Desired End State

Unauthenticated visitors see a clean, light-themed GitGud homepage with:

- A branded nav bar (logo + sign in / sign up)
- Hero section with value proposition ("Surface invisible engineering contributions")
- Feature cards explaining what GitGud does (review classification, contribution profiles, team visibility)
- Live usage stats (boards created, contributors tracked, repos connected, % high-impact reviews)
- A clear CTA to sign up
- A custom favicon (white cat icon in green circle)

Existing app pages (dashboard, board views, auth pages, profile) use the new brand color tokens instead of the cosmic dark theme.

Stats are served from a Cloudflare KV cache with 1h TTL, populated by a service-role aggregate query. When stats are zero (fresh instance), the section renders with "0" values — consistent layout regardless of data state.

## What We're NOT Doing

- Real-time stats (WebSocket / streaming) — cached periodic stats are sufficient
- App-wide dark/light mode toggle — we're migrating to light mode, not offering a choice
- SEO/meta tags beyond basic title — can be added later
- Responsive mobile-first redesign of the app — Phase 4 recolors existing layouts, doesn't restructure them
- Animation or transitions on the homepage — keep it simple for v1

## Implementation Approach

Five phases, ordered by dependency:

1. **Phase 0 (Design)**: Build the homepage visual design as a static page — all sections, layout, colors, logo placement, placeholder stats. This is the creative/visual phase.
2. **Phase 1 (Tokens & Favicon)**: Wire brand colors into the shadcn/ui token system and generate the favicon. This sets the design system foundation.
3. **Phase 2 (Stats Pipeline)**: Create KV namespace, build stats service, expose API endpoint. Infrastructure phase.
4. **Phase 3 (Integration)**: Connect live stats to the homepage, handle zero/error states.
5. **Phase 4 (App Recolor)**: Migrate existing app pages and components from cosmic dark to the new brand color tokens.

Phases 0-1 can be developed together since Phase 0 will use the brand colors directly. Phase 2 is independent infrastructure. Phase 3 wires 0+1+2 together. Phase 4 is the app-wide migration.

---

## Phase 0: Homepage Visual Design

### Overview

Build the full homepage layout as a static Astro page with all visual sections. Stats values are hardcoded placeholders — Phase 3 will wire in live data. This phase establishes the page structure, content, and visual identity.

### Changes Required:

#### 1. Homepage-specific navigation

**File**: `src/components/HomepageNav.astro`

**Intent**: New light-themed navigation bar for the homepage. Logo on the left (using the `logo_gitgud.png` asset), Sign In / Sign Up links on the right. Does not replace `Topbar.astro` — that component stays for authenticated app pages until Phase 4.

**Contract**: Astro component, no props. Reads `Astro.locals.user` to show Dashboard link + Sign Out (if authenticated) or Sign In + Sign Up (if not). Uses Tailwind classes with the green brand palette directly (not token-dependent — tokens come in Phase 1).

#### 2. Homepage content sections

**File**: `src/components/Homepage.astro`

**Intent**: Replace `Welcome.astro` with a branded homepage. Light background (`#f0fdf4` / green-50), structured in sections:

1. **Hero**: Headline derived from PRD vision ("Surface the invisible contributions that keep your team running"), subheadline explaining the tool's purpose (classify review comments, build contribution profiles, make glue work visible). Primary CTA "Get Started" → `/auth/signup`, secondary CTA "Sign In" → `/auth/signin`.

2. **Features**: 3 cards explaining what GitGud does:
   - **Review Classification** — AI classifies review comments by impact (architectural guidance, mentoring, nitpick, etc.)
   - **Contribution Profiles** — See the full picture: PRs authored, reviews given, classified comments, beyond just commit counts
   - **Team Visibility** — Engineering managers get data-backed evidence for performance reviews, not guesswork

3. **Stats bar**: Horizontal row of 4 metric cards with hardcoded placeholder values:
   - Boards created (placeholder: "0")
   - Contributors tracked (placeholder: "0")
   - Repos connected (placeholder: "0")
   - % high-impact reviews (placeholder: "0%")

4. **Bottom CTA**: Repeat sign-up call to action.

**Contract**: Astro component, no props. Content text derived from PRD §Vision & Problem Statement and §User Stories. Guard rails: no IC ranking language, no comparison language (per PRD §Guardrails).

#### 3. Wire homepage into index.astro

**File**: `src/pages/index.astro`

**Intent**: Replace `Welcome` import with `Homepage` import. Keep the authenticated redirect to `/dashboard`.

**Contract**: Import `Homepage.astro` instead of `Welcome.astro`. Layout wrapper stays.

#### 4. Add logo to public directory

**File**: `public/logo_gitgud.png`

**Intent**: Copy the logo asset from design folder to `public/` so it can be referenced as `/logo_gitgud.png` in the nav.

**Contract**: Static file copy from `context/changes/homepage/design/logo_gitgud.png`.

### Success Criteria:

#### Automated Verification:

- Build succeeds: `npm run build`
- Type checking passes: `npx tsc --noEmit`
- Lint passes: `npm run lint`

#### Manual Verification:

- Homepage renders with light green background, branded nav, hero, features, stats placeholder, and CTAs
- Sign In / Sign Up links navigate to correct auth pages
- Authenticated users still redirect to `/dashboard`
- Page looks reasonable on mobile viewports (no broken layout)
- Logo displays correctly in the nav

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 1: Brand Tokens & Favicon

### Overview

Wire the green brand palette into the shadcn/ui token system so all token-based components use brand colors. Generate the custom favicon (white cat icon in green circle). Update Layout defaults.

### Changes Required:

#### 1. Update shadcn/ui token system

**File**: `src/styles/global.css`

**Intent**: Replace the neutral gray `--primary` token with green-500 (`#22c55e`) in oklch. Update `--accent` to use the blue accent (`#3b82f6`). Keep the dark variant tokens consistent. Remove or keep the `@utility bg-cosmic` — it stays until Phase 4 removes its last consumer.

**Contract**: `:root` block: `--primary` becomes the oklch equivalent of `#22c55e` (approx `oklch(0.723 0.219 142.5)`), `--primary-foreground` stays white. `--accent` becomes the oklch equivalent of `#3b82f6`. The `.dark` block gets corresponding adjustments.

#### 2. Generate favicon

**File**: `public/favicon.png`

**Intent**: Replace the generic favicon with a custom one: the cat icon from the logo, rendered white inside a green (#22c55e) circle, transparent background. 32x32 PNG.

**Contract**: Manual asset creation. Extract the cat-head portion from `logo_gitgud.png`, render it white on a `#22c55e` circular background, export as 32x32 PNG. Overwrite existing `public/favicon.png`.

#### 3. Update Layout defaults

**File**: `src/layouts/Layout.astro`

**Intent**: Change the default page title from "10x Astro Starter" to "GitGud".

**Contract**: `title` prop default changes from `"10x Astro Starter"` to `"GitGud"`.

### Success Criteria:

#### Automated Verification:

- Build succeeds: `npm run build`
- Type checking passes: `npx tsc --noEmit`
- Lint passes: `npm run lint`

#### Manual Verification:

- Browser tab shows the new favicon (cat in green circle)
- Homepage uses green primary color for CTAs and accents
- Any shadcn/ui components (buttons, etc.) pick up the green primary automatically
- Page title reads "GitGud" in the browser tab

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Stats Data Pipeline

### Overview

Create the infrastructure for serving homepage stats: Cloudflare KV namespace for caching, a stats aggregation service using the service-role client, and an API endpoint that populates + reads from KV.

### Changes Required:

#### 1. Create Cloudflare KV namespace

**File**: `wrangler.jsonc`

**Intent**: Add a KV namespace binding for caching homepage stats.

**Contract**: Add a `kv_namespaces` entry with binding name `HOMEPAGE_CACHE`. The namespace ID will be created via `wrangler kv namespace create HOMEPAGE_CACHE` and the returned ID placed in the config. For local dev, `wrangler.jsonc` is sufficient — Miniflare auto-provisions KV locally.

#### 2. Add KV binding type

**File**: `src/env.d.ts`

**Intent**: Declare the `HOMEPAGE_CACHE` KV binding in the Cloudflare env type.

**Contract**: Add `HOMEPAGE_CACHE: KVNamespace;` to the `Cloudflare.Env` interface.

#### 3. Stats aggregation service

**File**: `src/lib/services/homepage-stats.ts`

**Intent**: Service that aggregates platform-wide stats using the service-role client. Returns counts of boards, contributors, repos, and the percentage of review threads classified as high-impact.

**Contract**: Exports a `getHomepageStats(serviceClient)` function returning `{ boards: number, contributors: number, repos: number, highImpactPercent: number }`. Queries:

- `SELECT count(*) FROM boards`
- `SELECT count(DISTINCT github_login) FROM board_contributors`
- `SELECT count(*) FROM github_repos`
- For high-impact %: count of `thread_classifications` with high-impact categories vs total classified threads. High-impact categories to include: `"architectural"`, `"mentoring"`, `"bug-fix"`, `"knowledge-sharing"` (derived from classification service categories).

#### 4. Stats API endpoint with KV caching

**File**: `src/pages/api/stats.ts`

**Intent**: Public GET endpoint that serves cached stats from KV. On cache miss (or expired TTL), queries fresh stats via the service, writes to KV with 1h TTL, and returns the result. No auth required — this is for the public homepage.

**Contract**: `GET` export. Reads from `HOMEPAGE_CACHE` KV with key `"homepage-stats"`. If present and not expired, returns cached JSON. On miss: calls `getHomepageStats`, writes result to KV with `expirationTtl: 3600` (1 hour), returns JSON. Access to KV via Cloudflare's runtime env (the Astro Cloudflare adapter exposes bindings via `Astro.locals.runtime.env`).

### Success Criteria:

#### Automated Verification:

- Build succeeds: `npm run build`
- Type checking passes: `npx tsc --noEmit`
- Lint passes: `npm run lint`
- `wrangler kv namespace create HOMEPAGE_CACHE` succeeds (or skip if already exists)

#### Manual Verification:

- `curl http://localhost:4321/api/stats` returns JSON with `boards`, `contributors`, `repos`, `highImpactPercent` fields
- Second request within 1h returns the same data (cached)
- With local Supabase running, stats reflect actual table counts

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Stats Integration & Polish

### Overview

Wire the live stats API into the homepage, replacing hardcoded placeholders. Handle zero and error states gracefully.

### Changes Required:

#### 1. Fetch stats server-side in the homepage

**File**: `src/components/Homepage.astro` (or `src/pages/index.astro`)

**Intent**: Fetch stats from the API endpoint at render time (SSR) and pass them to the stats section. On failure, fall back to zeros.

**Contract**: In the Astro frontmatter, fetch `/api/stats` (internal fetch — Astro handles this server-side). If the fetch fails or returns non-200, use `{ boards: 0, contributors: 0, repos: 0, highImpactPercent: 0 }` as defaults. Pass values into the stats bar markup.

#### 2. Stats display with zero handling

**File**: `src/components/Homepage.astro`

**Intent**: Render stats values from the API. When all stats are zero, still show the section with "0" values — consistent layout.

**Contract**: Stats bar renders `boards`, `contributors`, `repos` as integer counts and `highImpactPercent` as `"X%"`. No special empty-state message — "0" is the empty state.

### Success Criteria:

#### Automated Verification:

- Build succeeds: `npm run build`
- Type checking passes: `npx tsc --noEmit`
- Lint passes: `npm run lint`

#### Manual Verification:

- Homepage stats section shows live data from the database (with local Supabase running)
- With Supabase stopped, homepage still renders with "0" values (graceful degradation)
- Stats update after KV cache expires (1h TTL)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: App-Wide Brand Color Migration

### Overview

Migrate all existing app pages and components from the dark cosmic theme to the light brand color system. Replace ad-hoc dark classes (`bg-cosmic`, `text-purple-*`, `border-white/10`, `bg-white/5`) with shadcn/ui token classes (`bg-background`, `text-foreground`, `bg-primary`, `text-primary`, `border-border`, etc.).

### Changes Required:

#### 1. Auth pages

**Files**:

- `src/pages/auth/signin.astro`
- `src/pages/auth/signup.astro`
- `src/pages/auth/confirm-email.astro`

**Intent**: Replace cosmic dark backgrounds and purple accent colors with token-based classes. These are public-facing pages and should match the homepage's light palette.

**Contract**: Replace `bg-cosmic` with `bg-background`, purple text/border classes with token equivalents (`text-primary`, `border-border`, etc.). Remove cosmic orbs/star field decorative elements.

#### 2. Dashboard

**File**: `src/pages/dashboard.astro`

**Intent**: Migrate the dashboard page from dark to light theme using token classes.

**Contract**: Same pattern — `bg-cosmic` → `bg-background`, purple accents → token classes.

#### 3. Board pages

**Files**:

- `src/pages/board/new.astro`
- `src/pages/board/[id].astro`
- `src/pages/board/[id]/settings.astro`
- `src/pages/board/[id]/impact/index.astro`
- `src/pages/board/[id]/impact/[githubLogin]/[...dateRange].astro`
- `src/pages/board/[id]/threads/index.astro`
- `src/pages/board/[id]/threads/[githubLogin]/[...dateRange].astro`
- `src/pages/board/[id]/activity/[...dateRange].astro`

**Intent**: Migrate all board-related pages from dark to light theme.

**Contract**: Same token substitution pattern as auth pages.

#### 4. Profile page

**File**: `src/pages/profile/settings.astro`

**Intent**: Migrate profile settings from dark to light theme.

**Contract**: Same token substitution pattern.

#### 5. App Topbar

**File**: `src/components/Topbar.astro`

**Intent**: Restyle the app Topbar for the light theme. This component is used by authenticated app pages (not the homepage — that uses `HomepageNav.astro`).

**Contract**: Replace dark-themed classes (`text-white/80`, `bg-white/5`, `border-white/10`, `text-purple-300`) with token classes (`text-foreground`, `bg-card`, `border-border`, `text-primary`).

#### 6. BoardNav and BoardTopbar

**Files**:

- `src/components/BoardNav.astro`
- `src/components/BoardTopbar.astro`

**Intent**: Migrate board navigation components to light theme.

**Contract**: Same token substitution pattern.

#### 7. React components with hardcoded dark classes

**Files**:

- `src/components/CreateBoardForm.tsx`
- `src/components/ChangePasswordForm.tsx`
- `src/components/PatUpdateForm.tsx`
- `src/components/DeleteAccountDialog.tsx`
- `src/components/auth/FormField.tsx`
- `src/components/auth/SignUpForm.tsx`
- `src/components/auth/SubmitButton.tsx`
- `src/components/impact/ImpactView.tsx`
- `src/components/impact/PrTable.tsx`
- `src/components/impact/AuthorSection.tsx`
- `src/components/impact/ReviewerSection.tsx`
- `src/components/impact/ClassificationSection.tsx`
- `src/components/impact/ThreadQualitySection.tsx`
- `src/components/impact/SyncIndicator.tsx`
- `src/components/impact/PeriodSelector.tsx`
- `src/components/impact/RepoActivitySection.tsx`
- `src/components/impact/CollaboratorsSection.tsx`
- `src/components/impact/ContributionHeatmap.tsx`
- `src/components/impact/KpiCards.tsx`
- `src/components/impact/ActivityChart.tsx`
- `src/components/threads/ThreadsView.tsx`
- `src/components/ui/LibBadge.astro`

**Intent**: Replace hardcoded dark-theme color classes in all React components with token-based classes. These components are rendered as islands within Astro pages.

**Contract**: Systematically replace:

- `bg-white/5`, `bg-white/10` → `bg-card` or `bg-muted`
- `border-white/10`, `border-white/20` → `border-border`
- `text-white`, `text-white/80` → `text-foreground` or `text-card-foreground`
- `text-blue-100/70`, `text-blue-100/60` → `text-muted-foreground`
- `text-purple-300`, `text-purple-100` → `text-primary`
- `bg-purple-600`, `bg-purple-500` → `bg-primary`
- `hover:bg-purple-500` → `hover:bg-primary/90`
- `hover:bg-white/10` → `hover:bg-accent`

#### 8. Remove cosmic utility

**File**: `src/styles/global.css`

**Intent**: Remove the `@utility bg-cosmic` definition once no files reference it.

**Contract**: Delete lines 113-115 (`@utility bg-cosmic { ... }`). Verify with `grep -r "bg-cosmic" src/` that no references remain before removing.

### Success Criteria:

#### Automated Verification:

- Build succeeds: `npm run build`
- Type checking passes: `npx tsc --noEmit`
- Lint passes: `npm run lint`
- Tests pass: `npm test` (excluding integration)
- `grep -r "bg-cosmic" src/` returns no results
- `grep -r "text-purple-" src/` returns no results (all purple replaced with tokens)

#### Manual Verification:

- All app pages render with light theme — no dark cosmic backgrounds remain
- Auth pages (sign in, sign up, confirm email) look clean with green brand colors
- Dashboard uses token-based styling
- Board pages (list, detail, settings, impact, threads, activity) all use light theme
- Profile settings page uses light theme
- Topbar has green brand accents on white background
- Impact view charts and tables are readable on light background
- No visual regressions — all interactive components (forms, dropdowns, dialogs) still work

**Implementation Note**: This is the largest phase. Consider implementing it in sub-batches: auth pages first, then dashboard + board pages, then React components. After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful.

---

## Testing Strategy

### Unit Tests:

- `homepage-stats.ts`: test that `getHomepageStats` returns correct shape, handles empty tables (zero counts), handles query failures gracefully
- Stats API endpoint: test KV cache hit/miss behavior, TTL setting, fallback on service failure

### Integration Tests:

- Stats endpoint returns correct counts from a seeded local Supabase
- High-impact percentage calculation is correct with known classification data

### Manual Testing Steps:

1. Visit homepage as unauthenticated user — verify full layout, branding, stats
2. Visit homepage as authenticated user — verify redirect to dashboard
3. Test homepage with Supabase down — verify graceful degradation (zeros)
4. Check favicon in browser tab
5. Navigate through all app pages after Phase 4 — verify light theme consistency
6. Test on mobile viewport — verify no broken layouts

## Performance Considerations

- KV cache (1h TTL) ensures the homepage never blocks on a database query for repeat visitors
- Stats queries are simple COUNTs — fast even on large tables
- No client-side JavaScript on the homepage (pure Astro SSR) — minimal JS payload
- Logo and favicon are static assets — served by Cloudflare's asset binding with edge caching

## Migration Notes

- `Welcome.astro` can be deleted after Phase 0 (no longer imported)
- `Topbar.astro` stays through Phase 3 (used by app pages); restyled in Phase 4
- The `bg-cosmic` utility in `global.css` is removed last (Phase 4, step 8) after all consumers are migrated
- KV namespace must be created in the Cloudflare dashboard or via `wrangler` CLI before deploying Phase 2

## References

- Frame brief: `context/changes/homepage/frame.md`
- Design assets: `context/changes/homepage/design/logo_gitgud.png`, `context/changes/homepage/design/palette.html`
- Current homepage: `src/pages/index.astro`, `src/components/Welcome.astro`
- Token system: `src/styles/global.css:6-73`
- Layout: `src/layouts/Layout.astro`
- Service-role client: `src/lib/supabase-admin.ts:6`
- Cloudflare config: `wrangler.jsonc`
- Env types: `src/env.d.ts:9-18`
- PRD value prop: `context/foundation/prd.md` §Vision & Problem Statement
- PRD personas: `context/foundation/prd.md` §User & Persona
- PRD guardrails: `context/foundation/prd.md` §Guardrails

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 0: Homepage Visual Design

#### Automated

- [x] 0.1 Build succeeds: `npm run build` — 2393a0d
- [x] 0.2 Type checking passes: `npx tsc --noEmit` — 2393a0d
- [x] 0.3 Lint passes: `npm run lint` — 2393a0d

#### Manual

- [x] 0.4 Homepage renders with light green background, branded nav, hero, features, stats placeholder, and CTAs — 9c6a2f6
- [x] 0.5 Sign In / Sign Up links navigate to correct auth pages — 9c6a2f6
- [x] 0.6 Authenticated users still redirect to `/dashboard` — 9c6a2f6
- [x] 0.7 Page looks reasonable on mobile viewports — 9c6a2f6
- [x] 0.8 Logo displays correctly in the nav — 9c6a2f6

### Phase 1: Brand Tokens & Favicon

#### Automated

- [x] 1.1 Build succeeds: `npm run build` — 9c6a2f6
- [x] 1.2 Type checking passes: `npx tsc --noEmit` — 9c6a2f6
- [x] 1.3 Lint passes: `npm run lint` — 9c6a2f6

#### Manual

- [x] 1.4 Browser tab shows new favicon (white cat in green circle) — 9c6a2f6
- [x] 1.5 Homepage uses green primary color for CTAs and accents — 9c6a2f6
- [x] 1.6 shadcn/ui components pick up green primary automatically — 9c6a2f6
- [x] 1.7 Page title reads "GitGud" in browser tab — 9c6a2f6

### Phase 2: Stats Data Pipeline

#### Automated

- [x] 2.1 Build succeeds: `npm run build` — 69ac70f
- [x] 2.2 Type checking passes: `npx tsc --noEmit` — 69ac70f
- [x] 2.3 Lint passes: `npm run lint` — 69ac70f

#### Manual

- [x] 2.4 `curl localhost:4321/api/stats` returns JSON with correct fields — 69ac70f
- [x] 2.5 Second request within 1h returns cached data — 69ac70f
- [x] 2.6 Stats reflect actual table counts with local Supabase — 69ac70f

### Phase 3: Stats Integration & Polish

#### Automated

- [x] 3.1 Build succeeds: `npm run build`
- [x] 3.2 Type checking passes: `npx tsc --noEmit`
- [x] 3.3 Lint passes: `npm run lint`

#### Manual

- [x] 3.4 Homepage stats section shows live data from database
- [x] 3.5 With Supabase stopped, homepage renders with "0" values
- [x] 3.6 Stats update after KV cache expires

### Phase 4: App-Wide Brand Color Migration

#### Automated

- [ ] 4.1 Build succeeds: `npm run build`
- [ ] 4.2 Type checking passes: `npx tsc --noEmit`
- [ ] 4.3 Lint passes: `npm run lint`
- [ ] 4.4 Tests pass: `npm test` (excluding integration)
- [ ] 4.5 No `bg-cosmic` references in `src/`
- [ ] 4.6 No `text-purple-` references in `src/`

#### Manual

- [ ] 4.7 All app pages render with light theme
- [ ] 4.8 Auth pages look clean with green brand colors
- [ ] 4.9 Board pages use light theme consistently
- [ ] 4.10 Impact view charts and tables readable on light background
- [ ] 4.11 No visual regressions in interactive components
