---
project: GitGud
version: 1
status: draft
created: 2026-05-27
updated: 2026-05-27
prd_version: 1
main_goal: market-feedback
top_blocker: skills
---

# Roadmap: GitGud

> Derived from `context/foundation/prd.md` (v1) + auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Vision recap

Mentoring, code-review quality, and unblocking — the "glue work" that keeps engineering teams healthy — is invisible to tools that measure throughput (DORA, cycle time). GitGud surfaces the semantic layer instead: not how much code shipped, but who unblocked a peer, whose review comment shaped an architecture decision. The product **wedge** — the one trait that, if removed, makes GitGud indistinguishable from a generic activity counter — is that review comments are classified by *intent* (mentoring, architecture, bug-catch, nitpick, unblocking, question), shown transparently to the IC whose work they describe, never used to rank people against each other.

## North star

**S-05: An IC sees their own review comments broken down by semantic category** — the smallest end-to-end slice whose successful delivery proves the core hypothesis (that classifying glue work by intent is valuable and trustworthy to the person it describes), placed as early as its Prerequisites allow because everything else only matters if this resonates.

> "North star" here means the validation milestone: ship this one flow first and you learn whether the product's central bet holds. It is currently `blocked` — it inherits PRD Open Question 1 (classification-accuracy validation), which must resolve before it can be planned. The path to it runs through F-01 + F-02 → F-03.

## At a glance

| ID    | Change ID                       | Outcome (user can …)                                              | Prerequisites      | PRD refs                                  | Status   |
| ----- | ------------------------------- | ----------------------------------------------------------------- | ------------------ | ----------------------------------------- | -------- |
| F-01  | access-control-and-membership   | (foundation) IC/EM roles, board + membership, RLS on present auth | —                  | Access Control, FR-014, FR-015, FR-016    | ready    |
| F-02  | github-ingestion-access         | (foundation) authenticated read of an org's PRs/reviews/comments  | —                  | FR-002, FR-009, FR-010, FR-011, US-01     | ready    |
| F-03  | classification-batch            | (foundation) daily durable batch classifies comments by intent    | F-01, F-02         | FR-012, Business Logic, NFR accuracy-floor | blocked  |
| S-01  | board-create-with-em-role       | create a board and be explicitly assigned the EM role             | F-01               | FR-001, FR-016, FR-017                    | proposed |
| S-02  | link-board-to-github-org        | link a board to a GitHub org so its activity feeds the board      | S-01, F-02         | FR-002, US-01                             | proposed |
| S-03  | invite-and-join-board           | invite ICs by email; IC joins via invite link                     | S-01, F-01         | FR-003, FR-004, FR-005, FR-014, FR-015    | proposed |
| S-04  | profile-raw-github-metrics      | view a contribution profile: PRs, reviews, comment counts         | F-02, S-02, S-03   | FR-006, FR-008, FR-009, FR-010, FR-011, NFR progressive-load, NFR data-parity | proposed |
| S-05  | profile-classified-comments     | see own review comments broken down by semantic category          | F-03, S-04         | FR-012, Business Logic, NFR accuracy-floor, NFR data-parity | blocked  |
| S-06  | em-switch-ic-dropdown           | switch between ICs on a board without a full page reload          | S-04               | FR-007, US-01                             | proposed |
| S-07  | flag-classification-inaccurate  | flag a comment's assigned category as inaccurate                  | S-05               | FR-013                                    | blocked  |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme                  | Chain                                  | Note                                                                       |
| ------ | ---------------------- | -------------------------------------- | -------------------------------------------------------------------------- |
| A      | Access & membership    | `F-01` → `S-01` → `S-03`               | Conventional, low-risk track; produces the IC accounts the north star needs. |
| B      | GitHub data & profile  | `F-02` → `S-02` → `S-04` → `S-06`      | `S-04` joins Stream A at `S-03` (needs memberships). De-risks the #1 blocker first. |
| C      | Classification (wedge) | `F-03` → `S-05` → `S-07`               | `F-03` needs `F-01`+`F-02`; `S-05` joins Stream B at `S-04`. Blocked on Q1.  |

