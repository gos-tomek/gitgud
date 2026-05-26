# Cloudflare Workers — First Production Deploy (Web Tier)

## Context

`context/foundation/infrastructure.md` selected **Cloudflare Workers** as the deploy
platform (zero migration: the `@astrojs/cloudflare` adapter is already installed and
`output: "server"` is set). This plan executes the **first production deployment of the
web tier** — auth + SSR pages — by hand, matching infrastructure.md's approval posture
("Production publish is human-only").

**Current state (verified):** the app is already deploy-shaped. `wrangler.jsonc` exists
with `name: "gitgud"`, the adapter server entrypoint, `compatibility_date: "2026-05-08"`,
`compatibility_flags: ["nodejs_compat"]`, an `ASSETS` binding on `./dist`, and
observability enabled. Secrets `SUPABASE_URL`/`SUPABASE_KEY` are declared in the
`astro:env` schema as `access: "secret", optional: true` and consumed via named imports
from `astro:env/server` (`src/lib/supabase.ts:3`, `src/lib/config-status.ts:1`). `.gitignore`
already excludes `.env`, `.dev.vars`, `.wrangler/`, `dist/`.

**Out of scope (deferred, per decision):** the GitHub-sync + AI-classification batch is
entirely greenfield (no Octokit, no Anthropic SDK, no DB migrations, empty `src/types.ts`,
no Workflow/Cron). It is documented below under *Deferred work & edge cases* with the
specific Cloudflare gotchas it will hit, but **not built or scaffolded here**.

**CI/CD decision:** automate later. First deploy is manual `npx wrangler deploy`. The
existing `.github/workflows/ci.yml` (lint + build, no deploy) stays as-is.

---

## Pre-work — do this manually BEFORE execution

These need accounts, interactive browser logins, and external dashboards, so do them
first, then hand the plan back for execution.

### A. Cloudflare account & CLI auth

- [ ] Sign up / log in at dash.cloudflare.com. On first use enable your `*.workers.dev` subdomain (Workers & Pages → pick a subdomain). Choose **Free** (fine for MVP) or **$5/mo Workers Paid** (only if an SSR page hits the 10ms CPU cap).
- [ ] Run `npx wrangler login` yourself — browser OAuth, the agent cannot complete it. Multiple Cloudflare accounts? select the right one during login (or set `CLOUDFLARE_ACCOUNT_ID`). Confirm with `npx wrangler whoami`.
- [ ] Confirm the Worker name `gitgud` (`wrangler.jsonc`) is what you want — it becomes the `gitgud.<subdomain>.workers.dev` URL.
- [ ] Node 22.14.0 active locally (`nvm use`, per `.nvmrc`).

### B. Database (Supabase) configuration

- [ ] Create a **hosted** project at supabase.com (pick a region near your users; save the DB password). The `.env` localhost values do NOT work in production.
- [ ] Project Settings → API: copy the **Project URL** and the **anon / publishable key** — these become the two Worker secrets set in Phase 2. Never put the **service_role** key in this app (it bypasses RLS).
- [ ] Authentication → Providers → enable **Email** (the app uses email/password signup). Decide whether "Confirm email" is on.
- [ ] If email confirmation is on, the built-in Supabase mailer is heavily rate-limited — for real signups configure **custom SMTP** (Authentication → Emails / SMTP Settings). Edge case: without it, confirmation emails silently throttle and signups appear to hang.
- [ ] **Schema:** none required for the web tier — the app uses Supabase's built-in auth tables only (`supabase/migrations/` doesn't exist yet; `src/types.ts` is empty). When the batch lands later, add migrations under `supabase/migrations/` (with RLS) and apply via `npx supabase link --project-ref <ref>` then `npx supabase db push`.
- [ ] (Set in Phase 5, flagged here) After deploy, set Authentication → URL Configuration → **Site URL** + **Redirect URLs** to the workers.dev URL, or signin/confirm-email redirects break.

### C. CI/CD secrets

- [ ] **Make the existing CI build pass:** add `SUPABASE_URL` and `SUPABASE_KEY` as **GitHub repository secrets** (repo → Settings → Secrets and variables → Actions). `.github/workflows/ci.yml`'s build step reads them. The anon key is public-safe; use the production values.
- [ ] **(Optional — enables the deferred auto-deploy):** create a **scoped Cloudflare API token** (Cloudflare → My Profile → API Tokens → "Edit Cloudflare Workers" template; limit to your account, no DNS/billing scopes). Add it as repo secret `CLOUDFLARE_API_TOKEN`, plus `CLOUDFLARE_ACCOUNT_ID`. The deploy job described under *Deferred: CI/CD automation* uses `cloudflare/wrangler-action` to run `wrangler deploy` on push to `main`. **Not needed for the first manual deploy.**

