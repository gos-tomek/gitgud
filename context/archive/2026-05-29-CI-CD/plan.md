# Plan: Automate Deployment + Branch/PR-Based GitHub Workflow

## Context

GitGud currently deploys **manually** (`npx wrangler deploy` from local), and changes land
**directly on `main`** (the only branch). The first production deploy (F-01) was done by hand and
recorded in `context/changes/deployment/deployment-plan.md`. CI (`.github/workflows/ci.yml`) runs
lint+build on push/PR to `main` but never deploys.

This change moves GitGud to a protected-trunk model with automated delivery:

1. Every change is pushed to a **feature branch**, never straight to `main`.
2. When implementation is ready, a **pull request** is opened.
3. `main` is **protected** — changes only via PR.
4. On PR merge → **auto-deploy** to Cloudflare Workers (PR review = the human gate).
5. After a successful deploy → the **project board issue** is updated (status `done`, version ID).

It also answers three open questions: (Q1) how to force branch creation by the agent, (Q2)
when/how to update `roadmap.md`, (Q3) whether/when to tag releases.

### Decisions taken

- Branch protection: **PR required + CI status check must pass + 0 required approvals** (solo
  self-merge allowed; force-push/deletion blocked; admin bypass kept for emergencies).
- Deploy gate: **fully automatic on merge to `main`**. This intentionally supersedes
  `infrastructure.md`'s "production publish is human-only by hand" posture — the PR is now the gate.
- Board: **auto-updated from CI** on successful deploy.
- Tagging: **deferred** (no semver releases yet; see Workstream 7).

### Findings from analysis (must be reflected in the work)

- Repo is `gos-tomek/gitgud`; default branch `main`; active `gh` account `gos-tomek`.
- The project board (`PVT_kwHOERqfPM4BY-xN`) is owned by **`gos-tomek`**, NOT `bodpl`.
  `context/foundation/github-workflow.md` is **stale** — every `--owner bodpl` / `users/bodpl`
  reference is wrong and will fail.
- The board's **Status** field already has a `done` option (id **`fe521554`**), but
  `github-workflow.md`'s Status table omits it. The deploy automation targets that option.
- A user-owned **Projects v2** board cannot be written by the default Actions `GITHUB_TOKEN`.
  The deploy workflow needs a separate **PAT secret** with `project` write scope.

### Execution model

This change is **executed manually**, not via `/10x-implement`. The bulk of the work is human-only
pre-work (Cloudflare/Supabase dashboards, scoped token creation, `gh api` against the live repo,
branch-protection ruleset) plus a few code/doc edits — there is no per-phase `/10x-implement`
verification/commit/SHA-writeback loop here. The `## Progress` checklist at the bottom is the
tracking surface; tick items as they land. Run order is in **Verification** (land Workstream 3 →
push one PR through CI → apply the Workstream 1 ruleset; secrets must exist before the first deploy).

---

## Workstream 1 — Branch protection on `main` (requirement 3)

Create a repository **ruleset** (preferred over legacy branch protection) targeting `main`:

- Require a pull request before merging; required approvals **0**.
- Require status checks to pass; required check = the CI job (see Workstream 3 naming).
- Block force-pushes and branch deletion.
- Keep admin bypass enabled (emergency hatch for the solo maintainer).

Apply via `gh api`:

```bash
gh api repos/gos-tomek/gitgud/rulesets -X POST --input ruleset.json
```

`ruleset.json` sets `target: branch`, `conditions.ref_name.include: ["~DEFAULT_BRANCH"]`, and
rules: `pull_request` (`required_approving_review_count: 0`), `required_status_checks` (referencing
the CI check name + a compatible integration id), `non_fast_forward`, `deletion`. Validate
afterward with `gh api repos/gos-tomek/gitgud/rulesets`.

> Note: the status-check rule can only require a check GitHub has already seen once. Push one PR
> through CI first (Workstream 3) so the check name is selectable, then add it to the ruleset.

---

## Workstream 2 — Force branch creation by the agent (Q1)

Two layers — guidance (belt) + server-side enforcement (suspenders):

**a) Project rule in `CLAUDE.md`** — add a short, top-of-file "Git workflow" section:
- Never commit or push to `main`. Before the first change of a unit of work, create a branch named
  `change/<change-id>` (matches the `context/changes/<change-id>` identity).
- Work → push branch → open PR with `gh pr create`, body containing `Closes #<issue>`.
- `main` only advances via merged PR; the agent never runs `wrangler deploy` / `supabase db push`
  against prod (CI owns both now).