## Baseline

What's already in place in the codebase as of `2026-05-27` (auto-researched + user-confirmed).
Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** present — Astro 6 SSR + React 19 islands + Tailwind 4 + shadcn/ui (new-york); layout, index, dashboard, auth forms (`src/pages/`, `src/components/`).
- **Backend / API:** partial — auth API routes only (`src/pages/api/auth/{signin,signup,signout}.ts`); no domain endpoints (board, profile, sync) and `src/types.ts` is empty.
- **Data:** absent — no migrations (`supabase/migrations/` does not exist), only `supabase/config.toml`. No board / membership / profile / classification tables.
- **Auth:** present — Supabase SSR cookie auth (`src/lib/supabase.ts`, `src/middleware.ts`, `PROTECTED_ROUTES=["/dashboard"]`); email+password sign-up / login / logout. Missing: IC/EM role model and invite flow.
- **Deploy / infra:** present but manual — `@astrojs/cloudflare` adapter + `wrangler.jsonc`; deploys done by hand from local (`wrangler deploy`). A CI workflow file (`.github/workflows/ci.yml`) exists in the repo but GitHub Actions is not yet configured/active. No batch / Workflow / Cron Trigger.
- **Observability:** absent — no logging / error-tracking / metrics library wired.

## Foundations

### F-01: Access control & board membership

- **Outcome:** (foundation) IC/EM roles, board and membership entities, and per-operation RLS land on top of the existing email+password auth; a user's role is explicit, not silent.
- **Change ID:** access-control-and-membership
- **PRD refs:** Access Control, FR-014, FR-015, FR-016
- **Unlocks:** S-01, S-03, S-04 (via memberships), F-03
- **Prerequisites:** — (builds on auth reported `present` in Baseline)
- **Parallel with:** F-02
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Conventional Supabase schema + RLS work; low risk. Sequenced first because it has the highest fan-out of any ready item and the north star needs IC accounts to exist.
- **Status:** ready

### F-02: GitHub org ingestion access

- **Outcome:** (foundation) the app can authenticate to a linked GitHub org and read its PRs, reviews, and review comments.
- **Change ID:** github-ingestion-access
- **PRD refs:** FR-002, FR-009, FR-010, FR-011, US-01
- **Unlocks:** S-02, S-04, F-03
- **Prerequisites:** —
- **Parallel with:** F-01
- **Blockers:** —
- **Unknowns:**
  - How does the app authenticate to a GitHub org given MVP auth is email+password with no OAuth? (recommended default: GitHub App install or fine-grained PAT supplied at board-link time) — Owner: user. Block: no.
- **Risk:** First exposure to the #1 blocker (`skills`): GitHub client behavior on the Cloudflare workerd runtime (Octokit / pagination edges surface only in prod). De-risked early on purpose — prefer a fetch-based client, test on workerd before building on top.
- **Status:** ready

### F-03: Daily classification batch (Cron + Workflow + hosted AI)

- **Outcome:** (foundation) a daily durable batch paginates org data and classifies each review comment into one semantic category via a hosted AI API, storing category labels only — never raw comment content.
- **Change ID:** classification-batch
- **PRD refs:** FR-012, Business Logic, NFR accuracy-floor
- **Unlocks:** S-05 (north star)
- **Prerequisites:** F-01, F-02
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - Classification-accuracy validation method + minimum threshold before launch (PRD Open Question 1; Discovery noted LLMs lag humans 12–23% on intent) — Owner: user. Block: yes.
  - Hosted-model privacy mitigation: pick a provider with a no-training / no-retention data policy, persist no raw comment text, keep the classifier swappable for a future local model — Owner: user. Block: no.
- **Risk:** This is the `skills` blocker made concrete — Cloudflare Workflows durable-execution semantics (idempotent steps, retries) are a new programming model, and the accuracy guardrail gates launch. Highest-risk foundation; build the batch as a Workflow from day one rather than a single request.
- **Status:** blocked

## Slices

### S-01: EM creates a board and is assigned the EM role