---

## Phase 0 — Pre-flight (read-only, no mutations)

- [ ] Confirm `astro.config.mjs` still uses `cloudflare()` + `output: "server"` (it does).
- [ ] Confirm `wrangler.jsonc` `main` = `@astrojs/cloudflare/entrypoints/server` and assets dir `./dist`.
- [ ] Confirm `compatibility_flags` includes `nodejs_compat` (required for `@supabase/ssr` on workerd).
- [ ] Confirm Node version matches `.nvmrc` (`22.14.0`): `node -v`.
- [ ] Decide deploy identity: production needs a **hosted Supabase project**, not the localhost values in `.env`. Have its **Project URL** and **anon/publishable key** ready (NOT the service_role key — cookie SSR auth uses the anon key).

## Phase 1 — Cloudflare account + auth (manual gate)

- [ ] Ensure a Cloudflare account exists and `workers.dev` subdomain is enabled (first Worker deploy provisions `gitgud.<subdomain>.workers.dev`).
- [ ] Authenticate Wrangler interactively — run yourself in this session: `! npx wrangler login` (opens a browser; the agent cannot complete OAuth).
- [ ] Verify auth: `npx wrangler whoami` (should print account + email).

## Phase 2 — Production secrets wiring

The named imports from `astro:env/server` resolve at **runtime** from the Worker's bound
secrets (confirmed against the adapter docs — `astro:env` is compatible, no `getSecret()`
rewrite needed). So the only wiring is uploading two Worker secrets.

- [ ] `npx wrangler secret put SUPABASE_URL` → paste the production Supabase URL.
- [ ] `npx wrangler secret put SUPABASE_KEY` → paste the production anon key.
- [ ] Verify: `npx wrangler secret list` shows both names (values are write-only).
- [ ] (Optional, local workerd fidelity) create `.dev.vars` (gitignored) with the same two keys so `npm run dev`/`wrangler dev` mirror prod. `.env` already serves Node dev.

## Phase 3 — Build + dry-run validation (catch config errors before mutating prod)

- [ ] `npm run build` — Astro SSR build emits the Worker + client assets into `./dist`.
- [ ] `npx wrangler deploy --dry-run --outdir=dist-dryrun` — validates `wrangler.jsonc`, bindings, and bundle **without publishing**. Watch for script-size warnings (React 19 bundle — infrastructure.md risk).
- [ ] Resolve any `nodejs_compat` / unresolved-import errors surfaced by the dry run before proceeding.

## Phase 4 — First production deploy (human-gated)

- [ ] **Deploy:** `npx wrangler deploy`.
  - ⚠️ Use `wrangler deploy`, **never** `wrangler pages deploy` — the v13 adapter dropped Pages support (infrastructure.md risk row). This is a Workers deploy.
- [ ] Note the printed `https://gitgud.<subdomain>.workers.dev` URL and the version ID.

## Phase 5 — Post-deploy verification

**Bug found and fixed during verification:**

1. **Adapter auto-bindings (build blocker):** `@astrojs/cloudflare` v13 auto-enables a SESSION KV
   binding and an IMAGES binding when neither is in `wrangler.jsonc`, crashing the workerd
   prerender runner. Fixed in `astro.config.mjs`:
   - `cloudflare({ imageService: "passthrough" })` — no IMAGES binding required.
   - `session: { driver: sessionDrivers.null() }` — prevents auto-KV wiring (auth is Supabase cookie-based).

- [x] `npx wrangler tail` — log streaming confirmed, no CPU-cap errors observed.
- [x] Open the workers.dev URL: home page (`/`) renders (SSR) — HTTP 200 confirmed.
- [x] **Supabase Auth dashboard → URL Configuration:** Site URL set to `https://gitgud.graosens.workers.dev`; Redirect URLs include `https://gitgud.graosens.workers.dev`.
- [x] Sign up → confirmation email flow works end-to-end.
- [x] `/dashboard` (protected) — signed-out access redirects to `/auth/signin` (HTTP 200 at redirect target confirmed).
- [x] Sign in → `/dashboard` loads authenticated.
- [x] Sign out clears the session cookie.
- [x] No `CPU exceeded` / `Exceeded resources` errors observed in `wrangler tail` during full auth loop.

## Phase 6 — Operational runbook (record, don't execute)

