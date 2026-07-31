---
date: 2026-07-30T17:30:54+02:00
researcher: Claude
git_commit: 06179e105e1428c03fff232a0800b6bee8716893
branch: GitGud-e2e
repository: gitgud
topic: "wrangler dev fails for the E2E sync-chain runner — astro dev is the right local runtime"
tags: [research, codebase, e2e-workflow-chain, wrangler, astro-dev, cloudflare-workflows, playwright]
status: complete
last_updated: 2026-07-30
last_updated_by: Claude
---

# Research: wrangler dev fails for the E2E sync-chain runner — astro dev is the right local runtime

**Date**: 2026-07-30T17:30:54+02:00
**Researcher**: Claude
**Git Commit**: 06179e105e1428c03fff232a0800b6bee8716893
**Branch**: GitGud-e2e
**Repository**: gitgud

## Research Question

During Phase 1 manual verification of `context/changes/e2e-workflow-chain/plan.md`, running `wrangler dev --config wrangler.e2e.jsonc` failed to even bundle `src/worker.ts`. The plan's premise (`plan.md:9`, `plan-brief.md:21`) is that `astro dev`/`npm run dev` "does not support Cloudflare Workflows," which is why a separate `wrangler dev` process was designed as the E2E runner in Phase 1 item 7 and Phase 2's Playwright `webServer` config. Is that premise correct? If not, what should replace `wrangler dev` as the delivery mechanism for the E2E-only config (`GITHUB_API_BASE_URL`, `AI_MOCK`) that Phase 1 already built?

## Summary

**The plan's premise is wrong.** `astro dev` in this project (Astro 6.3.7 + `@astrojs/cloudflare` 13.5.4) already runs on the real Cloudflare `workerd` runtime via the Cloudflare Vite plugin, with full binding support — Workflows included. This isn't a claim from generic docs; it's proven in this exact codebase: `tests/integration/pat-leak.test.ts` already spawns plain `npx astro dev` and successfully dispatches the real `ClassificationBatchWorkflow`, decrypts a PAT, and drives it through a live GitHub API call. `playwright.config.ts`'s existing `webServer` for the whole `tests/e2e/*.spec.ts` suite already runs `npm run dev` (= `astro dev`) on port 4321.

Separately, raw `wrangler dev` against this project's custom `src/worker.ts` entrypoint is **fundamentally broken and not fixable** via wrangler's suggested `alias` bundling workaround — the entrypoint pulls in Astro/Vite virtual modules (`astro:env/server`, `virtual:astro:app` → `virtual:astro:manifest`/`virtual:astro:fetchable`, `astro:static-paths`) that only exist inside Astro's own Vite build graph, not as real files wrangler's esbuild could alias to. Even Astro's own "unified" `@astrojs/cloudflare/entrypoints/server` — the officially documented `main` value for Astro 6 — resolves to the exact same virtual-module-laden `handler.js`, confirming this path was never meant to be bundled by plain wrangler at all.

**The fix**: keep `wrangler.e2e.jsonc` exactly as Phase 1 built it (it still correctly holds the `GITHUB_API_BASE_URL` and `AI_MOCK` vars), but stop trying to launch it via `wrangler dev --config`. Instead, launch `astro dev` with `CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH=./wrangler.e2e.jsonc` set in the spawned process's environment — the Cloudflare Vite plugin reads this env var to pick which wrangler config file (and therefore which `vars` block) to load for the dev server, exactly mirroring what `wrangler dev --config` does for a bare wrangler run. No astro.config.mjs change, no CLI flag, no `.dev.vars` renaming. Normal `npm run dev` is completely unaffected since the var is simply absent then and `wrangler.jsonc` remains the default.

## Detailed Findings

### 1. `astro dev` already is the Workers runtime in this project — and already proves Workflows work

