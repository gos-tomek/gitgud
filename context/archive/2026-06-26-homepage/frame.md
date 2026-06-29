# Frame Brief: GitGud Public Homepage

> Framing step before /10x-plan. This document captures what is _actually_
> at issue, separated from what was initially assumed.

## Reported Observation

The current homepage (`src/pages/index.astro`) is a generic "10x Astro Starter"
landing page with a dark cosmic theme. It says nothing about GitGud, has no
branding, and shows no product-specific content or usage statistics. Unauthenticated
visitors see a placeholder page that conveys nothing about the product's purpose.

## Initial Framing (preserved)

- **User's stated cause or approach**: Replace with a proper GitGud homepage — light palette, branded logo in `#22c55e`, favicon (icon only), feature/value explanation, and live usage statistics (boards, threads, % high impact, contributors, repos).
- **User's proposed direction**: Build the homepage using design assets in `context/changes/homepage/design/` (logo + palette), add stats, generate a favicon from the logo's cat icon.
- **Pre-dispatch narrowing**: Branding and stats are equally important (neither is optional). Light theme will eventually migrate app-wide — homepage sets the precedent. Stats should be cached/periodic, not real-time per request.

## Dimension Map

The observation (generic starter page with no identity or data) spans four dimensions:

1. **Visual identity & design system** — No GitGud branding in the app; light palette has no Tailwind tokens; logo/favicon aren't wired up
2. **Content strategy** — What to say about GitGud (value prop, features, personas) needs to be derived from the PRD — no homepage spec exists
3. **Stats data pipeline** — Aggregating counts requires service-role queries + caching layer; anon is fully blocked on all tables ← _potentially underestimated scope_
4. **Theme migration precedent** — If light mode extends app-wide, the homepage approach (token system vs ad-hoc classes) sets the design system pattern

## Hypothesis Investigation

| Hypothesis                | Evidence                                                                                                                                                                                                                                                                                                                                                                                   | Verdict  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| Visual identity gap       | shadcn/ui tokens in `global.css:6-73` are all neutral gray — no brand colors. Dark mode infra exists (class-based `.dark` variant, line 4) but isn't activated. Current favicon is generic. Logo provided in `context/changes/homepage/design/logo_gitgud.png` (cat head + wordmark).                                                                                                      | STRONG   |
| Content strategy gap      | PRD (`context/foundation/prd.md`) has zero mentions of "homepage" / "landing page" / "public page". Value prop is clear: surface invisible contributions (mentoring, reviews, architecture). Personas: Marek (IC), Marta (EM). Guardrails: no ranking, IC/EM see same data.                                                                                                                | STRONG   |
| Stats pipeline complexity | `REVOKE ALL FROM anon` on all tables (`20260614120000_revoke_all_hardening.sql:10-15`). Service-role client exists (`src/lib/supabase-admin.ts:6`). No caching/stats infra in `src/lib/` or `src/pages/api/`. Tables for boards, board_contributors, github_repos, thread_classifications, github_pull_requests all exist. Needs: new API endpoint + service-role key + caching mechanism. | STRONG   |
| Theme precedent           | oklch token system ready in `global.css`. Class-based dark variant defined (`@custom-variant dark`, line 4). `Layout.astro` uses `bg-background text-foreground` base tokens. Homepage light theme should map palette colors into this token system, not use ad-hoc Tailwind classes.                                                                                                      | MODERATE |

## Narrowing Signals

- Stats and branding confirmed as equally important — neither can be deferred.
- Cached/periodic stats preferred — avoids unauthenticated DB traffic on every page load.
- Light theme migration to remaining app views is planned as a future phase — homepage is the first step. This means the theme approach chosen here will be replicated.

## Cross-System Convention

Astro SSR apps typically handle public stats via a server-side query at render time (using a service-role or admin client), optionally cached via HTTP cache headers or a short-TTL KV/memory cache. The existing `createServiceClient` in `supabase-admin.ts` fits this pattern. No convention conflict.

For branding, the shadcn/ui token system (`--primary`, `--accent`, etc.) is the standard place to wire in brand colors. The palette colors from the design assets are stock Tailwind values (`green-500 = #22c55e`, etc.) and map directly.

## Reframed (or Confirmed) Problem Statement

> **The actual problem to plan around is**: Build a GitGud-branded public homepage with two equally important concerns — visual identity (light theme, branding, favicon) and a stats data pipeline (server-side aggregation with caching, since anon DB access is fully blocked).

The initial framing was correct in intent. The refinement is that the stats section is not a "nice decoration" but a real data pipeline task: it requires a new server-side API endpoint using the service-role key, a caching strategy (to avoid hitting the DB on every unauthenticated page load), and aggregate queries across 5+ tables. The theme work should go through the existing shadcn/ui token system to set the right precedent for the planned app-wide light mode migration.

## Confidence

- **HIGH** — strong evidence across all dimensions; no conflicting signals; the user's framing is correct with scope clarification on stats pipeline

## What Changes for /10x-plan

The plan should treat the stats data pipeline as a distinct phase (not a UI subtask) — it involves a new API endpoint, service-role queries, and a caching strategy. The theme/branding phase should wire colors into the existing shadcn/ui token system (not ad-hoc classes) since this approach will be replicated app-wide. Content should be derived from the PRD's value proposition and persona definitions, since no homepage spec exists.

## References

- Design assets: `context/changes/homepage/design/logo_gitgud.png`, `context/changes/homepage/design/palette.html`
- Current homepage: `src/pages/index.astro:1-13`, `src/components/Welcome.astro:1-127`
- Token system: `src/styles/global.css:6-73`
- Layout: `src/layouts/Layout.astro`
- Service-role client: `src/lib/supabase-admin.ts:6`
- RLS hardening: `supabase/migrations/20260614120000_revoke_all_hardening.sql:10-15`
- PRD value prop: `context/foundation/prd.md` §Vision & Problem Statement
- PRD personas: `context/foundation/prd.md` §User & Persona
- PRD guardrails: `context/foundation/prd.md` §Guardrails