- **Outcome:** A user can create a board, see they are explicitly assigned the EM role at creation, and own more than one board.
- **Change ID:** board-create-with-em-role
- **PRD refs:** FR-001, FR-016, FR-017
- **Prerequisites:** F-01
- **Parallel with:** F-02
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Role auto-assignment must be explicit (confirmation/label), not silent — surfaced by FR-016's resolution. Otherwise conventional CRUD.
- **Status:** proposed

### S-02: EM links a board to a GitHub org

- **Outcome:** An EM can link their board to a GitHub org so the org's activity feeds the board's profiles.
- **Change ID:** link-board-to-github-org
- **PRD refs:** FR-002, US-01
- **Prerequisites:** S-01, F-02
- **Parallel with:** S-03
- **Blockers:** —
- **Unknowns:**
  - Confirm the chosen GitHub access mechanism from F-02 is exercised here (install vs PAT capture UX) — Owner: user. Block: no.
- **Risk:** Org-level link can flood profiles with unrelated repos; PRD accepts this for v1 (repo filtering is v2). Sequenced after F-02 because it consumes the ingestion access.
- **Status:** proposed

### S-03: EM invites ICs; IC joins via invite link

- **Outcome:** An EM invites an IC by email; the IC creates an account via the invite link, logs in, and is automatically added to the board (and can belong to several boards).
- **Change ID:** invite-and-join-board
- **PRD refs:** FR-003, FR-004, FR-005, FR-014, FR-015
- **Prerequisites:** S-01, F-01
- **Parallel with:** S-02
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Invite link + implicit consent on account creation (per FR-004 resolution) — no separate acceptance gate. Builds on the present sign-up/login scaffold.
- **Status:** proposed

### S-04: Contribution profile shows raw GitHub metrics

