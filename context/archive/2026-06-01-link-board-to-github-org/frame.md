# Frame Brief: Board Creation with GitHub Integration

> Framing step before /10x-plan. This document captures what is _actually_
> at issue, separated from what was initially assumed.

## Reported Observation

The current board creation form (`src/components/CreateBoardForm.tsx`) only captures a board name. For the "link board to GitHub org" feature, the form needs to also collect a GitHub PAT and repo selections. The user wants to design the full creation flow before planning implementation.

## Initial Framing (preserved)

- **User's stated cause or approach**: A 3-step wizard — Screen 1: board name + PAT, Screen 2: add one or more repo links, Screen 3: choose IC contributors from repos.
- **User's proposed direction**: Refactor existing single-field form into a multi-step flow. Contributor selection is conceptually part of the flow but will be a separate implementation change.
- **Pre-dispatch narrowing**: Primary concerns are UX flow and technical feasibility (not scope slicing). Contributors = repo collaborators (users with explicit access via GitHub API). PAT is stored permanently for ongoing sync. IC selection is separate work — we need a high-level concept for it here, not implementation.

## Dimension Map

The observation could originate at any of these dimensions:

1. **UX pattern** — Is a 3-screen wizard the right interaction pattern, or would fewer screens with progressive disclosure be faster? ← user's current framing
2. **Data dependency chain** — Steps have hard dependencies (PAT → validate → fetch repos → fetch collaborators). This chain constrains which UX patterns are viable and how screens can be parallelized.
3. **PAT trust barrier** — Collecting a PAT (which grants read/write to all private repos) early in the flow creates friction. Where in the flow it appears affects conversion.
4. **Repo selection method** — User proposed "add links to repos" (manual URL entry). The GitHub API supports `GET /user/repos` for listing all accessible repos — a picker would be superior UX.

## Hypothesis Investigation

| Hypothesis                                        | Evidence                                                                                                                                                                                                                                                                                                                      | Verdict                                                                                                     |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **UX: 3-screen wizard is right**                  | No existing wizard in codebase; all forms use single-page POST-redirect (`CreateBoardForm.tsx`, `SignUpForm.tsx`, `SignInForm.tsx`); only Button component from shadcn/ui installed — would need Stepper/Tabs/Dialog infrastructure. Cross-system: Vercel/Netlify/CodeClimate use 2-step flows (connect → pick repos), not 3. | **WEAK** — feasible but adds friction vs. fewer screens; 3 screens is one more than industry norm           |
| **Dependency chain: bundle into one atomic flow** | Schema separates operations: `boards` table (name+owner), `set_board_github_pat()` RPC (separate call), `github_repos` (separate table via FK). `createBoard()` service only handles name (`src/lib/services/boards.ts:33-47`). Chain is hard: PAT must validate before repos can be fetched.                                 | **STRONG** — dependencies are real and sequential, but data layer supports both bundled and separated flows |
| **PAT trust: upfront collection is fine**         | User confirmed: board without GitHub = broken onboarding, users arrive ready to configure. Trust barrier is mitigated by intent — users expect to provide credentials. Encryption infrastructure already exists (`github_pat_encrypted bytea`, pgcrypto, `GITHUB_TOKEN_ENCRYPTION_KEY`).                                      | **STRONG** for early PAT — user intent aligns with upfront collection                                       |
| **Repo selection: manual URL entry**              | `GET /user/repos` returns all accessible repos with pagination (max 100/page). Latency ~50-150ms per page from Cloudflare Workers. An API-driven picker is both feasible and superior to manual URL entry. Required scope: `repo` (classic PAT).                                                                              | **STRONG** against manual URLs — picker is clearly better UX                                                |

## Narrowing Signals

- **Board without GitHub = broken onboarding** — the user explicitly ruled out "create board, configure later." Integration MUST be part of creation. This validates the wizard direction over create-then-configure.
- **"Quick as possible"** — the user wants minimal friction. This pressures the 3-screen count downward. Each screen transition adds perceived latency.
- **PAT validation is fast** (~50-150ms via `GET /user`) — can happen asynchronously, doesn't need its own screen or blocking step.
- **Collaborator listing requires push access** — `GET /repos/{owner}/{repo}/collaborators` returns 403 unless the PAT user has push/maintain/admin on the repo. This is a constraint for the separate IC-selection work.

## Cross-System Convention

Vercel, Netlify, CodeClimate, Codecov: when the integration IS the product, the pattern is **connect account → pick repos → done** (2 steps). The project/deployment is an outcome of repo selection. These tools use API-driven repo pickers, not manual URL entry. None use a 3-step wizard for this.

GitGud differs: a board spans multiple repos and has an independent name, so repo selection doesn't create the board — it configures it. But the core insight holds: minimize steps between "I want this" and "I can see my data."

## Reframed (or Confirmed) Problem Statement

> **The actual problem to plan around is**: minimizing time-to-value for board creation while collecting GitHub integration data (PAT + repos) as a mandatory part of the flow — with the constraint that the PAT→repos dependency chain is sequential and the repo selection should be API-driven, not manual URL entry.

The user's core framing — GitHub integration during board creation, not after — is **correct**. A board without GitHub data is useless, and users arrive ready to configure. The reframe is narrower: **the 3-screen wizard adds one screen more than evidence supports, and manual repo URL entry should be replaced by an API-driven picker.** The PAT→repos dependency chain means validation must precede repo selection, but PAT validation is fast enough (~150ms) to happen inline without a dedicated screen. The plan should optimize for speed and progressive disclosure within the fewest screens that the dependency chain allows.

The contributor selection step (Screen 3 in the original proposal) is confirmed as separate work — the high-level concept is: after repos are linked, present a multi-select of repo collaborators (fetched via `GET /repos/{owner}/{repo}/collaborators`), constrained to repos where the PAT user has push access.

## Confidence

- **HIGH** — strong evidence from data layer architecture, GitHub API capabilities, cross-system patterns, and user's own narrowing signals. The reframe is modest (screen count + picker vs URLs), not a fundamental direction change.

## What Changes for /10x-plan

Plan should design a fast, dependency-aware creation flow that collects name + PAT + repo selections. Key inputs for the plan: (1) use API-driven repo picker instead of manual URL entry, (2) explore 2-screen or progressive-disclosure patterns rather than 3 screens, (3) leverage async PAT validation to reduce perceived latency, (4) existing encryption infrastructure (`set_board_github_pat` RPC, `github_repos` table) is already in place. Contributor selection is out of scope — document the high-level concept only.

## References

- Source files: `src/components/CreateBoardForm.tsx`, `src/pages/boards/new.astro`, `src/pages/api/boards/index.ts`, `src/lib/services/boards.ts:33-47`
- Migrations: `supabase/migrations/20260529120000_access_control_and_membership.sql`, `supabase/migrations/20260531100000_github_ingestion_access.sql`
- Encryption: `set_board_github_pat()` / `get_board_github_pat()` RPC functions, `GITHUB_TOKEN_ENCRYPTION_KEY` env secret
- GitHub API: `GET /user` (PAT validation), `GET /user/repos` (repo listing, `repo` scope), `GET /repos/{owner}/{repo}/collaborators` (requires push access)
- Cross-system: Vercel, Netlify, CodeClimate onboarding flows (2-step: connect → pick repos)
