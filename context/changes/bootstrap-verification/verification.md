---
bootstrapped_at: 2026-05-22T09:47:00Z
starter_id: 10x-astro-starter
starter_name: 10x Astro Starter (Astro + Supabase + Cloudflare)
project_name: gitgud
language_family: js
package_manager: npm
cwd_strategy: git-clone
bootstrapper_confidence: first-class
phase_3_status: ok
audit_command: npm audit --json
---

## Hand-off

```yaml
starter_id: 10x-astro-starter
package_manager: npm
project_name: gitgud
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: true
  has_background_jobs: false
```

**Why this stack**

GitGud ships as a solo, after-hours web app with a 6-week MVP timeline and two forcing features: auth (FR-014/015) and AI-driven semantic comment classification (FR-012). The 10x Astro Starter bundles Supabase — covering PostgreSQL, auth, and row-level security — which handles the IC/EM role separation from FR-016 without custom middleware. Cloudflare Pages is edge-native with a generous free tier, matching the solo/after-hours economics. All four agent-friendly gates pass: TypeScript + Zod across the stack, Astro's convention-based file routing, strong training-data presence, current docs. The AI classification layer for FR-012 is not bundled but slots into Astro API routes cleanly as a thin Anthropic or OpenAI SDK addition. CI on GitHub Actions with auto-deploy-on-merge is the starter's default shape; no manual promotion gates are needed at solo MVP scale.

## Pre-scaffold verification

| Signal      | Value                                                     | Severity | Notes                                                             |
| ----------- | --------------------------------------------------------- | -------- | ----------------------------------------------------------------- |
| npm package | not run                                                   | —        | `cmd_template` starts with `git clone`; npm package check skipped |
| GitHub repo | przeprogramowani/10x-astro-starter last pushed 2026-05-17 | fresh    | from card.docs_url; checked via GitHub API (unauthenticated curl) |

## Scaffold log

**Resolved invocation**: `git clone https://github.com/przeprogramowani/10x-astro-starter .bootstrap-scaffold && cd .bootstrap-scaffold && npm install`
**Strategy**: git-clone (cloned starter repo, deleted upstream git history before move-up)
**Exit code**: 0
**npm install exit code**: 0 (589 packages installed, 2 deprecation warnings — @babel/plugin-proposal-private-methods, node-domexception)
**Files moved**: 18 items (files and directories)
**.bootstrap-scaffold/.git deleted**: yes (per git-clone strategy — upstream starter history removed)
**Conflicts (.scaffold siblings)**: `CLAUDE.md.scaffold` (scaffold's AI rules file — diff against your project's CLAUDE.md to review)
**.gitignore handling**: append-merged — cwd's existing lines preserved; scaffold's 14 lines appended with `# from 10x-astro-starter` separator
**.bootstrap-scaffold cleanup**: deleted

Files moved silently (no conflict):

- `.env.example`, `.github/`, `.husky/`, `.nvmrc`, `.prettierrc.json`, `.vscode/`
- `README.md`, `astro.config.mjs`, `components.json`, `eslint.config.js`
- `package.json`, `package-lock.json`, `node_modules/`
- `public/`, `src/`, `supabase/`, `tsconfig.json`, `wrangler.jsonc`

## Post-scaffold audit

**Tool**: `npm audit --json`
**Summary**: 0 CRITICAL, 1 HIGH, 9 MODERATE, 0 LOW
**Direct vs transitive**: 0/0/2/0 direct of total 0/1/9/0 (npm audit `isDirect` field)

#### CRITICAL findings

None.

#### HIGH findings

| Package | Scope      | Advisory            | CVSS | Description                                          | Fix                             |
| ------- | ---------- | ------------------- | ---- | ---------------------------------------------------- | ------------------------------- |
| devalue | transitive | GHSA-77vg-94rm-hx3p | 7.5  | Svelte devalue: DoS via sparse array deserialization | Fix available (`npm audit fix`) |

#### MODERATE findings

| Package                  | Scope      | Advisory/Root cause           | Description                                                   | Fix                                                    |
| ------------------------ | ---------- | ----------------------------- | ------------------------------------------------------------- | ------------------------------------------------------ |
| ws                       | transitive | GHSA-58qx-3vcg-4xpx (CWE-908) | ws: Uninitialized memory disclosure (CVSS 4.4)                | Fix available                                          |
| yaml                     | transitive | GHSA-48c2-rrv3-qjmp (CWE-674) | yaml: Stack Overflow via deeply nested collections (CVSS 4.3) | Fix available via @astrojs/check v0.9.2 (semver-major) |
| yaml-language-server     | transitive | via yaml                      | Affected by yaml advisory above                               | Fix available via @astrojs/check v0.9.2                |
| volar-service-yaml       | transitive | via yaml-language-server      | Propagates yaml advisory                                      | Fix available via @astrojs/check v0.9.2                |
| @astrojs/language-server | transitive | via volar-service-yaml        | Propagates yaml advisory chain                                | Fix available via @astrojs/check v0.9.2                |
| @astrojs/check           | **direct** | via @astrojs/language-server  | Propagates yaml advisory chain                                | Downgrade to v0.9.2 (semver-major break)               |
| miniflare                | transitive | via ws                        | Propagates ws advisory                                        | Fix available                                          |
| wrangler                 | **direct** | via miniflare                 | Propagates ws advisory chain                                  | Fix available                                          |
| @cloudflare/vite-plugin  | transitive | via miniflare, wrangler, ws   | Propagates ws advisory chain                                  | Fix available                                          |

#### LOW / INFO findings

None.

## Hints recorded but not acted on

| Hint                    | Value                |
| ----------------------- | -------------------- |
| bootstrapper_confidence | first-class          |
| quality_override        | false                |
| path_taken              | standard             |
| self_check_answers      | null                 |
| team_size               | solo                 |
| deployment_target       | cloudflare-pages     |
| ci_provider             | github-actions       |
| ci_default_flow         | auto-deploy-on-merge |
| has_auth                | true                 |
| has_payments            | false                |
| has_realtime            | false                |
| has_ai                  | true                 |
| has_background_jobs     | false                |

These hint values are preserved here as an audit-trail for a future skill (M1L4 — Memory Architecture) to act on. Bootstrapper v1 surfaces them but takes no automated compensating action.

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:

- Review `CLAUDE.md.scaffold` (the starter's AI rules) — consider merging its conventions into your project's `CLAUDE.md`.
- Copy `.env.example` to `.env` for local Node development (or `.dev.vars` for Cloudflare local dev).
- Run `npx supabase start` to spin up a local Supabase instance (requires Docker).
- Address audit findings per your project's risk tolerance — the full breakdown is in this log. The 1 HIGH finding (`devalue`) and most MODERATE findings have fixes available via `npm audit fix`.
- `git init` is already set up (you already have a repo). Stage and commit the scaffolded files.
