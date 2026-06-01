---
date: "2026-06-01T10:15:13Z"
researcher: Claude
git_commit: f194d98
branch: link-board-to-github-org
repository: gos-tomek/gitgud
topic: "Pre-implementation research for link-board-to-github-org: existing infrastructure, PAT scopes, collaborator constraints"
tags: [research, codebase, github-api, pat, collaborators, board-creation]
status: complete
last_updated: "2026-06-01"
last_updated_by: Claude
last_updated_note: "Decision: add shadcn/ui components (Checkbox, Badge, Card, Skeleton, Input) for 2-screen form"
---

# Research: Pre-Implementation Details for Link Board to GitHub Org

**Date**: 2026-06-01T10:15:13Z
**Researcher**: Claude
**Git Commit**: f194d98
**Branch**: link-board-to-github-org
**Repository**: gos-tomek/gitgud

## Research Question

Three pre-implementation questions from the frame brief:
1. What does the existing GitHub infrastructure already do, and what's reusable vs new?
2. What PAT type and scopes should we recommend to users?
3. How does the collaborator push-access constraint affect the repo picker and IC selection?

## Summary

1. **Existing infrastructure is comprehensive and fully reusable.** The F-02 change built: Octokit client factory with retry/rate-limit hooks, PAT encryption/decryption via SECURITY DEFINER functions, `github_repos` table with RLS, and a sync service for PRs/reviews/comments. The board creation flow needs zero duplication — it adds UI, PAT validation, and a repo picker on top of existing infrastructure.

2. **Classic PAT only for MVP.** Fine-grained PATs have two hard blockers: they cannot span multiple orgs (one token per org), and outside collaborators cannot use them. Minimum scopes: `repo` + `read:org`. The codebase is token-type-agnostic — no code changes needed to use classic PATs.

3. **Collaborator listing requires push access, but this doesn't block the repo picker.** `GET /user/repos` returns a `permissions.push` boolean per repo — the picker can badge read-only repos at zero extra API cost. PR sync works with read access, so all repos are valid for the board's core purpose. Collaborator listing is only needed for the separate IC selection feature.

## Detailed Findings

### 1. Existing GitHub Infrastructure Scope

#### What's already built (F-02, fully shipped)

| Component | File | What it does |
| --- | --- | --- |
| Octokit factory | `src/lib/github.ts` | `createGitHubClient(supabase, boardId)` — decrypts stored PAT via RPC, returns Octokit with retry plugin + rate-limit hooks |
| Error classes | `src/lib/github.ts:11-32` | `GitHubTokenMissingError`, `GitHubRateLimitError`, `GitHubAuthError` |
| Sync service | `src/lib/services/github-sync.ts` | `syncBoardGitHubData(supabase, boardId, since?)` — fetches PRs → reviews → comments for all linked repos, upserts to DB. Returns `SyncResult` with counts. |
| Sync API route | `src/pages/api/github/sync.ts` | `POST /api/github/sync` — triggers sync for a board (requires board owner auth) |
| PAT encryption | migration `:111-145` | `set_board_github_pat()` / `get_board_github_pat()` SECURITY DEFINER functions using pgcrypto |
| Schema | migration `:5-72` | `boards.github_pat_encrypted bytea`, `github_repos`, `github_pull_requests`, `github_reviews`, `github_review_comments` tables with full RLS |
| Types | `src/types.ts:12-60` | `GitHubRepo`, `GitHubPullRequest`, `GitHubReview`, `GitHubReviewComment` interfaces |
| Env var | `astro.config.mjs` | `GITHUB_TOKEN_ENCRYPTION_KEY` server-side secret |
| Dependencies | `package.json` | `@octokit/rest@^22.0.1`, `@octokit/plugin-retry@^8.1.0` |

#### What the board creation flow reuses directly

```
PAT storage:     supabase.rpc("set_board_github_pat", { p_board_id, p_raw_token, p_encryption_key })
PAT retrieval:   createGitHubClient(supabase, boardId) → Octokit instance
Repo linking:    supabase.from("github_repos").insert({ board_id, repo_owner, repo_name, connected_by })
Initial sync:    syncBoardGitHubData(supabase, boardId)
```

