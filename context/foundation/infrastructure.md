---
project: GitGud
researched_at: 2026-05-24
recommended_platform: Cloudflare Workers
runner_up: Netlify
context_type: mvp
tech_stack:
  language: TypeScript / JavaScript
  framework: Astro 6 SSR (React 19 islands, Tailwind 4, shadcn/ui)
  runtime: Cloudflare Workers (workerd)
---

## Recommendation

**Deploy on Cloudflare Workers.**

The project is already configured with the `@astrojs/cloudflare` adapter and `output: "server"`, so Cloudflare is the only candidate with **zero migration cost** — every alternative requires swapping the Astro adapter. It is also the cheapest viable option: the entire app, including the daily GitHub-sync + AI-classification batch, runs on the **free Workers plan** (free Cron Triggers + free Workflows), because the classification work is network-bound and per-step CPU stays well under the free 10ms limit. The $5/mo paid plan is optional headroom, not a requirement. Cloudflare also scored a clean 5/5 on the agent-friendly criteria, with the strongest agent-readable docs (`llms.txt`) and the most mature MCP integration. Cost-minimization (the developer's top stated priority) and "no existing platform familiarity" both point here.

## Platform Comparison

### Scoring matrix (five agent-friendly criteria)

| Platform | CLI-first | Managed/Serverless | Agent-readable docs | Stable deploy API | MCP / Integration | Raw score |
|---|---|---|---|---|---|---|
| **Cloudflare** | Pass | Pass | Pass | Pass | Pass | 5 / 5 |
| **Netlify** | Pass | Pass | Pass | Pass | Pass | 5 / 5 |
| **Railway** | Pass | Pass | Pass | Pass | Pass | 5 / 5 |
| **Vercel** | Pass | Pass | Pass | Pass | Partial | 4.5 |
| **Render** | Pass | Pass | Pass | Pass | Partial | 4.5 |
| **Fly.io** | Pass | Partial | Pass | Pass | Partial | 4 |

Notes per platform:

- **Cloudflare** — `wrangler` covers deploy/rollback/logs/secrets. Fully serverless edge (no OS surface). Docs publish `llms.txt`/`llms-full.txt` + per-page markdown. `wrangler deploy` is deterministic with versioned rollback. Mature managed MCP servers (OAuth, "Code Mode") plus a Claude Code Cloudflare Skills plugin. The one soft spot is the **10ms CPU/request** cap on the free tier and the fact that the daily batch must be built as a **Cloudflare Workflow** rather than a plain request.
- **Netlify** — 5/5, **official GA MCP server**, free tier genuinely viable (125k function invocations/mo). Daily sync runs via a scheduled function (hourly min, free) chained to a **background function** (15-min cap, free). Cost to adopt: swap to `@astrojs/netlify`. Strongest runner-up.
- **Railway** — Fully managed (Railpack autodetect, no Dockerfile), GA native cron, GA first-party MCP. Dropped for **cost**: ~$5–10/mo always-on conflicts with the cost-minimization priority more than the alternatives.
- **Vercel** — Strong tech and tooling, but the **free Hobby tier is non-commercial only**; GitGud is a commercial product, forcing **Pro at $20/mo**. MCP is public beta. Eliminated on cost.
- **Render** — Free web tier **spins down after 15 min** with a **~1-minute cold start** (poor first-visitor UX), and **cron is a separate paid service** (≥$1/mo), so the "free" story breaks once the sync ships. MCP is early access.
- **Fly.io** — The persistent-process model runs the batch in-process with **no time limit** and is cheap (~$1–3/mo), but you **own the Dockerfile** (lowers the "managed" score), MCP is experimental, and it requires an `@astrojs/node` adapter swap.

### Shortlisted Platforms

#### 1. Cloudflare Workers (Recommended)

Zero migration (adapter already installed), $0-to-start on the free tier including the batch, best-in-class agent docs and MCP, and a clean serverless operational surface. The daily batch — the developer's main concern — is well-served by free **Cron Triggers + Workflows** (durable execution, retries), provided it's built as a Workflow from day one rather than crammed into a single request.

#### 2. Netlify

Also 5/5 and **$0/mo viable**, with an official **GA MCP server**. The daily sync works via a scheduled→background-function chain, but each run is **capped at 15 minutes**, so a large org sync must chunk across runs. Chosen as runner-up over Fly because it stays fully serverless/managed and free. Adoption cost: adapter swap to `@astrojs/netlify`.

#### 3. Fly.io

The persistent-process escape hatch that most directly matches the "run a sync once a day and store it in the DB" mental model — **no per-request time limit**, batch runs in-process, cheapest always-on (~$1–3/mo with auto-stop). Ranked third because you take on **Dockerfile ownership** and an `@astrojs/node` adapter swap, and the agent tooling (MCP) is experimental.

## Anti-Bias Cross-Check: Cloudflare Workers

### Devil's Advocate — Weaknesses

1. **The daily sync does not fit the Workers request model.** Even on the paid plan (5-min CPU cap), syncing a real GitHub org (hundreds of PRs) plus per-comment AI calls exceeds it. You're pushed into **Cloudflare Workflows** — a second programming model (durable steps, idempotency, retries) to learn on top of Workers.
2. **workerd is not Node.** `nodejs_compat` covers most cases, but the GitHub client (Octokit), pagination/retry libs, or stream-heavy code can break *only in production, never locally* — a classic time sink.
3. **KV-backed sessions are eventually consistent (~60s cross-region).** Cookie auth works, but you can get sporadic, hard-to-reproduce "logged out" reports that never surface in single-region local dev.
4. **The "cloudflare-pages" label in `tech-stack.md` is now wrong.** The current `@astrojs/cloudflare` adapter deploys to **Workers** via `wrangler deploy`; `wrangler pages deploy` is legacy and unsupported by the adapter. Stale config or muscle-memory misfires on the first deploy.
5. **The "simple daily sync" becomes the most architecturally involved part of the whole app** on this platform — the opposite of where a cost-minimizing solo dev wants to spend complexity budget.

### Pre-Mortem — How This Could Fail

The web app shipped fine — SSR pages, Supabase auth, and shadcn all worked on Workers. The disaster was the sync. The pilot org had 1,200 PRs and 8,000 review comments; the daily job needed to page the GitHub API and then make thousands of Anthropic classification calls. The first naive version was a Worker behind a Cron Trigger — it hit the 5-minute CPU wall and died half-done, leaving partial data and no clean retry. The dev rewrote it as a Cloudflare Workflow, learning durable-execution semantics (steps, idempotency, `waitForEvent`) under deadline pressure — two weekends gone. Then intermittent workerd compatibility issues with Octokit pagination surfaced, reproducible only in production. KV-backed session eventual-consistency caused sporadic "logged out" reports impossible to reproduce locally. By month six the dev concluded the batch belonged on a boring always-on Node box where it could just run, and regretted optimizing the *web tier's* hosting when the *batch* was the actual hard part.

### Unknown Unknowns

- The `@astrojs/cloudflare` adapter **dropped Pages support**; `output: "server"` SSR now deploys to **Workers** via `wrangler deploy`, despite what `tech-stack.md` says.
- The free plan's **10ms CPU/request** is a *hard failure*, not a slowdown: a page whose server-render exceeds 10ms of actual compute will error. Network waits (Supabase, GitHub, Anthropic) do **not** count, so the batch is safe — but heavy React 19 SSR pages might not be. The realistic floor may be the **$5/mo** plan for the web tier.
- The free plan's **100k requests/day** ceiling is shared across web traffic and every Workflow step instance; a large sync combined with traffic could throttle.
- The KV session namespace is **auto-provisioned and eventually consistent** — auth can feel flaky in ways single-region local dev hides.
- Worker **script-size limits** can bite a large React 19 + dependency bundle, forcing code-splitting.
- **The real cost driver is AI token spend, not hosting.** Classifying thousands of comments per org sync dwarfs the $0–5/mo hosting bill on *any* platform and scales with comment volume — the platform choice barely moves the total.

## Operational Story

- **Preview deploys**: Connect the repo to **Workers Builds** for per-branch/PR preview deployments, or upload a non-production version with `wrangler versions upload` (returns a preview URL). Production publish is `wrangler deploy`. Preview URLs are public by default — gate them with **Cloudflare Access** if previews shouldn't be open.
- **Secrets**: `SUPABASE_URL` and `SUPABASE_KEY` live in **Workers Secrets** (`wrangler secret put <NAME>`, encrypted at rest) for runtime, and as **GitHub Actions repository secrets** for the CI build step. Read in code via `astro:env/server`. Rotation = re-run `wrangler secret put`. Never commit them; `.dev.vars` (gitignored) holds them for local dev.
- **Rollback**: `wrangler rollback [version-id]` reverts to a prior deployed version near-instantly. Caveat: this rolls back **only the Worker** — Supabase schema migrations do *not* roll back with it, so coordinate DB migrations carefully.
- **Approval**: Production publish (`wrangler deploy`), primary-secret rotation, and any Supabase database drop/alter are **human-only** by hand. An agent may run builds, `wrangler tail` logs, and preview/version uploads unattended.
- **Logs**: `wrangler tail` streams live runtime logs (web requests, Cron runs, Workflow steps). Workers Observability/Logs in the dashboard and the Workflows instances view give historical/structured access; the Cloudflare MCP server exposes these as structured tools when CLI parsing gets tedious.

## Risk Register

| Risk | Source | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Free-tier 10ms CPU/request cap errors a heavy SSR page (hard failure) | Devil's advocate / Unknown unknowns | M | M | Watch CPU via `wrangler tail`; keep heavy work out of the request path; upgrade to $5 paid (up to 5-min CPU) if a page hits the wall |
| Daily batch exceeds the Workers request model; requires Workflows | Devil's advocate / Pre-mortem | H | M | Build the batch as a Cloudflare Workflow from day one — idempotent durable steps, retries; chunk GitHub pagination + per-comment classification into steps |
| workerd ≠ Node compatibility edges (Octokit, streams) surface only in prod | Devil's advocate / Pre-mortem | M | M | Set `nodejs_compat`; test the GitHub client on workerd early; prefer fetch-based clients; let CI build catch regressions |
| KV-backed session eventual consistency (~60s) causes flaky auth | Devil's advocate / Unknown unknowns | L | M | Accept eventual consistency for sessions; never store strong-consistency state in KV; test auth across regions |
| `tech-stack.md` says "cloudflare-pages" but the adapter targets Workers → wrong first deploy command | Unknown unknowns / Research finding | M | L | Use `wrangler deploy`, not `wrangler pages deploy`; correct the `deployment_target` label in `tech-stack.md` |
| Free 100k req/day ceiling throttles a large sync + traffic | Research finding | L | M | Monitor request volume; $5 paid removes the daily ceiling (10M/mo included) |
| Worker script-size limit vs large React 19 bundle | Unknown unknowns | L | M | Code-split, keep dependencies lean, watch bundle size at build time |
| AI classification token spend dwarfs hosting cost | Unknown unknowns / Research finding | H | H | Use a cheap classification model (e.g. Haiku); store results to avoid re-classifying; dedupe; set API spend alerts |

## Getting Started

These commands are validated against the stack's pinned versions (`@astrojs/cloudflare` on Astro 6, `output: "server"`), not generic platform docs.

1. **Adapter is already correct** — confirm `astro.config.mjs` uses `@astrojs/cloudflare` with `output: "server"`. No adapter change needed (this is Cloudflare's zero-migration edge).
2. **Set compatibility config** in `wrangler.jsonc` / `wrangler.toml`: `compatibility_date` ≥ `2024-09-23` and `compatibility_flags = ["nodejs_compat"]` (required for the Supabase SSR client and Node-style libs on workerd).
3. **Authenticate**: `npx wrangler login`.
4. **Set runtime secrets**: `npx wrangler secret put SUPABASE_URL` then `npx wrangler secret put SUPABASE_KEY`.
5. **Build and deploy**: `npm run build` then `npx wrangler deploy`. Do **not** use `wrangler pages deploy` — the adapter no longer supports Pages.
6. **Local dev needs no platform-native command** — `npm run dev` already runs on the Cloudflare **workerd** runtime, so it gives production fidelity without a separate `wrangler dev` step.
7. **Scaffold the batch** as a Cloudflare **Workflow** triggered by a free **Cron Trigger** (daily). Keep steps small and idempotent so partial failures retry cleanly. Start on the free plan; upgrade to $5/mo only if the web tier hits the 10ms CPU cap.

## Out of Scope

The following were not evaluated in this research:
- Docker image configuration
- CI/CD pipeline setup (a GitHub Actions workflow already exists; pipeline design was not part of this decision)
- Production-scale architecture (multi-region, HA, DR)
