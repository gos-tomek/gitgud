# Rules for AI

This file provides guidance to AI Agent when working with code in this repository.

## Git workflow

- **Never commit or push directly to `main`.** Before the first change of any unit of work, create a branch named `change/<change-id>` (matching the `context/changes/<change-id>` identity).
- Work on the branch → `git push origin change/<change-id>` → open a PR with `gh pr create`, body containing `Closes #<issue>`.
- `main` only advances via merged PR. The agent must never run `wrangler deploy` or `supabase db push` against production — `deploy.yml` owns both.
- **Migrations must be backward-compatible (expand/contract):** additive changes (`ADD COLUMN`, new table) ship freely. Destructive `DROP`/`ALTER` must lag one release behind the code that stops using the column, because `wrangler rollback` reverts only the Worker — the DB schema does not roll back with it.

## Commands

- `npm run dev` — start dev server (Cloudflare workerd runtime)
- `npm run build` — production build (SSR via `@astrojs/cloudflare`)
- `npm run preview` — preview production build
- `npm test` — run all tests (unit, component, hermetic, integration; integration tests require local Supabase — see Testing below)
- `npm run test:typecheck` — type-check test files (`tsc --project tests/tsconfig.json --noEmit`; the root `tsconfig.json` excludes `tests/`, so this is the only typecheck that covers them)
- `npm run lint` — ESLint with type-checked rules
- `npm run lint:fix` — auto-fix lint issues
- `npm run format` — Prettier (includes prettier-plugin-astro + prettier-plugin-tailwindcss)

Pre-commit hooks (Lefthook, parallel): `eslint --fix` on staged `*.{ts,tsx,astro}`, `prettier --write` on staged `*.{json,css,md}`, `tsc --noEmit` (src), `tsc --noEmit --project tests/tsconfig.json` (tests), and `vitest run --exclude 'tests/integration/**'`.

Prettier config: `printWidth: 120`, `semi: true`, `singleQuote: false`, `trailingComma: "all"`. Do not wrap lines at 80 chars.

Never write to `context/archive/`. Archived changes are immutable; if a target path starts with `context/archive/`, abort and tell the user to open a new change with `/10x-new` instead.

## Architecture

**Astro 6 SSR app** with React 19 islands, Tailwind 4, Supabase auth, and shadcn/ui components. Deployed to Cloudflare Workers.

### Rendering mode

Full server-side rendering (`output: "server"` in astro.config.mjs). All routes are non-prerendered by default — do NOT add `export const prerender = false` to API routes; it is redundant. Only add `export const prerender = true` to explicitly opt a route into static generation.

### Auth flow

- `src/lib/supabase.ts` — creates a Supabase SSR client using `@supabase/ssr` with cookie-based sessions. Uses `astro:env/server` for `SUPABASE_URL` and `SUPABASE_KEY` (server-only secrets declared in astro.config.mjs `env.schema`).
- `src/middleware.ts` — runs on every request, resolves the current user, attaches to `context.locals.user`. Redirects unauthenticated users away from routes listed in `PROTECTED_ROUTES`.
- API endpoints: `src/pages/api/auth/{signin,signup,signout}.ts`
- Auth pages: `src/pages/auth/{signin,signup,confirm-email}.astro`
- Protected page example: `src/pages/dashboard.astro`

### Key conventions

- **Path alias**: `@/*` maps to `./src/*` (tsconfig paths).
- **Astro components** for static content/layout; **React components** only when interactivity is needed.
- **Tailwind class merging**: use the `cn()` helper from `@/lib/utils` (clsx + tailwind-merge) for conditional/merged class names. Do not concatenate class strings manually.
- **shadcn/ui**: components live in `src/components/ui/`, "new-york" style variant. Install new ones with `npx shadcn@latest add [name]`.
- **API routes**: use uppercase `GET`, `POST` exports; validate input with zod.
- **Supabase migrations**: `supabase/migrations/` using naming format `YYYYMMDDHHmmss_short_description.sql`. Always enable RLS on new tables with granular per-operation, per-role policies.
- **React**: no Next.js directives ("use client" etc.). Extract hooks to `src/hooks/` (`@/hooks` alias maps here per `components.json`).
- **React Compiler**: `react-compiler/react-compiler` ESLint rule is `"error"`. Components must be compiler-compatible — no manual `useMemo`/`useCallback` bypasses; rules-of-hooks apply strictly.
- **Services/helpers** go in `src/lib/` (or `src/lib/services/` for extracted business logic).
- **Shared types** (entities, DTOs) go in `src/types.ts`.