- `astro.config.mjs:16` — `adapter: cloudflare({ imageService: "passthrough" })`, Astro 6 / adapter v13.
- Astro's own docs (Context7 `/withastro/docs`, "Upgrading to v13 and Astro 6"): _"The `astro dev` and `astro preview` commands in Astro 6 now run your site using the real Workers runtime (`workerd`) via the Cloudflare Vite plugin, instead of Node.js... enables features like Durable Objects, R2 bindings, and Workers AI to function identically to deployment."_
- `.github/workflows/ci.yml:61-65` (comment on the existing `test-integration` job): _"pat-leak.test.ts spawns a real `astro dev` server (Cloudflare Workers runtime via wrangler). That runtime reads bindings from `.dev.vars`, not from `process.env`..."_
- `.github/workflows/ci.yml:73-75`: confirms the `astro dev` server's AI binding opens a real remote Cloudflare proxy session — i.e., bindings declared in `wrangler.jsonc` (including the `CLASSIFICATION_BATCH` Workflow binding, `wrangler.jsonc:25-31`) are picked up automatically by `astro dev`.
- `tests/helpers/astro-server.ts:32` — `spawn("npx", ["astro", "dev", "--port", String(port)], ...)`, with a comment at line 116 confirming the process group includes "wrangler workers."
- `tests/integration/pat-leak.test.ts:39-98` — uses `startAstroServer` to dispatch the real Workflow chain (`create_board_atomic` → dispatch → sync-repo → PAT decrypt → GitHub call) against a live `astro dev` server, and polls server stdout for a Workflow step failure log line. This is the strongest possible proof: an already-existing, already-passing-in-CI test exercises the exact chain the current plan is trying to E2E-test, running entirely under `astro dev`.
- `playwright.config.ts:45-49` — the existing E2E suite's `webServer` already runs `command: "npm run dev"` on port 4321; `board-lifecycle.spec.ts`, `seed.spec.ts`, `contributor-management.spec.ts`, `non-owner-denied.spec.ts` all run against it today.

### 2. No prior context ever argued `astro dev` can't run Workflows

- The `test-e2e`-shaped CI job pattern and the `astro dev`-based `webServer` were established by the archived change `context/archive/2026-07-11-e2e-core-user-flows/plan.md:11,265-271` — it uses `npm run dev`, not `wrangler dev`.
- `context/archive/2026-06-09-testing-access-boundary/plan.md:214-229` is the origin of `startAstroServer`/`tests/helpers/astro-server.ts` (commit `32ecd179`), documented further in `context/foundation/test-plan.md:208-249`. That plan needed an HTTP server for log-leak capture and simply used the project's existing dev runtime (`astro dev`) — it never evaluated or rejected `astro dev` for Workflow support, because at the time (and still now) nothing suggested it couldn't do it.
- No other `context/changes/**` or `context/archive/**` file mentions `wrangler dev`, `wrangler.e2e.jsonc`, or an environment-suffixed `.dev.vars` convention. The current plan's `wrangler dev` approach appears to be a one-off assumption made when `plan.md`/`plan-brief.md` were written, not a decision that traces back to any real limitation encountered elsewhere in this codebase.

### 3. Raw `wrangler dev` against `src/worker.ts` cannot be fixed via `alias`

- Reproduced failure: `wrangler dev --config wrangler.e2e.jsonc --port 4322` fails with `Could not resolve "astro:static-paths"`, `Could not resolve "virtual:astro:app"`, `Could not resolve "astro:env/server"` (from `src/lib/github.ts:5`).
- `node_modules/@astrojs/cloudflare/dist/utils/handler.js:1-13` (the module `src/worker.ts` imports `handle` from) pulls in **three** virtual specifiers: `virtual:astro-cloudflare:config`, `astro/app/entrypoint` (→ `node_modules/astro/dist/core/app/entrypoints/virtual/index.js:1`, re-exporting `virtual:astro:app`), and `astro/env/setup`.
- `virtual:astro:app` resolves to _different_ code depending on Vite mode (`.../virtual/dev.js` with HMR listeners, vs `.../virtual/prod.js`), and both further pull in `virtual:astro:manifest`/`virtual:astro:fetchable` — none of these are real files; Astro's Vite plugin `resolveId`/`load` hooks synthesize their content per-build.
- Even the finished build has no reusable single-file target to alias to: `dist/server/chunks/worker-entry_BHGbcqyk.mjs` is 37,402 lines, hash-named (changes every build), and `astro:env/server` specifically compiles into an ad-hoc inlined block at `dist/server/chunks/server_B9U8gcpf.mjs:27947-27971` — scattered and build-specific, not aliasable.
- Astro's own docs confirm this was never the intended path: Astro 6/adapter v13's documented `main` value is the unified entrypoint `@astrojs/cloudflare/entrypoints/server` (`node_modules/@astrojs/cloudflare/dist/entrypoints/server.js` — just `export default { fetch: handle }`), which re-exports the _same_ virtual-module-laden `handler.js`. Even the "official" entrypoint is only meant to be bundled through Astro's own Vite pipeline (`astro dev`/`astro build`), never raw `wrangler dev`/esbuild.
- Cloudflare's `alias` bundling config is designed for redirecting one real package/file to another (e.g. swapping an npm dependency) — not for synthesizing framework-internal virtual-module content that doesn't exist as a stable file at all.