- **Migrations must be backward-compatible (expand/contract):** additive changes ship freely;
  destructive `DROP`/`ALTER` lag one release behind the code that stops using the column, because a
  Worker rollback does not roll back the DB.

**b) Server-side guarantee** — Workstream 1's ruleset makes a direct push to `main` *fail*
regardless of agent behavior, so the rule can't be silently violated. This is the hard backstop:
even if the agent's commit muscle-memory targets `main`, the push is rejected.

> Note: a `/10x-implement`-commit-ritual reframe was considered and **dropped** — (a) the
> `CLAUDE.md` rule provides the guidance and (b) the ruleset provides the hard guarantee, so
> editing shared skill behavior adds nothing. If "never *attempt* the push" matters, the optional
> local guard (c) handles it more directly.

**c) Optional local guard** — a `pre-push` git hook (or a `PreToolUse` hook in
`.claude/settings.json` matching `git push` to `main`) that aborts a push whose target is `main`.
Lower priority since (b) already enforces it server-side.

---

## Workstream 3 — CI/CD pipeline (requirements 1, 2, 4)

Split responsibilities into two workflows.

**`.github/workflows/ci.yml` (validation) — adjust trigger scope.**
Keep lint + build, but it's the **PR gate**. Run on `pull_request` to `main` and on push to
non-`main` branches (so branch pushes get feedback). Give the job a stable name (e.g. job/check
`ci`) so the ruleset can require it. Continues to use the `SUPABASE_URL`/`SUPABASE_KEY` repo
secrets for the build step. **Add `npx wrangler deploy --dry-run --outdir=dist-dryrun`** after the
build — this is `infrastructure.md`'s pre-publish safety gate: it validates `wrangler.jsonc`,
bindings, `nodejs_compat`, and surfaces **script-size warnings** (React 19 bundle risk) so a config/
bundle problem fails the PR instead of the production deploy. Dry-run validates the bundle offline —
no Cloudflare token needed in PR context.

**No PR preview deployments** (decision): PR validation is build-only. Previews are deferred to
avoid exposing the authenticated app on a public preview URL; revisit via Workers Builds /
`wrangler versions upload` (gated by Cloudflare Access) if review-on-real-UI becomes valuable.

**`.github/workflows/deploy.yml` (delivery) — new.**
- Trigger: `push` to `main` (i.e. a merged PR) — plus `workflow_dispatch` for manual re-runs.
- Steps:
  1. checkout, `setup-node@v4` (node 22, npm cache), `npm ci`, `npx astro sync`, `npm run build`
     (build env = `SUPABASE_URL`/`SUPABASE_KEY` repo secrets).
  2. **Apply DB migrations** — `supabase/setup-cli` then `supabase link --project-ref <ref>` +
     `supabase db push` against the hosted project (auth: `SUPABASE_ACCESS_TOKEN` +
     `SUPABASE_DB_PASSWORD`). Runs **before** the deploy so code never goes live against a schema
     that isn't there; if this step fails, the job aborts before publishing. `db push` is
     idempotent (only applies migrations absent from the remote history table). Seed data
     (`seed.sql`) is **not** run in prod.
  3. Deploy with `cloudflare/wrangler-action@v3` (`command: deploy`, **never** `pages deploy`),
     authenticated by `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` secrets. Capture the printed
     **version ID** and workers.dev URL from the action output.
  4. **Post-deploy smoke check** — `curl -fsS https://gitgud.graosens.workers.dev/` asserting HTTP
     200, wrapped in a **short retry loop** (e.g. 5 attempts, ~5s backoff) so a transient
     mid-rollout 5xx doesn't false-fail a healthy release. Only a sustained non-200 fails the job
     (and the board is **not** marked `done`), flagging a broken release immediately.
  5. Board update (Workstream 5) — only after the smoke check passes.
- Concurrency group `deploy-main` with `cancel-in-progress: false` so overlapping merges serialize
  rather than race.

**Runtime Worker secrets stay out of CI.** `infrastructure.md` distinguishes *build* secrets (GitHub
repo secrets, used above) from *runtime* secrets set on the Worker via `wrangler secret put`
(`SUPABASE_URL`/`SUPABASE_KEY`). Runtime secrets **persist across `wrangler deploy`** and are **not**
managed or rotated by CI — rotation remains a human `wrangler secret put` (per the approval boundary).

