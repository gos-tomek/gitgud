# CI-CD: Branch/PR Workflow + Automated Deploy — Plan Brief

> Full plan: `context/changes/CI-CD/plan.md`

## What & Why

GitGud deploys by hand (`npx wrangler deploy` from local) and changes land directly on `main` (the only branch). This change moves to a protected-trunk model with automated delivery: every change goes to a `change/<id>` branch → PR → CI gate → merge → **auto-deploy** to Cloudflare Workers → the linked project-board issue is set to `done` with the deploy's version ID. The PR review becomes the human gate, replacing the manual `wrangler deploy` step.

## Starting Point

`main` is the only branch and is unprotected. `.github/workflows/ci.yml` runs lint + build on push/PR to `main` but never deploys. The app is deploy-shaped from F-01 (`wrangler.jsonc`, `astro.config.mjs` with `imageService: "passthrough"` + null session driver) and live at `https://gitgud.graosens.workers.dev`. Repo is `gos-tomek/gitgud`; the project board `PVT_kwHOERqfPM4BY-xN` is owned by `gos-tomek`. No test runner — lint + build are the only gates.

## Desired End State

A direct push to `main` is rejected by a ruleset; changes only merge via PR after CI passes (0 required approvals — solo self-merge). On merge, `deploy.yml` builds and runs `wrangler deploy`, then sets the linked issue's board Status to `done`, comments the Cloudflare version ID + URL, and closes it. `CLAUDE.md` carries a git-workflow rule so the agent always branches and opens a PR rather than committing to `main`. Release tagging stays deferred; `roadmap.md` stays a human/skill touch-point.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Branch protection strictness | PR required + CI check + 0 approvals; force-push/delete blocked; admin bypass kept | Practical for a solo maintainer while making direct-to-`main` impossible. | User |
| Deploy gate | Fully automatic on merge to `main` | The PR review is the human gate; intentionally supersedes `infrastructure.md`'s "human-only by hand" posture. | User |
| Board update | Automatic from CI on successful deploy | Keeps the board truthful without manual steps; carries the version-ID machine-fact. | User |
| DB migrations | Auto `supabase db push` before deploy; expand/contract rule enforced | Code never goes live against missing schema; PR review of the SQL is the gate; backward-compat keeps a Worker-only rollback safe. | User |
| Roadmap updates | Keep manual via skills (`/10x-implement`, `/10x-archive`), not CI auto-commit | A CI commit back to `main` would re-trigger `deploy.yml` and entangle content with delivery. | Plan (Q2) |
| Release tagging | Defer; CF version ID is the rollback handle | No external consumer yet; semver/changelog adds ceremony without payoff. | Plan (Q3) |
| Workflow split | `ci.yml` = PR/branch gate; new `deploy.yml` = deploy on push to `main` | Separates validation from delivery; ruleset requires the named CI check. | Plan |
| Project board auth | Separate `PROJECT_TOKEN` PAT (project scope) for board writes | Default Actions `GITHUB_TOKEN` cannot write a user-owned Projects v2 board. | Finding |

## Scope

**In scope:**
- `main` ruleset via `gh api` (PR + CI status check + block force-push/deletion).
- `CLAUDE.md` "Git workflow" section (branch-per-change, PR-only, agent never deploys).
- `ci.yml` retargeted to PR + non-`main` branch pushes with a stable check name; add `wrangler deploy --dry-run` as the pre-publish safety gate.
- New `deploy.yml`: build → `supabase db push` (hosted) → `cloudflare/wrangler-action` deploy → post-deploy smoke check → board update on push to `main`.
- Board update step (set Status `done`, comment version ID/URL, close issue) — only after smoke check passes.
- Doc fixes: `github-workflow.md` (`bodpl`→`gos-tomek`; `done` status `fe521554`), `infrastructure.md` (Approval/Rollback/Out-of-Scope → PR-gated posture), `tech-stack.md` (stale `cloudflare-pages` label).
- Append realized CI/CD automation to `context/changes/deployment/deployment-plan.md`.

**Out of scope:**
- PR preview deployments (Workers Builds / `wrangler versions upload`) — deferred to avoid exposing the authenticated app on a public URL.
- GitHub Environment manual approval gate (deferred belt-and-suspenders option).
- Release tagging / semver / changelog (Workstream 7 trigger only).
- Auto-committing `roadmap.md` from CI.
- DB migration rollback coordination (none exist until F-02/F-03).
- The daily classification batch (Workflow/Cron) — greenfield, separate change.
- A local `pre-push`/`PreToolUse` guard (optional; ruleset already enforces server-side).