### 4. How to inject `GITHUB_API_BASE_URL`/`AI_MOCK` into `astro dev` for E2E only

- `@cloudflare/vite-plugin`'s `resolvePluginConfig()` (`node_modules/@cloudflare/vite-plugin/dist/index.mjs:52681`) picks the wrangler config file via `pluginConfig.configPath ?? prefixedEnv.CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH`, then `readWorkerConfig()` (`index.mjs:52397`) calls `wrangler.unstable_readConfig({ config: resolvedConfigPath })`; dev-mode binding construction flows through `wrangler.unstable_getMiniflareWorkerOptions(workerConfig, ...)` (`index.mjs:64600`). The config's top-level `vars` block (i.e. `wrangler.e2e.jsonc`'s `GITHUB_API_BASE_URL`/`AI_MOCK`) feeds directly into this.
- `prefixedEnv` comes from `vite.loadEnv(mode, root, ["CLOUDFLARE_", "WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_"])` (`index.mjs:52644`); Vite's `loadEnv` reads real `process.env` for any key matching those prefixes and lets it win over `.env` file values (`node_modules/vite/dist/node/chunks/config.js:9417`). So setting `CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH` as a plain process-env var on the spawned `astro dev` child (e.g. Playwright `webServer.env`, or `tests/helpers/astro-server.ts`'s `spawn(..., { env: {...} })`) is sufficient — no `.env` file needed.
- `.dev.vars` is separately merged in by `@astrojs/cloudflare` itself (`node_modules/@astrojs/cloudflare/dist/index.js:315-326`) and by wrangler's `getVarsForDev`/`loadDotDevDotVars` (`node_modules/wrangler/wrangler-dist/cli.js:181855-181933`), which supports `.dev.vars.<CLOUDFLARE_ENV>` — but that requires also setting `CLOUDFLARE_ENV` and a matching `env.<name>` block, which isn't needed here since the E2E vars already live directly in `wrangler.e2e.jsonc`'s top-level `vars`.
- Confirmed dead ends: (a) bare `wrangler dev --config` (already reproduced as broken, see §3), and (b) setting `GITHUB_API_BASE_URL`/`AI_MOCK` directly as process-env vars on the child process — the plugin only auto-pipes `CLOUDFLARE_`/`WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_`-prefixed keys into anything; arbitrary var names are ignored.

## Code References