**Migration safety discipline (non-atomic deploy).** `wrangler rollback` reverts only the Worker,
**not** the DB (`infrastructure.md`). So migrations must be **backward-compatible (expand/contract)**:
the migration must not break the currently-running *old* code (there's a window where new schema +
old code coexist, and a code rollback leaves the migrated schema in place). Additive changes
(`ADD COLUMN`, new table) ship freely; destructive `DROP`/`ALTER` must **lag one release behind**
the code that stops using the column. This rule goes in `CLAUDE.md` (Workstream 2). The PR review of
the migration SQL is the human gate — it replaces `infrastructure.md`'s "drop/alter are human-only
by hand" posture, consistent with the auto-deploy decision.

This realizes the user's flow: branch → PR → CI validates → merge → `deploy.yml` publishes.

---

## Workstream 4 — Cloudflare deploy credentials (human pre-work)

Already partly documented in `deployment-plan.md` §C as the "deferred auto-deploy" path. Required
before `deploy.yml` can run (the user does these — they involve dashboards/tokens):

- [ ] Create a **scoped** Cloudflare API token ("Edit Cloudflare Workers" template; this account
      only; no DNS/billing). Add repo secret `CLOUDFLARE_API_TOKEN`.
- [ ] Add repo secret `CLOUDFLARE_ACCOUNT_ID`.
- [ ] Confirm `SUPABASE_URL` / `SUPABASE_KEY` repo secrets exist (anon key, production values).
- [ ] Add the **`PROJECT_TOKEN`** secret for board writes (Workstream 5).
- [ ] Add **`SUPABASE_ACCESS_TOKEN`** (Supabase CLI personal token) + **`SUPABASE_DB_PASSWORD`**
      and the project ref for the `db push` migration step (Workstream 3). The DB password is
      distinct from the anon key — never use the service_role key here.

`wrangler.jsonc` (`name: "gitgud"`, `nodejs_compat`, `ASSETS`/`./dist`, observability) and
`astro.config.mjs` (`imageService: "passthrough"`, null session driver) are already deploy-shaped
from F-01 — no change needed.

---

## Workstream 5 — Board update on successful deploy (requirement 5)

Runs as the final step of `deploy.yml` after a green deploy. Uses the conventions in
`context/foundation/github-workflow.md` (Project ID `PVT_kwHOERqfPM4BY-xN`, Status field
`PVTSSF_lAHOERqfPM4BY-xNzhUAs5E`, done option **`fe521554`**).

Flow:
1. Resolve the merged PR for the pushed commit, then its linked issue via GraphQL
   `closingIssuesReferences` (relies on the `Closes #N` convention from Workstream 2b).
2. Set the issue's project-item **Status → `done`** via `updateProjectV2ItemFieldValue`.
3. Post a comment on the issue with the **Cloudflare version ID + live URL + deploy date**, then
   `gh issue close` (idempotent if `Closes #N` already closed it on merge).

**Auth:** these Project v2 mutations require a PAT (`project` scope), not the default
`GITHUB_TOKEN`. Store as secret **`PROJECT_TOKEN`**; pass it as `GH_TOKEN` for the board step only.

**Doc fixes (do as part of this workstream):**

`context/foundation/github-workflow.md`:
- Replace all `bodpl` owner references with `gos-tomek` (project URL, `gh project list --owner`,
  `gh project item-add ... --owner`, the `users/bodpl/projects` URL line).
- Add the `done` row (id `fe521554`) to the Status Values table, and mark it the terminal deploy
  state.

`context/foundation/infrastructure.md` (this change supersedes parts of its Operational Story):
- **Approval** section: production publish + `db push` are now **PR-gated auto-deploy** (the PR is
  the human gate), not "human-only by hand." Keep **primary-secret rotation** human-only.