### Environment

- Node.js v22.14.0 (see `.nvmrc`)
- Env vars: `SUPABASE_URL`, `SUPABASE_KEY` — create `.env` (for Node) or `.dev.vars` (for Cloudflare local dev, gitignored) with these two keys. No `.env.example` exists; ask the team for values.
- Run `npx astro sync` after changing `astro:env` schema (env vars declared in `astro.config.mjs`); CI does this automatically but local dev does not.
- Local Supabase: `npx supabase start` (requires Docker)
- Cloudflare local dev: secrets go in `.dev.vars` (gitignored)
- Deploy: `npx wrangler deploy` (requires Cloudflare account + `wrangler` auth)

## CI

GitHub Actions runs two required jobs on every PR to `main` (`.github/workflows/ci.yml`):

- `validate` — lint, typecheck (`npx tsc --noEmit` for src, `npm run test:typecheck` for tests), non-integration tests (`vitest run --exclude 'tests/integration/**'`), build, and `wrangler deploy --dry-run`. Requires `SUPABASE_URL` and `SUPABASE_KEY` repository secrets for the build step.
- `test-integration` — starts a local Supabase instance (`supabase/setup-cli@v2` + `supabase start`) and runs `vitest run tests/integration/`.

On push to `main`, `.github/workflows/deploy.yml` runs a `pre-deploy-tests` job (typecheck + non-integration tests) before `deploy-production`.

## Testing

- Test runner: Vitest 4.x. Tests live in `tests/unit/`, `tests/component/`, `tests/hermetic/`, and `tests/integration/`.
- Integration tests run against a real local Supabase instance — start it with `npx supabase start` before running `npm test`. Tests skip automatically with a clear message if Supabase is unreachable.
- Helpers in `tests/helpers/`: `supabase.ts` (admin client + user factory), `setup.ts` (availability guard), `seed.ts` (two-board fixture), `astro-server.ts` (dev server lifecycle), `auth-fetch.ts` (cookie-based authenticated fetch).
- For patterns — two-client pattern, RLS denial assertion shapes, server output capture — see `context/foundation/test-plan.md §6.1`.
- For risk strategy and rollout phases, see `context/foundation/test-plan.md §2–§3`.

<!-- BEGIN @przeprogramowani/10x-cli -->

## 10xDevs AI Toolkit - Module 3, Lesson 4 (E2E Tests)

**For E2E tests, use the `/10x-e2e` skill.** It is the single source of truth
for the workflow — risk → seed test + rules → generate → review against the five
anti-patterns → re-prompt → verify. The skill's `references/` carry the full
rules, anti-patterns, seed pattern, and prompt-template.

A few hard rules that hold even before you invoke the skill:

- **Locators:** `getByRole` / `getByLabel` / `getByText` first; `getByTestId`
  only when accessibility attributes are ambiguous. Never CSS selectors, XPath,
  or DOM structure.
- **Never `page.waitForTimeout()`.** Wait for state: `toBeVisible()`,
  `waitForURL()`, `waitForResponse()`.
- **Test independence + cleanup.** Each test runs standalone — its own setup,
  action, assertion, and cleanup; unique ids (timestamp suffix) so parallel runs
  and re-runs don't collide.

Two boundaries to keep straight:

- **DOM (snapshot) is the default.** Vision (`--caps=vision`) is a supplement for
  visual-only risks (layout, z-index, animation); for pixel regression prefer
  deterministic tools (`toMatchSnapshot`, Argos, Lost Pixel). VLM model
  selection/cost is a debugging topic (Lesson 5), not testing.
- **Healer helps on selectors, harms on logic.** A changed selector → healer
  re-finds it (route through PR review). A changed business behavior → healer
  masks the bug; that failing-test-to-fix case is Lesson 5.

<!-- END @przeprogramowani/10x-cli -->