- **Outcome:** An IC can open their own contribution profile (and an EM can open any board IC's) and see PRs authored, code reviews given, and review comment counts sourced from GitHub — with progressive load (each section renders when ready) and identical data for IC and EM views.
- **Change ID:** profile-raw-github-metrics
- **PRD refs:** FR-006, FR-008, FR-009, FR-010, FR-011, NFR progressive-load, NFR data-parity
- **Prerequisites:** F-02, S-02, S-03
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - Empty-state copy when an IC has no GitHub activity in the period (US-01 acceptance criterion) — Owner: user. Block: no.
- **Risk:** First user-visible payoff of the GitHub ingestion. Progressive-load NFR means the view must not block on full data; respect it from the start.
- **Status:** proposed

### S-05: Contribution profile shows semantically classified comments

- **Outcome:** An IC can see their own review comments broken down by semantic category (mentoring, architecture, bug-catch, nitpick, unblocking, question) — the same breakdown an EM sees for that profile — with click-through to per-comment labels.
- **Change ID:** profile-classified-comments
- **PRD refs:** FR-012, Business Logic, NFR accuracy-floor, NFR data-parity
- **Prerequisites:** F-03, S-04
- **Parallel with:** S-06
- **Blockers:** —
- **Unknowns:**
  - Classification-accuracy validation method + minimum threshold must be met before this view ships (inherits PRD Open Question 1) — Owner: user. Block: yes.
- **Risk:** The north star and the product wedge. Misclassification is "worse than no classification" (FR-012) — this view must not ship until the accuracy guardrail is validated.
- **Status:** blocked

### S-06: EM switches between ICs via a dropdown

- **Outcome:** An EM can switch between ICs on a board via a dropdown, loading the selected IC's profile without a full page reload.
- **Change ID:** em-switch-ic-dropdown
- **PRD refs:** FR-007, US-01
- **Prerequisites:** S-04
- **Parallel with:** S-05
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Pure client-side navigation over data S-04 already provides; low risk. Independent of the classification track, so it can proceed while S-05 is blocked.
- **Status:** proposed

### S-07: IC flags a classified comment as inaccurate

- **Outcome:** An IC can flag a comment's assigned category as inaccurate, and the signal is captured for action.
- **Change ID:** flag-classification-inaccurate
- **PRD refs:** FR-013
- **Prerequisites:** S-05
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - What constitutes the correction-signal pathway that must exist before FR-013 ships? FR-013 must not ship as standalone UI without a pathway to act on flags (PRD Open Question 2) — Owner: user. Block: yes.
- **Risk:** Nice-to-have, dependency-constrained. Delivers the secondary success criterion (IC can signal agreement/correction), but only once a correction-signal pathway exists.
- **Status:** blocked

## Backlog Handoff

| Roadmap ID | Change ID                       | Suggested issue title                                      | Ready for `/10x-plan` | Notes |
| ---------- | ------------------------------- | ---------------------------------------------------------- | --------------------- | ----- |
| F-01       | access-control-and-membership   | Access control: IC/EM roles, boards & membership with RLS  | yes                   | Highest fan-out ready item |
| F-02       | github-ingestion-access         | GitHub org ingestion access (read PRs/reviews/comments)    | yes                   | De-risks the workerd/GitHub-client unknown early |
| F-03       | classification-batch            | Daily classification batch (Cron + Workflow + hosted AI)   | no                    | Blocked on Q1 (accuracy validation) |
| S-01       | board-create-with-em-role       | EM creates a board and is assigned the EM role             | no                    | Needs F-01 |
| S-02       | link-board-to-github-org        | Link a board to a GitHub org                               | no                    | Needs S-01, F-02 |
| S-03       | invite-and-join-board           | Invite ICs by email; IC joins via invite link             | no                    | Needs S-01, F-01 |
| S-04       | profile-raw-github-metrics      | Contribution profile: PRs, reviews, comment counts         | no                    | Needs F-02, S-02, S-03 |
| S-05       | profile-classified-comments     | Contribution profile: semantically classified comments     | no                    | North star; blocked on Q1 via F-03 |
| S-06       | em-switch-ic-dropdown           | EM switches between ICs via dropdown (no full reload)      | no                    | Needs S-04 |
| S-07       | flag-classification-inaccurate  | IC flags a classified comment as inaccurate                | no                    | Blocked on Q2 |

## Open Roadmap Questions

1. **Classification-accuracy validation method + minimum threshold before launch.** — Owner: user. Block: F-03, S-05. (PRD Open Question 1; Discovery noted LLMs lag humans 12–23% on developer intent.)
2. **What constitutes the correction-signal pathway that unlocks FR-013 for shipping?** — Owner: user. Block: S-07. (PRD Open Question 2.)
3. **GitHub org access mechanism given no OAuth in MVP** (GitHub App install vs fine-grained PAT). — Owner: user. Block: roadmap treats as non-blocking; resolve during F-02 planning.
4. **Hosted-model privacy mitigation.** Sending raw comment text to a third-party LLM conflicts with the no-retention guardrail; settle provider data policy and keep the classifier swappable for a future local model. — Owner: user. Block: roadmap-wide (non-blocking, but must be settled before F-03 ships).
5. **Expected request rate (qps ballpark).** — Owner: user. Block: no. (PRD Open Question 3; `target_scale.qps` still TODO.)
6. **Expected data-volume ballpark.** — Owner: user. Block: no. (PRD Open Question 4; `target_scale.data_volume` still TODO.)
7. **Additional user stories beyond US-01?** IC self-evaluation, EM board-setup, and IC correction flows each likely warrant their own story. — Owner: user. Block: no. (PRD Open Question 5.)

## Parked

- **No Jira integration in v1.** — Why parked: PRD §Non-Goals; GitHub-only until the GitHub profile is validated.
- **No IC ranking or comparative views.** — Why parked: PRD §Non-Goals; the absence of comparison is the design constraint that makes the tool safe to use transparently.
- **No real-time data sync.** — Why parked: PRD §Non-Goals; profile reflects data as of the last fetch.
- **Local, open-source classification model.** — Why parked: decided 2026-05-27 to use a hosted API in the MVP to reduce scope; local model deferred to a future version (privacy upside tracked as Open Roadmap Question 4).
- **GitHub repo-level filtering on a linked org.** — Why parked: PRD FR-002 resolution defers repo filtering to v2.

## Done

(Empty on first generation. `/10x-archive` appends entries here when a change whose Change ID matches a roadmap item is archived.)