- **Rollback** section: cross-reference the expand/contract rule (DB still doesn't roll back).
- **Out of Scope** line "CI/CD pipeline setup … was not part of this decision" → point it at this
  change (`context/changes/CI-CD/`).

`context/foundation/tech-stack.md` (minor cleanup): correct the stale `cloudflare-pages` /
`deployment_target` label to **Workers** + `wrangler deploy` (flagged in `infrastructure.md`
risk-register line 94).

---

## Workstream 6 — Roadmap update policy (Q2)

**Recommendation: keep `roadmap.md` a human/skill step, not a CI auto-commit.** Rationale: a CI job
that commits back to `main` re-triggers `deploy.yml` (loop) and entangles content edits with
delivery. The board (Workstream 5) carries the machine-fact (version ID/date) automatically.

Concretely, define these transition points:
- **At change start** (`/10x-new` / branch creation): set the roadmap item + board Status to
  `in-progress`.
- **At PR open** (`/10x-implement` phase close): board Status → `in-review`.
- **At deploy** (CI): board Status → `done` (automatic).
- **At archive** (`/10x-archive`): stamp the roadmap **"Done" table** row (ID, deployed date,
  version ID) and flip the item's `Status:` front-matter to `done`, mirroring the existing F-01
  row. This is the single human/skill touch-point for `roadmap.md`.

(If the user later wants roadmap fully automated, do it from a *separate* scheduled/labelled
workflow that uses `[skip ci]`-style guards — out of scope here.)

---

## Workstream 7 — Release tagging (Q3)

**Recommendation: defer formal releases for now.** With continuous deploy-on-merge and a single
maintainer, semver tags + changelogs add ceremony without an external consumer to serve. The
Cloudflare **version ID** (already recorded per deploy on the board + roadmap Done table) is the
real rollback handle (`wrangler rollback <version-id>`), which is what matters operationally.

**Introduce tagging when** any of these become true: external/beta users need a changelog; you want
human-readable rollback points; or you start batching changes into named releases. At that point
add a lightweight tag in `deploy.yml` (`deploy-YYYYMMDD-<shortsha>` annotated with the CF version
ID), and graduate to semver `vX.Y.Z` only when a changelog is published. Captured as a documented
trigger, not built now.

---

## Files to create / modify

| Path | Change |
|---|---|
| `.github/workflows/ci.yml` | Scope to PR gate + non-`main` branch pushes; stable check name; add `wrangler --dry-run` |
| `.github/workflows/deploy.yml` | **New** — build → `db push` → `wrangler-action` deploy → smoke check → board update on push to `main` |
| `CLAUDE.md` | **New "Git workflow" section** — branch-per-change, PR-only, agent never deploys, expand/contract migrations |
| `context/foundation/github-workflow.md` | Fix `bodpl`→`gos-tomek`; document `done` status (`fe521554`) |
| `context/foundation/infrastructure.md` | Update Approval/Rollback/Out-of-Scope to the new PR-gated auto-deploy posture |
| `context/foundation/tech-stack.md` | Fix stale `cloudflare-pages` label → Workers + `wrangler deploy` |
| `context/changes/deployment/deployment-plan.md` | Append the realized CI/CD automation (supersede the "automate later" note) |
| repo settings (via `gh api`) | `main` ruleset (Workstream 1) |
| repo secrets (human) | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `PROJECT_TOKEN`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD` |

Reuse, don't reinvent: the board GraphQL mutations + IDs already live in `github-workflow.md`; the
deploy command/flags + secret model + `wrangler.jsonc`/`astro.config.mjs` shape come straight from
`deployment-plan.md` and `infrastructure.md`.

---

## Verification

1. **Branch + PR path:** create `change/test-pipeline`, push, open PR. Confirm CI runs and a direct
   `git push origin main` is **rejected** by the ruleset.
2. **CI gate:** confirm the PR cannot merge until the `ci` check is green; self-merge works with 0
   approvals. Confirm `wrangler deploy --dry-run` runs in `ci.yml` and a bundle/config error fails
   the PR.
3. **Migration:** a PR adding an additive migration → on merge, `deploy.yml`'s `db push` applies it
   to the hosted Supabase project and the migration appears in the remote history; a re-run is a
   no-op (idempotent). A failing migration aborts the job **before** `wrangler deploy`.
4. **Deploy:** merge the PR → `deploy.yml` runs → `wrangler deploy` publishes; capture version ID.
   The post-deploy smoke check hits `https://gitgud.graosens.workers.dev/` (HTTP 200); `wrangler
   tail` shows no CPU errors. Confirm a failing smoke check fails the job and leaves the board
   unchanged.
5. **Board:** confirm the linked issue moved to Status `done`, was closed, and received the
   version-ID/URL comment.
6. **Rollback drill (read-only confirm):** `wrangler rollback <prev-version-id>` is available;
   confirm the team understands it does **not** revert the DB (expand/contract is what keeps a
   rollback safe).
7. **Negative:** a PR whose CI fails cannot be merged.

Run order: land Workstream 3 (workflows) first so CI produces a selectable check name, push one PR
through it, then apply the Workstream 1 ruleset referencing that check. Secrets (Workstream 4) and
`PROJECT_TOKEN` must exist before the first merge that exercises deploy + board update.

## Out of scope / risks

- This **flips the production approval posture** in `infrastructure.md` (human-by-hand → PR-gated
  auto-deploy). If you want a belt, the deferred option is a GitHub Environment `production` with a
  required reviewer in front of the deploy step — not included per the "auto" choice.
- **DB migrations are now part of the deploy** (`db push` before `wrangler deploy`), but the deploy
  is **non-atomic** and `wrangler rollback` reverts only the Worker, not the DB. The expand/contract
  discipline (additive-first; drops lag a release) is what keeps a rollback safe — it is a hard
  rule, not a guideline. Two migrations already exist in `supabase/migrations/`. **`db push` is not
  schema-diffing** — it replays migration files whose versions aren't recorded in the remote
  `supabase_migrations.schema_migrations` history table, and `board_triggers.sql` uses bare
  `CREATE FUNCTION` / `CREATE TRIGGER` (no `OR REPLACE` / `IF NOT EXISTS`). So if F-01 created any of
  this schema by hand, or applied a migration without recording history, the first automated push
  errors ("already exists") and aborts the deploy. **Pre-flight (Workstream 4, human):** run
  `supabase migration list` against the hosted project; if objects exist but their versions aren't in
  the applied history, run `supabase migration repair --status applied <version>` to reconcile before
  the first merge that triggers `deploy.yml`.
- The daily classification batch (Workflow/Cron) remains greenfield and out of scope here.

---

## Progress

Manual execution (see **Execution model**). Tick items as they land; record the deploy version ID
on the board + roadmap Done table, not here.

### Workstream 4 — Credentials & secrets (human pre-work; gates first deploy)
- [x] Scoped `CLOUDFLARE_API_TOKEN` (Edit Workers, this account only) + `CLOUDFLARE_ACCOUNT_ID` repo secrets
- [x] Confirm `SUPABASE_URL` / `SUPABASE_KEY` repo secrets (anon key, prod values)
- [x] `SUPABASE_ACCESS_TOKEN` + `SUPABASE_DB_PASSWORD` + project ref (db push)
- [x] `PROJECT_TOKEN` PAT (`project` scope) for board writes
- [x] Reconcile hosted Supabase migration history before first `db push` (see Out-of-scope/risks)

### Workstream 0/5 — Doc fixes
- [x] `github-workflow.md`: `bodpl`→`gos-tomek`; add `done` status row (`fe521554`) — 03a6537
- [x] `infrastructure.md`: Approval/Rollback/Out-of-Scope → PR-gated auto-deploy posture — 03a6537
- [x] `tech-stack.md`: `cloudflare-pages` → Workers + `wrangler deploy` — 03a6537
- [x] `deployment-plan.md`: append realized CI/CD automation — 03a6537

### Workstream 3 — CI/CD pipeline
- [x] `ci.yml`: scope to PR + non-`main` pushes; stable `ci` check; add `wrangler deploy --dry-run` — 03a6537
- [x] `deploy.yml` (new): build → `db push` → `wrangler-action` deploy → smoke check (with retry) → board update — 03a6537

### Workstream 2 — Force branching
- [x] `CLAUDE.md`: top-of-file "Git workflow" section (branch-per-change, PR-only, agent never deploys, expand/contract) — 03a6537

### Workstream 1 — Branch protection
- [x] Apply `main` ruleset via `gh api` — **SKIPPED**: GitHub Free plan blocks rulesets and branch-protection API on private repos (403). CLAUDE.md rule (WS2) is the only guard; revisit if repo goes public or plan upgrades.

### Verification (from Verification section)
- [x] Direct `git push origin main` rejected — SKIPPED (GitHub Free; no branch protection available)
- [x] CI gate: `validate` job passed on PR #12; `wrangler --dry-run` step ran clean
- [x] Merge → `deploy.yml`: `db push` = "Remote database is up to date" (idempotent); `wrangler deploy` published (Version ID: `4b3eb92e-13f3-45ba-8a54-91257fdd685d`)
- [x] Smoke check: HTTP 200 on attempt 1; negative scenarios (failing migration / failing smoke) not exercised but exit paths are in code
- [x] Linked issue → Status `done`, closed, version-ID/URL comment posted — deferred; board update step verified working (logs clean skip for non-PR commits); will self-verify on first feature PR with `Closes #N`
- [x] `wrangler rollback <prev-version-id>` confirmed available (does not revert DB) — 5 versions visible in `wrangler deployments list`; previous version `e5d69db0` is the rollback target