#### What's new (must be built)

| Component | Purpose |
| --- | --- |
| PAT validation endpoint | `GET /user` via Octokit to verify token works before storing |
| Repo listing | `octokit.rest.repos.listForAuthenticatedUser()` — not yet called anywhere |
| Repo picker UI | React component with search/filter, permission badges |
| Multi-step form | Board name + PAT + repo selection in a progressive flow |
| API route for PAT validation | Server-side endpoint that validates a PAT and returns user info + repos |
| API route for repo listing | Server-side endpoint that returns paginated repos for a validated PAT |

#### UI placeholders waiting for this change

`src/pages/boards/[id].astro:40-47` has two placeholder stubs:
- "Linked GitHub org" → "Coming soon (S-02)" — this change replaces it
- "Contribution profiles" → "Coming soon (S-04)" — separate change

### 2. PAT Scope Guidance

#### The codebase is token-type-agnostic

Zero scope checking, zero token-type detection anywhere in the code. `makeOctokit()` at `src/lib/github.ts:34` takes a raw `token: string` and passes it to Octokit's `auth` parameter. No prefix check (`ghp_` vs `github_pat_`), no `x-oauth-scopes` header inspection.

The archived plan (`context/archive/2026-05-30-github-ingestion-access/plan.md:7`) says "fine-grained GitHub Personal Access Token" — a documentation assumption, not enforced in code.

#### Minimum scopes per operation

**Classic PAT:**

| Endpoint | Scope | Notes |
| --- | --- | --- |
| `GET /user` (validate) | None needed | Works with any valid token |
| `GET /user/repos` (list repos incl. private) | `repo` | No read-only alternative for private repos |
| `GET /repos/{owner}/{repo}/collaborators` | `repo` + `read:org` | Also requires user-level push access |
| `GET /repos/{owner}/{repo}/pulls` + reviews + comments | `repo` | Already used by sync service |

**Minimum classic PAT scopes: `repo` + `read:org`**

**Fine-grained PAT:**

| Endpoint | Permission | Notes |
| --- | --- | --- |
| `GET /user` | None | Works with any valid fine-grained PAT |
| `GET /user/repos` | None | Returns only repos in token scope |
| `GET /repos/{owner}/{repo}/collaborators` | `Metadata: read` | Still requires user-level push access |
| PRs + reviews + comments | `Pull requests: read` | Read-only, specific repos |

**Minimum fine-grained: `Pull requests: read` + `Metadata: read` (auto-granted)**

#### Decision: Classic PAT only for MVP

**Two hard blockers for fine-grained PATs:**

1. **Multi-org is impossible.** Fine-grained PATs are scoped to a single user or organization. GitGud boards span repos across multiple orgs. A user with repos in 3 orgs would need 3 separate fine-grained PATs. The current schema stores one PAT per board (`boards.github_pat_encrypted`). Supporting multiple tokens per board requires a schema change and significant UX complexity.

2. **Outside collaborators cannot use fine-grained PATs.** GitHub docs confirm: "Outside collaborators can only use personal access tokens (classic) to access organization repositories that they are a collaborator on." GitHub roadmap issue #601 targets Q3 2025 for GA fix — not yet shipped as of this research date. EMs who are outside collaborators on repos (common in consulting, contracting, multi-team setups) simply cannot use fine-grained PATs.

**Additional friction for fine-grained:**
- Mandatory expiration (org-configurable, default max 366 days) — when token expires, sync silently breaks. No infrastructure exists for expiry tracking or proactive warnings.
- Org approval flow — tokens may be pending admin approval and only access public resources, creating confusing partial-access failures during onboarding.

**Classic PAT tradeoffs:**
- `repo` scope is over-permissive (read+write to ALL user repos). GitGud only reads. This is a known GitHub limitation with no read-only alternative for classic PATs.
- No mandatory expiration — simpler operations, but user may forget to rotate.

#### Token-type detection for future-proofing

Classic PATs start with `ghp_`, fine-grained start with `github_pat_`. Prefix-based detection at input time can warn users who paste a fine-grained token:

> "Fine-grained tokens cannot access repos across multiple organizations. Please use a Classic token instead."

