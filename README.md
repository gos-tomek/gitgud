# GitGud

GitGud makes invisible engineering contributions visible. Code reviews, mentoring, and unblocking work are the highest-leverage activities on any team — and the ones most likely to disappear from performance data. GitGud pulls that signal out of GitHub: it classifies each review comment by semantic intent (mentoring, architecture, bug-catch, nitpick, unblocking, question) so the reviewer's actual contribution is legible, not just their volume.

Built for engineering managers who want to retain the engineers doing the most critical but least visible work, and for the ICs who want their contribution profile to reflect reality at review time.

## Tech Stack

- [Astro](https://astro.build/) v6 — SSR framework (all routes server-rendered)
- [React](https://react.dev/) v19 — interactive islands
- [TypeScript](https://www.typescriptlang.org/) v5
- [Tailwind CSS](https://tailwindcss.com/) v4 + [shadcn/ui](https://ui.shadcn.com/)
- [Supabase](https://supabase.com/) — auth (email/password) + PostgreSQL
- [Cloudflare Workers](https://workers.cloudflare.com/) — edge runtime (`wrangler deploy`)

## Prerequisites

- Node.js v22.14.0 (see `.nvmrc`)
- npm

## Getting Started

1. Install dependencies:

```bash
npm install
```

2. Set up environment variables. Create `.env` (Node dev) and `.dev.vars` (Cloudflare workerd dev):

```
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_KEY=<anon key>
```

Ask the team for production values. For local dev, spin up a local Supabase stack:

```bash
npx supabase start   # requires Docker
```

3. Run the development server (Cloudflare workerd runtime):

```bash
npm run dev
```

## Available Scripts

- `npm run dev` — start dev server (Cloudflare workerd runtime)
- `npm run build` — production build
- `npm run preview` — preview production build
- `npm run lint` — ESLint with type-checked rules
- `npm run lint:fix` — auto-fix ESLint issues
- `npm run format` — Prettier

## Project Structure

```
src/
├── pages/          # Astro pages + API routes (src/pages/api/)
├── components/     # UI components (Astro + React islands, shadcn in components/ui/)
├── layouts/        # Astro layouts
├── lib/            # Supabase client, helpers, services
├── hooks/          # React hooks
└── types.ts        # Shared entity/DTO types
```

## Auth Routes

| Route                 | Description                                                |
| --------------------- | ---------------------------------------------------------- |
| `/auth/signin`        | Email/password sign-in                                     |
| `/auth/signup`        | Email/password sign-up                                     |
| `/auth/confirm-email` | Post-signup confirmation page                              |
| `/dashboard`          | Protected — redirects to `/auth/signin` if unauthenticated |

Route protection is in `src/middleware.ts`. Add paths to `PROTECTED_ROUTES` to require auth.

## CI / Deployment

Changes to `main` are delivery-gated — direct pushes are rejected by branch protection.

**Branch workflow:** `change/<id>` branch → PR → CI gate → merge → auto-deploy.

**CI (`ci.yml`)** runs on every PR to `main` and on non-`main` branch pushes:

- lint + build
- `wrangler deploy --dry-run` — validates config and bundle without publishing

**Deploy (`deploy.yml`)** runs automatically on merge to `main`:

1. Production build
2. `supabase db push` — applies pending migrations (idempotent, runs before deploy)
3. `wrangler deploy` — publishes to Cloudflare Workers
4. Smoke check — `curl` with retry against the live URL
5. Project board issue → Status `done`, closed, version-ID comment posted

Required repository secrets: `SUPABASE_URL`, `SUPABASE_KEY`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF`, `PROJECT_TOKEN`.

**Live URL:** `https://gitgud.graosens.workers.dev`

## Project Context

The `context/` directory is the source of truth for product decisions, architecture, and implementation state. It's written for both humans and AI agents working on the codebase.

```
context/
├── foundation/         # Stable project docs (edit-in-place, never archived)
│   ├── roadmap.md      # ← start here: all roadmap items, status, dependencies
│   ├── prd.md          # Product requirements and user stories
│   ├── infrastructure.md  # Platform decisions (Cloudflare Workers, Supabase)
│   ├── tech-stack.md   # Stack choices and rationale
│   └── github-workflow.md # Issue/board conventions, GraphQL IDs
├── changes/            # One folder per active roadmap item being implemented
│   └── <change-id>/
│       ├── change.md   # Identity and status (planned → implementing → implemented)
│       └── plan.md     # Implementation contract with phases and progress
└── archive/            # Closed changes (immutable — do not edit)
```

**Current implementation state** is in `context/foundation/roadmap.md` — the "At a glance" table shows every roadmap item with its status (`done`, `ready`, `in-progress`, `blocked`, `proposed`). The "Done" table at the bottom records deployed versions.

Active changes live in `context/changes/`. Each `change.md` has a `status:` field that tracks the lifecycle from `planned` through `implementing` to `implemented`.

## License

MIT
