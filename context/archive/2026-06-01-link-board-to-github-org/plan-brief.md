# Link Board to GitHub Org — Plan Brief

> Full plan: `context/changes/link-board-to-github-org/plan.md`
> Frame brief: `context/changes/link-board-to-github-org/frame.md`
> Research: `context/changes/link-board-to-github-org/research.md`

## What & Why

Board creation currently captures only a name — but a board without GitHub data is useless. Users arrive ready to configure, so GitHub integration (PAT + repo selection) must be part of the creation flow, not a separate step. The actual problem: minimizing time-to-value for board creation while collecting GitHub integration data (PAT + repos) as a mandatory part of the flow.

## Starting Point

A single-field form (`CreateBoardForm.tsx`) POSTs a board name via native HTML form submission. GitHub infrastructure from F-02 is fully built but disconnected: PAT encryption RPCs, `github_repos` table with RLS, Octokit factory, and sync service all exist. The board detail page has a "Coming soon (S-02)" placeholder where linked repos should appear.

## Desired End State

A logged-in user completes a 2-screen wizard: screen 1 collects board name + PAT (validated inline, showing "@username"), screen 2 shows a searchable repo picker + manual entry for public repos. Clicking "Create Board" stores everything and redirects to the board page, which now displays linked repos instead of the placeholder.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| PAT type | Classic only (MVP) | Fine-grained PATs can't span multiple orgs and block outside collaborators | Research |
| Screen count | 2 screens, not 3 | Industry norm is 2 (connect → pick repos); 3 adds friction with no benefit | Frame |
| Repo selection | API picker + manual entry | Picker covers user's repos; manual entry allows any accessible public repo | Plan |
| Repo filtering | Client-side on fetched results | Simple, instant search after load; acceptable for one-time setup with <500 repos | Plan |
| GitHub identity storage | Don't store (MVP) | Octokit doesn't need it; display comes from validate-pat response during creation | Plan |
| API structure | 3 separate endpoints | validate-pat, repos, validate-repo — clean separation, each independently testable | Plan |
| Form architecture | fetch() + useState | Native POST can't do async mid-flow; aligns with lessons.md rule on useFormStatus | Research |
| Back navigation | Preserve all state | No lost work; re-validate PAT only if token changes | Plan |
| First sync | Out of scope | PAT + repos stored; sync trigger is separate work | Plan |
| Schema migration | None needed | All tables and RPCs already exist from F-02 | Research |

## Scope

**In scope:**
- 3 new API routes (validate-pat, repos, validate-repo)
- Refactor POST /api/boards from FormData to JSON
- 2-screen creation form (name+PAT → repo picker+manual add)
- Board detail page: replace S-02 placeholder with linked repos

**Out of scope:**
- IC/contributor selection (S-04)
- Sync trigger during/after creation
- Fine-grained PAT support
- GitHub username storage on boards table
- OAuth / GitHub App flow

## Architecture / Approach

The form uses `fetch()` for all API communication (no native POST). Screen 1 validates the PAT asynchronously via `POST /api/github/validate-pat` (calls GitHub `GET /user`). On "Next", screen 2 fetches repos via `POST /api/github/repos` (paginates `GET /user/repos`). Manual entry validates via `POST /api/github/validate-repo`. Final submission sends name + PAT + repos to the refactored `POST /api/boards`, which orchestrates: board insert → PAT storage (existing RPC) → repo linking (existing table). All 3 GitHub endpoints create temporary Octokit instances from the raw PAT since the board doesn't exist yet.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. GitHub API Routes | 3 new endpoints independently testable via API | Temporary Octokit pattern — must export `makeOctokit` |
| 2. Form Architecture Refactor | Multi-step skeleton with fetch(), working name-only creation | Native POST → fetch migration; error handling pattern change |
| 3. Screen 1: Name + PAT | PAT input with inline async validation, "@username" display | Debounce/UX timing for validation feedback |
| 4. Screen 2: Repo Picker | Searchable picker + manual entry, full creation flow | Pagination latency for users with many repos |
| 5. Board Detail: Linked Repos | S-02 placeholder replaced with real repo list | Legacy boards (pre-change) need graceful fallback |

**Prerequisites:** Valid GitHub classic PAT for manual testing; running local Supabase instance
**Estimated effort:** ~3–4 implementation sessions across 5 phases

## Open Risks & Assumptions

- PAT storage or repo linking could fail after board creation (no cross-RPC transaction) — acceptable for MVP
- Users with 500+ repos may experience 2–3 second load time on screen 2 — mitigated by loading state
- Classic PAT `repo` scope is over-permissive (read+write); GitGud only reads — documented in help text

## Success Criteria (Summary)

- User can create a board with GitHub PAT + selected repos in a 2-screen flow
- Board detail page shows linked repos instead of "Coming soon (S-02)"
- PAT is stored encrypted, ready for future sync operations
