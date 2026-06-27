# GitGud Public Homepage — Plan Brief

> Full plan: `context/changes/homepage/plan.md`
> Frame brief: `context/changes/homepage/frame.md`

## What & Why

The current homepage is a generic "10x Astro Starter" placeholder with a dark cosmic theme — it says nothing about GitGud. We need a branded landing page that communicates the product's value proposition (surfacing invisible engineering contributions), shows live usage stats, and sets the visual precedent for an app-wide light theme migration.

## Starting Point

The homepage (`src/components/Welcome.astro`) renders a dark purple-gradient page with generic text and three placeholder feature cards. The shadcn/ui token system exists in `global.css` with oklch values but uses neutral gray for `--primary`. A service-role Supabase client exists but no stats aggregation or caching infrastructure. All DB tables block anonymous access via `REVOKE ALL`.

## Desired End State

Visitors see a clean, light-themed GitGud homepage with branded navigation (logo + auth links), a value proposition hero, feature explanation cards, and a live stats bar showing boards, contributors, repos, and high-impact review percentage. Stats are cached in Cloudflare KV (1h TTL). All existing app pages (dashboard, boards, auth, profile) use the new green brand palette instead of the cosmic dark theme.

## Key Decisions Made

| Decision         | Choice                           | Why (1 sentence)                                                                                          | Source |
| ---------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------- | ------ |
| Stats caching    | Cloudflare KV, 1h TTL            | Globally consistent cache across edge isolates with zero extra infra beyond a KV namespace.               | Plan   |
| Stats scope      | Counts + % high-impact           | The percentage tells the GitGud story — proves the tool finds invisible contributions.                    | Plan   |
| Zero/error state | Show stats section with zeros    | Consistent layout regardless of data state; signals what the product tracks even when empty.              | Plan   |
| Topbar treatment | Homepage-specific nav            | Current Topbar is dark-themed and coupled to cosmic layout; separate component avoids premature refactor. | Plan   |
| Favicon          | White cat icon in green circle   | Manual crop for clarity at 32x32; full logo with wordmark would be illegible.                             | Plan   |
| Theme approach   | Wire into shadcn/ui oklch tokens | Sets the right precedent for app-wide migration — no ad-hoc classes.                                      | Frame  |
| Stats pipeline   | Server-side service-role queries | Anon DB access is fully blocked; no alternative to service-role for public stats.                         | Frame  |

## Scope

**In scope:**

- Branded homepage (nav, hero, features, stats, CTAs)
- Green brand palette wired into shadcn/ui tokens
- Custom favicon (cat icon in green circle)
- Cloudflare KV stats cache with 1h TTL
- Stats API endpoint (`/api/stats`)
- App-wide migration from cosmic dark to light brand tokens

**Out of scope:**

- Dark/light mode toggle
- SEO/meta tags beyond title
- Real-time stats (WebSocket)
- Mobile-first responsive redesign of app pages
- Homepage animations/transitions

## Architecture / Approach

The homepage is a pure Astro SSR page (no client JS). Stats are served by a new `/api/stats` endpoint that reads from Cloudflare KV; on cache miss, it queries Supabase with the service-role key, writes to KV with 1h TTL, and returns JSON. The homepage fetches this endpoint server-side at render time. Brand colors are wired into the existing shadcn/ui oklch token system (`--primary` → green-500), which all token-based components inherit automatically.

## Phases at a Glance

| Phase                     | What it delivers                                              | Key risk                                                      |
| ------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------- |
| 0. Homepage Visual Design | Static homepage with all sections, layout, placeholder stats  | Content/copy quality — derived from PRD, not a copywriter     |
| 1. Brand Tokens & Favicon | Green primary in token system, custom favicon, "GitGud" title | oklch color conversion accuracy                               |
| 2. Stats Data Pipeline    | KV namespace, stats service, `/api/stats` endpoint            | KV binding wiring across wrangler + env types + Astro adapter |
| 3. Stats Integration      | Live stats on homepage, zero/error handling                   | Internal SSR fetch to API endpoint — routing correctness      |
| 4. App Recolor            | All ~30 files migrated from cosmic dark to light tokens       | Scale — many files to touch; visual regression risk           |

**Prerequisites:** Cloudflare account with KV access, local Supabase for testing stats, design assets in `context/changes/homepage/design/`
**Estimated effort:** ~3-4 sessions across 5 phases

## Open Risks & Assumptions

- Phase 4 touches ~30+ files — visual regression risk is high; each sub-batch needs manual review
- KV namespace creation requires Cloudflare dashboard or CLI access with appropriate permissions
- High-impact classification categories (`architectural`, `mentoring`, `bug-fix`, `knowledge-sharing`) assumed from classification service — verify against actual category values
- `Astro.locals.runtime.env` access pattern for KV binding assumed from Cloudflare adapter docs — verify at implementation time

## Success Criteria (Summary)

- Unauthenticated visitors see a branded GitGud homepage with live stats and clear CTAs
- All app pages use the light green brand palette — no dark cosmic theme remnants
- Stats load from KV cache within 1h freshness, gracefully degrade to zeros on failure