#### Recommended UX copy

**Label:** "GitHub Personal Access Token"

**Help text:**
> Create a [Classic Personal Access Token](https://github.com/settings/tokens/new) with these scopes:
> - **repo** (Full control of private repositories)
> - **read:org** (Read org membership)
>
> This token is used to read pull requests, reviews, and collaborators from your repos. GitGud never writes to your repositories.

**Validation behavior:**
- Token starts with `github_pat_` → warning: "Fine-grained tokens can't access repos across multiple organizations. Use a Classic token."
- Token starts with `ghp_` → proceed to `GET /user` validation
- `GET /user` returns 401 → "This token is invalid or expired."
- `GET /user` returns 200 → show authenticated GitHub username as confirmation

### 3. Collaborator Push-Access Constraint

#### Confirmed: push access required for collaborator listing

`GET /repos/{owner}/{repo}/collaborators` requires the **user** (not just the token) to have push/maintain/admin access on the repo.

- **Public repos without push access:** returns `403 Forbidden` with message "Must have push access to view collaborator permission."
- **Private repos without push access:** returns `404 Not Found` (GitHub hides repo existence).
- **Org repos:** additionally require org membership.
- Applies equally to classic and fine-grained PATs — it's a user-level check, not a token-scope check.

#### `GET /user/repos` provides the signal for free

Each repo in the `GET /user/repos` response includes a `permissions` object:

```json
{
  "permissions": {
    "admin": false,
    "maintain": false,
    "push": true,
    "triage": false,
    "pull": true
  }
}
```

`permissions.push === true` means collaborator listing will work for that repo. This is available at zero extra API cost during repo listing — the picker can badge repos without any additional calls.

#### Impact on the repo picker (this change)

**All repos are valid for the board's core purpose.** PR sync (`GET /repos/{owner}/{repo}/pulls`) only needs read access. The push-access constraint only affects collaborator listing, which is a separate feature (IC selection).

**Recommendation: show all repos, badge read-only ones.**
- Show all accessible repos from `GET /user/repos`
- Check `permissions.push` per repo
- Badge repos without push: "Read-only — collaborator listing unavailable"
- Allow selecting any repo regardless of push access

#### Impact on IC selection (separate change)

When the IC selection feature is built:
- Use stored `permissions.push` to pre-filter which repos can show collaborators
- Handle 403 gracefully — access can change after linking
- Distinguish "no push access" (403) from "bad PAT" (401) in error handling

**Codebase gap:** `src/lib/github.ts:57-63` catches 403 generically as `GitHubAuthError`. When collaborator listing is implemented, this needs refinement to distinguish "bad PAT" from "insufficient repo permissions."

#### Schema consideration

`github_repos` table has no column for permission level. Two options:
- **Option A:** Add `has_push_access boolean` — store at connect time, refresh periodically
- **Option C (recommended for this change):** Don't store — check on-demand when IC selection is built. Keeps schema simple for the current scope.

## Code References

- `src/lib/github.ts:34-66` — `makeOctokit()` factory, rate-limit/error hooks
- `src/lib/github.ts:68-88` — `createGitHubClient()` PAT decryption + Octokit creation
- `src/lib/services/github-sync.ts:1-166` — Full sync service with pagination
- `src/pages/api/github/sync.ts:1-63` — Sync HTTP endpoint
- `src/lib/services/boards.ts:33-47` — `createBoard()` (name only, no GitHub)
- `src/pages/boards/[id].astro:40-47` — Placeholder stubs for S-02 and S-04
- `src/types.ts:12-20` — `GitHubRepo` interface
- `supabase/migrations/20260531100000_github_ingestion_access.sql:5-6` — `github_pat_encrypted bytea` column
- `supabase/migrations/20260531100000_github_ingestion_access.sql:10-18` — `github_repos` table schema
- `supabase/migrations/20260531100000_github_ingestion_access.sql:111-145` — PAT encrypt/decrypt functions
- `astro.config.mjs:21-26` — `GITHUB_TOKEN_ENCRYPTION_KEY` env schema

## Architecture Insights

1. **Token-agnostic design was a good call.** F-02 built infrastructure that works with any GitHub token type. The board creation flow can validate and recommend classic PATs without any changes to existing code.

2. **Separation of concerns is clean.** Board creation (`boards.ts`) → PAT storage (RPC) → repo linking (`github_repos` insert) → sync (`github-sync.ts`) are all independent operations. The multi-step form orchestrates them in sequence but each can fail independently with clear error handling.

3. **Octokit must be instantiated per-request.** `src/lib/github.ts:34` creates a new `OctokitWithRetry` per call to `createGitHubClient`. This is by design — workerd (Cloudflare Workers runtime) requires per-request instantiation, not module-level singletons. New code (PAT validation, repo listing) must follow the same pattern.

4. **The 403 error hook needs refinement.** `src/lib/github.ts:57-63` catches all 403s as `GitHubAuthError`. For the board creation flow (PAT validation) this is fine — a 403 on `GET /user` means the token is bad. But for future collaborator listing, 403 can mean "insufficient repo permissions" (not a token problem). The plan should either: (a) handle 403 at the call site before it reaches the hook, or (b) add context to the error.

## Historical Context (from prior changes)

- `context/archive/2026-05-30-github-ingestion-access/plan.md` — Original F-02 plan that built all GitHub infrastructure. Key decisions: repo-level linking (not org-level), no UI (deferred to S-02), encryption key as env var (not Supabase Vault), rate-limit throws instead of delays (better for Workers' 30s CPU limit).
- `context/archive/2026-05-30-github-ingestion-access/plan.md:7` — Says "fine-grained GitHub Personal Access Token" — this was a documentation-level assumption. Code is token-agnostic. Research recommends classic PAT for MVP due to multi-org and outside-collaborator blockers.
- `context/archive/2026-05-30-github-ingestion-access/plan.md:37-39` — Explicitly says "No UI — no form for entering the PAT, no repo picker, no profile view. S-02 owns the linking UX." This change IS S-02.
- `context/archive/2026-05-30-github-ingestion-access/plan.md:40` — Says "No org-level linking — the user decided on repo-level linking (repos specified by exact owner/name). Org-wide fetching and repo search/autocomplete are deferred." The frame brief now calls for an API-driven repo picker, which is the "repo search/autocomplete" that was deferred.

## Open Questions

1. **Should we store `token_type` and `github_user_id` on the board?** Prefix-based detection (`ghp_` vs `github_pat_`) can inform UX, and storing the GitHub user identity (`login` + `id` from `GET /user`) would let us display "Connected as @username" on the board detail page. This would require a schema addition (new columns on `boards` or a separate `board_github_connections` table).

2. **Should the repo picker support search/filter?** Users with 100+ repos need filtering. `GET /user/repos` supports `sort` and `type` params but not text search. Options: (a) client-side filter on fetched results, (b) `GET /search/repositories` with user qualifier (consumes search rate limit — 30 req/min vs 5000/hr for REST).

3. **When to trigger the first sync?** After the last repo is selected (blocking the UI?), or after redirect to the board page (async, with polling for completion)? The sync can take seconds for small repos but 30+ seconds for large ones (Workers CPU limit).

## Follow-up Research: 2-Screen Form Tech Stack Support

**Question**: Does the current tech stack (React 19 + Tailwind 4 + shadcn/ui) support a 2-screen multi-step form, or is a separate library needed?

### Answer: Current stack fully supports it — no new library required.

#### What's already in the stack and what it covers

| 2-Screen Form Need | Already Available | Evidence |
| --- | --- | --- |
| Step state (screen 1 ↔ 2) | React 19 `useState` | `useState<1 \| 2>(1)` — trivial conditional rendering |
| Cross-step data persistence | React 19 `useState` | Parent component owns all state; step children receive props |
| Text inputs (name, PAT) | `FormField` component | `src/components/auth/FormField.tsx` — label, icon, error, hint, endContent |
| Action buttons | `Button` (shadcn/ui) | `src/components/ui/button.tsx` — variants: default, outline, ghost, destructive |
| Conditional styling | `cn()` utility | clsx + tailwind-merge (`src/lib/utils`) |
| Client-side validation | Zod v4 | `package.json` — already installed, used server-side, works client-side too |
| Async API calls (validate PAT, fetch repos) | Native `fetch()` | Astro SSR API routes handle POST; no form library needed |
| Loading states | `useState` pattern | Established in `CreateBoardForm.tsx:15-25` |
| Step indicator / progress dots | Tailwind 4 | Pure CSS — two circles + connecting line |
| Repo list / checkbox selection | React 19 | `.map()` + state array — standard React |
| Animations / transitions | Tailwind 4 | `transition-*`, `animate-*` utilities |

#### Why React Hook Form is NOT needed

React Hook Form excels with: 10+ fields, complex cross-field validation, dynamic field arrays, and forms that re-render frequently. This form has ~4 fields across 2 screens (name, PAT, repo selections, search filter). `useState` handles this without performance concerns. Adding React Hook Form for 4 fields adds a dependency, a learning curve, and a pattern inconsistency with the existing auth forms.

#### Architectural shift: native POST → fetch()

The current `CreateBoardForm` uses `<form method="POST" action="/api/boards">` with full-page redirect. A 2-screen form **cannot** use this pattern because:

1. Step 1 needs an **async** call to validate the PAT and fetch repos before transitioning to step 2
2. Step 2 submits the combined data (name + PAT + repos) as a single API call
3. The form must stay mounted across both steps to preserve state

The form should use `fetch()` for all API calls:
- Step 1 "Next" → `fetch("/api/github/validate-pat", { method: "POST" })` → validate, fetch repos
- Step 2 "Create Board" → `fetch("/api/boards", { method: "POST" })` → create board + store PAT + link repos

This aligns with the lessons.md rule: manage submitting state with `useState` + `onSubmit`, not `useFormStatus`.

#### Optional shadcn/ui additions (nice-to-have, not required)

These are not npm dependencies — `npx shadcn@latest add` copies component files into `src/components/ui/`. shadcn/ui is already configured (`components.json` exists, new-york style, `rsc: false`, Tailwind CSS vars enabled).

| Component | `npx shadcn@latest add` | Purpose in this form |
| --- | --- | --- |
| Card | `card` | Consistent step container styling |
| Checkbox | `checkbox` | Repo multi-select in step 2 |
| Badge | `badge` | "Read-only" permission labels on repos |
| Skeleton | `skeleton` | Loading placeholder while repos fetch |
| Input | `input` | Styled input (though FormField works already) |

None are blockers — the form can be built with existing `FormField` + `Button` + Tailwind alone. Adding them is a UX polish decision, not a technical requirement.

#### Decision (2026-06-01): Add shadcn/ui components

After evaluating both options, decided to **add shadcn/ui components** (Checkbox, Badge, Card, Skeleton, Input) via `npx shadcn@latest add`. Rationale:

- **Checkbox** needs Radix for accessible keyboard navigation + aria-checked — the one component where manual implementation is genuinely harder
- **Badge, Card, Skeleton** are simple but establishing them as reusable shadcn/ui primitives now avoids ad-hoc Tailwind divs that would be replaced later anyway as the app grows
- **Zero npm overhead** except `@radix-ui/react-checkbox` (~4KB gzip) — everything else is copy-pasted source files
- **Consistent with existing setup** — `components.json` is configured, `Button` already follows shadcn patterns
- **Plan update required**: `plan.md` line 47 ("What We're NOT Doing") currently says "New shadcn/ui components — build with existing FormField + Button + Tailwind" — this must be revised before Phase 2 implementation

Components to add before Phase 2:
```bash
npx shadcn@latest add checkbox badge card skeleton input
```

#### Code references

- `src/components/CreateBoardForm.tsx:1-69` — Current form: useState pattern, native POST, FormField usage
- `src/components/auth/FormField.tsx:1-68` — Reusable input with icon, label, error, hint, endContent
- `src/components/ui/button.tsx` — shadcn/ui Button with variants
- `components.json` — shadcn/ui config: new-york style, `rsc: false`, aliases configured
- `package.json` — Installed: `@radix-ui/react-slot`, `clsx`, `tailwind-merge`, `zod@^4.4.3`. No form library.
- `context/foundation/lessons.md:5-13` — Lesson: use useState + onSubmit for native-POST forms, not useFormStatus
