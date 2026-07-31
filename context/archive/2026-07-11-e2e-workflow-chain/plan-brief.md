# E2E Workflow Chain — Plan Brief

> Full plan: `context/changes/e2e-workflow-chain/plan.md`
> Research: `context/changes/e2e-workflow-chain/research.md`

## What & Why

Write a Playwright E2E test proving the full manual sync trigger → data appears flow, covering Risk R1 (workflow chain breaks silently). Existing hermetic tests cover individual sync functions in isolation but explicitly not chain-level orchestration — this E2E test closes that gap by exercising the complete dispatch → sync-repo → orchestrate → prdetails + reviews → classify chain from a browser click to visible KPI metrics.

## Starting Point

Playwright is installed with one seed spec (`seed.spec.ts`) and auth setup. The sync chain is a multi-phase Cloudflare Workflow in `src/worker.ts` with fire-and-forget child spawning. The `SyncIndicator` component triggers sync and polls for completion. No mechanism exists to override the GitHub API base URL for testing — Octokit defaults to `api.github.com`.

## Desired End State

A `sync-chain.spec.ts` test that pre-seeds a board, navigates to the impact dashboard, clicks sync, waits for completion, and asserts KPI cards show non-zero values. Runs locally against `astro dev` (started with `CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH=./wrangler.e2e.jsonc`) with a mock GitHub API server and mocked AI binding. Runs in CI via a dedicated `test-e2e` job.

## Key Decisions Made

| Decision                 | Choice                                               | Why (1 sentence)                                                                                                                                                                                                                                       | Source   |
| ------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| Runtime environment      | `astro dev` + `CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH` | Astro 6/`@astrojs/cloudflare` v13 already run `astro dev` on real `workerd` with full Workflow support (proven by `pat-leak.test.ts`); raw `wrangler dev` cannot bundle this project's custom `src/worker.ts` entrypoint at all — confirmed unfixable. | Research |
| GitHub data source       | Local HTTP mock server                               | Server-side GitHub calls (Octokit in Worker) can't be intercepted by page.route(); a mock HTTP server is needed.                                                                                                                                       | Plan     |
| Verification surface     | Impact dashboard KPI metrics                         | Proves data flows all the way from sync through to computed metrics in the UI.                                                                                                                                                                         | Plan     |
| Classification inclusion | Include with AI binding mock                         | Complete R1 coverage requires the full chain including classify phases.                                                                                                                                                                                | Plan     |
| Board setup              | Pre-seed via Supabase admin                          | Faster and independent of wizard UI; avoids coupling to seed.spec.ts.                                                                                                                                                                                  | Plan     |
| CI approach              | New dedicated test-e2e job                           | Clean separation from existing validate/integration jobs; the E2E runtime config needs its own setup.                                                                                                                                                  | Plan     |
| Sync timeout             | 60s with 2s polling                                  | Tighter than production's 120s; mocked data should complete in 10-20s.                                                                                                                                                                                 | Plan     |

## Scope

**In scope:**

- `GITHUB_API_BASE_URL` env var override in Octokit
- Local GitHub mock server (fixture PRs, reviews, comments)
- AI binding mock (`mock-ai.ts` + `AI_MOCK` flag)
- Playwright config selecting the E2E wrangler config on `astro dev`
- Supabase admin seed helper for E2E
- `sync-chain.spec.ts` E2E test
- CI `test-e2e` job
- `npm run test:e2e` convenience script

**Out of scope:**

- Mid-chain failure recovery testing (Phase 6 hermetic)
- Daily cron trigger testing
- Visual regression / screenshots
- Board creation wizard E2E (seed.spec.ts)
- Classification accuracy (hermetic tests)
- Deployed Cloudflare preview testing

## Architecture / Approach

Three-layer mock stack: (1) a local HTTP server returning fixture GitHub API responses, pointed at by `GITHUB_API_BASE_URL` env var; (2) a mocked AI binding returning deterministic classification labels, enabled via `AI_MOCK`; (3) Playwright driving the browser against `astro dev`, selecting both vars via `CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH=./wrangler.e2e.jsonc`. The test seeds Supabase directly via admin client, triggers sync via the UI, and asserts KPI card values on the impact dashboard.

## Phases at a Glance

| Phase                           | What it delivers                                                                                           | Key risk                                                                                                                                                     |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Mock Infrastructure          | GitHub API base URL override, mock HTTP server, AI binding mock, E2E wrangler config, astro-dev boot-check | E2E-only config must reach `astro dev` without leaking into normal `npm run dev` — solved via `CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH`, not a separate process |
| 2. E2E Test + Playwright Config | Updated Playwright webServer, Supabase seed helper, sync-chain.spec.ts                                     | KPI card values depend on fixture data shape producing non-trivial metrics                                                                                   |
| 3. CI Integration               | New test-e2e GitHub Actions job, npm script                                                                | `astro dev`'s declared `ai` binding may still need `CLOUDFLARE_API_TOKEN` even with `AI_MOCK` set; cold-start latency                                        |

**Prerequisites:** Local Supabase running, wrangler CLI installed, Playwright browsers installed
**Estimated effort:** ~2 sessions across 3 phases

## Open Risks & Assumptions

- Fixture data must produce non-trivial impact metrics — if the metrics service requires specific data shapes (e.g., merged PRs for "Time to merge"), fixtures need to match
- CI likely still requires `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` for `astro dev` to boot cleanly, even though `AI_MOCK` means the `ai` binding is never actually called — mirrors existing `pat-leak.test.ts` CI wiring; confirm during Phase 3 planning
- Whether `wrangler deploy` (production) resolves `src/worker.ts`'s Astro virtual-module imports differently than `wrangler dev`'s dev-mode bundling is unconfirmed — not blocking for this change, but worth a sanity check before assuming deploys are unaffected (see research.md Open Questions)

## Success Criteria (Summary)

- `npx playwright test sync-chain` passes: sync trigger → KPI metrics appear with non-zero values
- CI `test-e2e` job passes on a PR branch without affecting existing jobs
- The test completes in under 60s (sync portion) with mocked data