- `astro.config.mjs:16` - Cloudflare adapter registration (workerd runtime for `astro dev`)
- `wrangler.jsonc:25-31` - `CLASSIFICATION_BATCH` Workflow binding declaration
- `wrangler.e2e.jsonc:38-43` - E2E-only `vars` block (`GITHUB_API_BASE_URL`, `AI_MOCK`) — still valid, just needs a different launch mechanism
- `src/worker.ts:474-477` - classify-chunk phase's `AI_MOCK` branch (`this.env.AI_MOCK ? createMockAiBinding() : this.env.AI`)
- `src/lib/services/mock-ai.ts` - deterministic `AiBinding` mock implementation
- `src/lib/github.ts:5` - `import { GITHUB_TOKEN_ENCRYPTION_KEY } from "astro:env/server"` — the raw-source import that breaks bare `wrangler dev` bundling
- `tests/helpers/astro-server.ts:29-140` - `startAstroServer()`, the established pattern for spawning `astro dev` and waiting for readiness; this is where `CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH` would be injected for a similar E2E helper
- `tests/integration/pat-leak.test.ts:39-98` - existing proof that `astro dev` runs the full Workflow chain successfully
- `playwright.config.ts:45-49` - existing E2E suite's `webServer` already uses `npm run dev`
- `.github/workflows/ci.yml:61-65,73-75` - comments confirming `astro dev`'s real-workerd nature and binding behavior
- `node_modules/@cloudflare/vite-plugin/dist/index.mjs:52644,52681,52397,64600` - config-path resolution and binding construction for `astro dev`
- `node_modules/@astrojs/cloudflare/dist/utils/handler.js:1-13` - virtual-module imports that break bare `wrangler dev` bundling of any custom entrypoint using `handle`
- `node_modules/@astrojs/cloudflare/dist/entrypoints/server.js` - Astro 6's "unified" entrypoint, confirming even the official path requires Astro's Vite pipeline

## Architecture Insights

- This project's Cloudflare integration has two genuinely distinct "runtimes" that are easy to conflate: (1) `astro dev`/`astro build`+`astro preview`, which go through Astro's Vite pipeline and therefore can resolve `astro:*`/`virtual:astro:*` specifiers, get full binding support via the Cloudflare Vite plugin, and are what this project already uses everywhere; vs (2) bare `wrangler dev`/`wrangler deploy` pointed directly at a hand-written `main` entrypoint file — which only works if that entrypoint is either free of Astro virtual-module imports, or (as here) is expected to be consumed through Astro's own pipeline, not wrangler's raw esbuild. `wrangler deploy` in production (`deploy.yml`) works today presumably because whatever "deploy" bundling wrangler-action performs is preceded by `npm run build` and Cloudflare's deploy tooling has different resolution behavior than `wrangler dev`'s dev-mode esbuild pass — this wasn't directly re-verified in this research pass and is worth confirming if it becomes relevant, but is out of scope for the E2E runner question.
- The Cloudflare Vite plugin's config-path selection (`CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH`) is an env-var switch, not a wrangler CLI flag — this is a Vite-plugin-specific mechanism, separate from (and easy to confuse with) `wrangler dev --config`.
- `GITHUB_API_BASE_URL` and `AI_MOCK` are Cloudflare _binding_ vars (consumed via `this.env.X` / `Cloudflare.Env`, declared in `src/env.d.ts`), which is a different mechanism from Astro's own `astro:env/server` schema (declared in `astro.config.mjs`'s `env.schema`, used for `SUPABASE_URL` etc.) — the two systems look similar but are resolved through different code paths (wrangler config `vars` + Miniflare, vs. Astro's Vite-generated virtual module).

## Historical Context (from prior changes)

- `context/archive/2026-07-11-e2e-core-user-flows/plan.md:11,265-271` - established the `npm run dev`-based `webServer` pattern this project's whole E2E suite (and the `test-e2e`-shaped CI job convention) already follows.
- `context/archive/2026-06-09-testing-access-boundary/plan.md:214-229` - introduced `startAstroServer`/`tests/helpers/astro-server.ts`, later reused successfully by `pat-leak.test.ts` to exercise the Workflow chain.
- `context/foundation/test-plan.md:208-249` - documents the `astro dev`-based server-output-capture pattern referenced above.

## Related Research

None found — this is the first research artifact for `e2e-workflow-chain`.

## Open Questions

- Whether `wrangler deploy` (production, `deploy.yml`) genuinely resolves `src/worker.ts`'s virtual-module imports differently than `wrangler dev`'s dev-mode esbuild pass, or whether production deploys are also implicitly relying on some Astro-build step happening first in a way that isn't obviously documented. Not blocking for the E2E runner decision, but worth a quick sanity check before assuming `wrangler.jsonc`'s `main: "./src/worker.ts"` is safe as-is for deploys.
- Whether `tests/helpers/astro-server.ts` should be extended/parameterized to accept an `env` override (for `CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH`), or whether the E2E spec should spawn its own astro-dev helper independent of the integration-test one — a Phase 2 design decision, not a research gap.