## Architecture / Approach

```
change/<id> branch ──push──> CI (lint + build + wrangler --dry-run) ──> PR (Closes #N)
                                                   │  ruleset: PR + green CI, 0 approvals
                                                   ▼
                                            merge to main
                                                   │  push trigger
                                                   ▼
                                            deploy.yml
              build → db push (migrations) → wrangler deploy (version ID) → smoke check (200)
                                                   │
                                                   ▼
                              board: Status→done, comment version ID/URL, close issue
```

Two layers enforce "no direct `main`": the `CLAUDE.md` rule guides the agent (belt), the ruleset rejects the push server-side (suspenders). Board writes reuse the GraphQL mutations + IDs already documented in `github-workflow.md`, authenticated by `PROJECT_TOKEN`.

## Workstreams at a Glance

| Workstream | What it delivers | Key risk |
| --- | --- | --- |
| 1. Branch protection | `main` ruleset (PR + CI + no force-push) | Status-check rule needs a check GitHub has seen once — push a PR through CI first. |
| 2. Force branching (Q1) | `CLAUDE.md` rule + ruleset backstop (optional local pre-push guard) | Agent muscle-memory committing to `main`; mitigated by server-side reject. |
| 3. CI/CD pipeline | `ci.yml` retarget + new `deploy.yml` | `wrangler-action` auth/secret wiring; concurrency on overlapping merges. |
| 4. Credentials (human) | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `PROJECT_TOKEN`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD` | Scoped token hygiene; must exist before first merge. |
| 5. Board update + doc fixes | Deploy-time board mutation; corrects `github-workflow.md` (`bodpl`→`gos-tomek`, `done` status), `infrastructure.md`, `tech-stack.md` to the new posture | `GITHUB_TOKEN` can't write Projects v2 — needs `PROJECT_TOKEN`; stale `bodpl` owner + missing `done` status would fail board automation. |
| 6. Roadmap policy (Q2) | Defined transition points; archive-time stamp | None (policy, not code). |
| 7. Tagging policy (Q3) | Deferred with documented trigger | None (policy, not code). |

**Run order:** land Workstream 3 first so CI produces a selectable check name, push one PR through it, then apply the Workstream 1 ruleset referencing that check. Secrets (4) and `PROJECT_TOKEN` must exist before the first merge that exercises deploy + board update.

## Open Risks & Assumptions

- **Approval-posture flip.** This intentionally moves production publish from "human-by-hand" (`infrastructure.md`) to PR-gated auto-deploy; `infrastructure.md` itself is updated to match (primary-secret rotation stays human-only). If a deliberate post-merge gate is wanted later, add a GitHub Environment `production` with a required reviewer in front of the deploy step.
- **Runtime Worker secrets are not managed by CI.** `SUPABASE_URL`/`SUPABASE_KEY` on the Worker persist across `wrangler deploy` and are rotated by hand (`wrangler secret put`); CI only uses the *build* repo secrets. Don't assume a deploy re-provisions runtime secrets.
- **Stale `github-workflow.md`.** Owner references (`bodpl`) are wrong and will fail; the doc also omits the existing `done` status option (`fe521554`). Both fixed in Workstream 5.
- **Projects v2 token scope.** The default Actions token cannot write a user-owned board; the board step requires a separate PAT (`PROJECT_TOKEN`) — easy to miss and fails silently.
- **Non-atomic deploy + asymmetric rollback.** `db push` runs before `wrangler deploy`, but `wrangler rollback` reverts only the Worker, not the DB. Migrations must be backward-compatible (expand/contract; drops lag one release) or a code rollback breaks. Two migrations already exist in `supabase/migrations/` — confirm their hosted-project state before the first automated `db push`.
- **No test coverage.** CI quality gate remains lint + build only; acceptable as-is, revisit when a runner is added.

## Success Criteria (Summary)

- A direct `git push origin main` is rejected; a PR can only merge once the `ci` check is green (self-merge with 0 approvals works).
- A PR cannot merge until `ci` (lint + build + `wrangler --dry-run`) is green; a bundle/config error fails the PR, not the prod deploy.
- Merging a PR triggers `deploy.yml`, which applies pending migrations via `db push` (idempotent), then publishes via `wrangler deploy`; the post-deploy smoke check returns HTTP 200 and `wrangler tail` shows no CPU-cap errors. A failing migration aborts before deploy; a failing smoke check leaves the board unchanged.
- The linked board issue moves to Status `done`, is closed, and receives the version-ID/URL comment.
- `wrangler rollback <prev-version-id>` is confirmed available.
- A PR with a failing CI check cannot be merged.