- [x] **Rollback:** `npx wrangler rollback [version-id]` reverts the Worker near-instantly. Caveat: rolls back **only the Worker** — Supabase schema is NOT included (none exists yet, but true once migrations land).
- [x] **Logs:** `wrangler tail` (live) + dashboard Workers Observability (historical; `observability.enabled` is on).
- [x] **Secret rotation:** re-run `wrangler secret put <NAME>` (human-only). Both `SUPABASE_URL` and `SUPABASE_KEY` are wired.
- [x] **Approval boundary:** `wrangler deploy`, secret rotation, and any future DB drop/alter are human-by-hand. An agent may run builds, dry-runs, and `wrangler tail` unattended (per CLAUDE.md production-access boundary).

## Phase 7 — Persist the artifact

- [x] **Live URL:** `https://gitgud.graosens.workers.dev`
- [x] **Final version ID:** `d42bc255-fb54-4b5d-9987-49bfde14bb6d`
- [x] **Secrets wired:** `SUPABASE_URL` (`https://zirxmltlswpylbfqiqnz.supabase.co`), `SUPABASE_KEY` (anon/publishable key)
- [x] **Rollback target:** previous version `e2388999-992a-43fc-8169-8bc03904adcf` (first deploy)

---

## Deferred work & edge cases (the batch — NOT built here)

infrastructure.md is emphatic that the daily GitHub-sync + AI-classification batch is the
*architecturally hardest* part and that it's all greenfield. Flagging the concrete
Cloudflare-specific traps so the future feature build budgets for them:

1. **Custom entrypoint required for Cron/Workflow.** `wrangler.jsonc` `main` points at the
   adapter's prebuilt server entrypoint, so you cannot just add a `scheduled()` export or
   `[[workflows]]`. The batch needs a **wrapper Worker** that re-exports the adapter's
   `fetch` handler and adds your own `scheduled` handler / `WorkflowEntrypoint`. Budget
   integration time for this — it's not a one-line config add.
2. **Don't cram the sync into a request.** A real org (infrastructure.md's pre-mortem: 1,200
   PRs / 8,000 comments) blows past the CPU cap. Build it as a **Cloudflare Workflow** with
   idempotent durable steps from day one; chunk GitHub pagination + per-comment
   classification across steps. Trigger via a free **Cron Trigger** (daily).
3. **workerd ≠ Node for the GitHub client.** Octokit pagination/retry/stream code can break
   *only in production*. Prefer fetch-based GitHub calls; test the client on workerd early;
   `nodejs_compat` is already set.
4. **Binding env access changed in v13.** `Astro.locals.runtime` was **removed**. Read
   bindings via `import { env } from 'cloudflare:workers'` (or `Astro.locals.cfContext` for
   exec context). Old snippets that use `Astro.locals.runtime.env` will not compile.
5. **AI token spend dwarfs hosting.** Classification cost scales with comment volume and far
   exceeds the $0–5/mo hosting bill. Use a cheap model (Haiku), store results to avoid
   re-classifying, dedupe, set API spend alerts.
6. **Schema is empty.** `supabase/migrations/` doesn't exist and `src/types.ts` is empty —
   the batch needs a schema (PRs / comments / classifications) with RLS before it can write
   anything. Per CLAUDE.md migration conventions.

**Note on KV session risk (resolved):** infrastructure.md flags KV-backed-session eventual
consistency as a flaky-auth risk. It does **not apply** to the current app — sessions are
**cookie-based via `@supabase/ssr`** (`src/lib/supabase.ts`), no KV namespace. Avoid moving
sessions to KV later for this reason.

## Deferred: CI/CD automation (when ready to automate)

- Add a deploy job to `.github/workflows/ci.yml` running `wrangler deploy` on push to `main`,
  using `cloudflare/wrangler-action`.
- Store `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` as repo secrets. **Scope the token**
  to Workers Scripts edit for this project only — no DNS, no billing, no unrelated secrets
  (CLAUDE.md production-access boundary).
- Optional preview deploys: connect the repo to **Workers Builds** for per-PR preview URLs,
  or `wrangler versions upload` for a preview URL without publishing. Preview URLs are public
  by default — gate with Cloudflare Access if previews shouldn't be open.

## Verification summary

End-to-end success = the workers.dev URL serves the SSR home page, the full Supabase auth
loop (signup → email confirm → signin → `/dashboard` → signout) works against the production
Supabase project, `wrangler tail` shows no CPU-cap errors, and `wrangler rollback` is
confirmed available. The pre-publish `wrangler deploy --dry-run` is the safety gate that
catches config/bundle errors before anything touches production.
