# Link Board to GitHub Org — Implementation Plan

## Overview

Refactor board creation from a single-field form into a 2-screen wizard that collects a board name + GitHub Personal Access Token (screen 1) and repo selections (screen 2), making GitHub integration mandatory during board creation. Three new API routes handle PAT validation, repo listing, and manual repo validation. The board detail page replaces its "Coming soon" placeholder with actual linked-repo data.

## Current State Analysis

Board creation is a single-field form (`CreateBoardForm.tsx`) that POSTs the board name to `/api/boards` via native HTML form submission. The API route validates with Zod, calls `createBoard()` (insert into `boards` table), and redirects to `/boards/{id}`.

GitHub infrastructure from F-02 is fully built but disconnected from the creation flow:

- PAT encryption/decryption via `set_board_github_pat()` / `get_board_github_pat()` RPC functions
- `github_repos` table with RLS (board_id, repo_owner, repo_name, connected_by)
- Octokit factory (`createGitHubClient`) with retry + rate-limit hooks
- Sync service for PRs/reviews/comments

The board detail page (`/boards/[id]`) has placeholder stubs: "Coming soon (S-02)" for linked repos and "Coming soon (S-04)" for contribution profiles.

### Key Discoveries:

- `createGitHubClient()` at `src/lib/github.ts:68` requires a `boardId` to decrypt a stored PAT — pre-creation validation needs a separate path via the unexported `makeOctokit()` at `src/lib/github.ts:34`
- `GET /user/repos` returns only repos the PAT user has access to (not all public repos), with a `permissions.push` boolean per repo at zero extra API cost
- Any valid classic PAT can read PRs from any public repo via `GET /repos/{owner}/{repo}/pulls` — the picker shows the user's repos, but manual entry allows adding any accessible public repo
- The form must shift from native POST (FormData + server redirect) to `fetch()` (JSON + client-side redirect) because the multi-step flow needs async API calls mid-flow
- No schema migration needed — `boards.github_pat_encrypted`, `github_repos` table, and PAT RPC functions already exist

## Desired End State

A logged-in user visits `/boards/new` and sees a 2-screen form:

1. **Screen 1**: enters board name + pastes a GitHub Classic PAT. PAT validates asynchronously (inline, before clicking Next). On success, shows "Connected as @username". User clicks Next.
2. **Screen 2**: sees a searchable list of their GitHub repos (fetched via the validated PAT). Selects repos with checkboxes. Can also manually add public repos by `owner/name`. Clicks "Create Board".

The board is created with PAT stored (encrypted) and selected repos linked. The user is redirected to the board detail page, which shows the list of linked repos (replacing the S-02 placeholder).

Verification: visit `/boards/new`, complete both screens, verify board page shows linked repos. PAT is stored and ready for sync operations (sync itself is out of scope).

## What We're NOT Doing

- **IC/contributor selection** — out of scope (separate change, S-04)
- **First sync trigger** — the PAT and repos are stored, but sync is not triggered during or after creation
- **Fine-grained PAT support** — classic PAT only for MVP (fine-grained has multi-org and outside-collaborator blockers)
- **Storing `github_username` / `github_user_id` on boards** — the display during creation comes from the validate-pat response; no persistent storage needed for MVP
- **OAuth / GitHub App flow** — PAT-based only
- **Org-level linking** — repo-level only, as established in F-02
## Implementation Approach

Before Phase 2, install shadcn/ui components for the form UI: `npx shadcn@latest add checkbox badge card skeleton input`. These are copy-pasted source files (not npm packages) except `@radix-ui/react-checkbox`. Checkbox provides accessible keyboard navigation for the repo picker; Badge, Card, Skeleton, and Input establish reusable primitives consistent with the existing Button component.

Backend-first: build the 3 GitHub API routes, independently testable via API calls. Then refactor the form architecture (native POST → fetch + multi-step). Then implement screen content (screen 1, then screen 2). Finally update the board detail page.

Each API route creates a temporary Octokit instance from the raw PAT (not board-linked), since the board doesn't exist yet at validation time. The board creation endpoint is refactored from FormData+redirect to JSON request+response, orchestrating board insert → PAT storage → repo linking in sequence.

## Critical Implementation Details

### Temporary Octokit pattern

`createGitHubClient()` at `src/lib/github.ts:68` requires a `boardId` to decrypt a stored PAT. The 3 new API routes need an Octokit instance from a raw token (pre-storage). The unexported `makeOctokit()` at `src/lib/github.ts:34` does exactly this — it creates an `OctokitWithRetry` with the same retry + rate-limit hooks. Export it (or extract a new public function) so the API routes can create temporary clients without a board.

---

## Phase 1: GitHub API Routes

### Overview

Create 3 new server-side API endpoints for PAT validation, repo listing, and manual repo validation. These are independent of the form — testable via curl or API client. All require an authenticated Supabase session.

### Changes Required:

#### 1. Export temporary Octokit factory

**File**: `src/lib/github.ts`

**Intent**: Expose a way to create an Octokit instance from a raw PAT string, for use before a board exists. The existing `makeOctokit()` (line 34) does this but is unexported.

**Contract**: Export a function that takes a `token: string` and returns a configured Octokit with the same retry + rate-limit hooks as the existing factory.

#### 2. PAT validation endpoint

**File**: `src/pages/api/github/validate-pat.ts` (new)

**Intent**: Validate a GitHub PAT by calling `GET /user` and return the authenticated identity. Detect fine-grained tokens by prefix and include a warning in the response.

**Contract**: `POST /api/github/validate-pat`

- Request body: `{ pat: string }`
- Auth: requires Supabase session (401 if missing)
- Token prefix check: `github_pat_` → include `warning` field in response
- Success (200): `{ login: string, id: number, avatarUrl: string, warning?: string }`
- Invalid token (401 from GitHub): `{ error: "Token is invalid or expired" }`
- Zod validation for request body
- Follow the JSON response pattern from `src/pages/api/github/sync.ts`

#### 3. Repo listing endpoint

**File**: `src/pages/api/github/repos.ts` (new)

**Intent**: Fetch all repositories accessible to the PAT user, with pagination, returning owner, name, visibility, and push-access flag for the picker.

**Contract**: `POST /api/github/repos`

- Request body: `{ pat: string }`
- Auth: requires Supabase session
- Paginates `octokit.rest.repos.listForAuthenticatedUser({ per_page: 100 })` until all pages fetched
- Success (200): `{ repos: Array<{ owner: string, name: string, fullName: string, private: boolean, pushAccess: boolean }> }`
- Maps `repo.owner.login` → `owner`, `repo.permissions.push` → `pushAccess`

#### 4. Manual repo validation endpoint

**File**: `src/pages/api/github/validate-repo.ts` (new)

**Intent**: Check whether a specific `owner/name` repo exists and is accessible with the given PAT. Used when the user manually enters a repo not in their list.

**Contract**: `POST /api/github/validate-repo`

- Request body: `{ pat: string, owner: string, name: string }`
- Auth: requires Supabase session
- Calls `octokit.rest.repos.get({ owner, name })`
- Success (200): `{ owner: string, name: string, fullName: string, private: boolean, pushAccess: boolean }`
- Not found/inaccessible (404): `{ error: "Repository not found or not accessible with this token" }`

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Type checking passes: `npm run build`
- All 3 endpoints return correct JSON responses with valid inputs
- All 3 endpoints return 401 when no Supabase session

#### Manual Verification:

- `validate-pat` with a valid classic PAT returns login + avatar
- `validate-pat` with a `github_pat_` prefix returns a fine-grained warning
- `validate-pat` with an invalid token returns error
- `repos` returns the user's repo list with push-access flags
- `validate-repo` with an existing public repo returns repo info
- `validate-repo` with a nonexistent repo returns 404

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Form Architecture Refactor

### Overview

Transform `CreateBoardForm` from a single-field native-POST form into a multi-step `fetch()`-based wizard skeleton. Refactor `POST /api/boards` from FormData+redirect to JSON request+response. After this phase, board creation works via the new architecture with name-only (PAT and repos are wired in Phases 3–4).

### Changes Required:

#### 1. Refactor board creation API to JSON

**File**: `src/pages/api/boards/index.ts`

**Intent**: Change from FormData parsing + redirect responses to JSON body + JSON responses. Required because the multi-step form uses `fetch()`, not native form submission. Initially accepts `name` only; Phase 4 expands the schema to include `pat` and `repos`.

**Contract**: `POST /api/boards`

- Request body (Phase 2): `{ name: string }`
- Response (201): `{ id: string }`
- Error responses: JSON `{ error: string }` with status codes (400, 401, 409 for name taken, 500)
- Zod validation for request body
- Auth check unchanged (Supabase session)

#### 2. Refactor form to multi-step with fetch()

**File**: `src/components/CreateBoardForm.tsx`

**Intent**: Replace native `<form method="POST">` with a React component that manages step state, submits via `fetch()`, and handles client-side redirect. The form skeleton includes: step indicator (dots/progress), next/back navigation, and conditional rendering per step. Screen 1 shows the name field (working). Screen 2 is a placeholder at this point. Use `Card` (shadcn/ui) as the step container.

**Prerequisite**: Run `npx shadcn@latest add checkbox badge card skeleton input` before starting this phase.

**Contract**:

- Step state: `useState<1 | 2>(1)`
- All form data owned by parent component state (name, pat, repos persist across steps)
- Each step wrapped in `Card` / `CardContent` for consistent container styling
- "Next" advances from step 1 → step 2
- "Back" returns to step 1, preserving all state
- "Create Board" on step 2 submits to `POST /api/boards` via `fetch()` with JSON body
- On success: `window.location.href = /boards/${id}`
- Loading/error states managed via `useState` (per lessons.md — no `useFormStatus` for fetch-based forms)

#### 3. Update hosting page

**File**: `src/pages/boards/new.astro`

**Intent**: Adjust the page to work with the refactored form. The `serverError` query param pattern is no longer needed since errors are handled in-component via fetch responses.

**Contract**: Form component receives no `serverError` prop. Page simplifies to rendering the form with `client:load`.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Type checking passes: `npm run build`
- Board creation (name-only) works end-to-end

#### Manual Verification:

- Form renders with step indicator showing step 1 of 2
- Name field works, "Next" advances to step 2
- Step 2 shows placeholder content + "Back" and "Create Board" buttons
- "Back" preserves the entered board name
- "Create Board" creates a board and redirects to `/boards/{id}`
- Error states display correctly (empty name, duplicate name)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Screen 1 — Board Name + PAT

### Overview

Implement the full content of screen 1: board name field (already working from Phase 2) plus a PAT input field with inline async validation. When the user pastes a valid PAT, the form validates it in the background and shows "Connected as @username" — without waiting for the user to click Next.

### Changes Required:

#### 1. Add PAT input and async validation to screen 1

**File**: `src/components/CreateBoardForm.tsx` (or extracted step component)

**Intent**: Add a PAT text field below the board name. When the user pastes/types a token, trigger async validation via `POST /api/github/validate-pat` (debounced or on blur). Display the validation result inline: success shows the GitHub username, errors show the message. Fine-grained token prefix triggers a warning. "Next" button is disabled until PAT validates successfully.

**Contract**:

- PAT field: password-type input with show/hide toggle (reuse `PasswordToggle` pattern from auth forms)
- Validation trigger: on input change (debounced ~500ms) or on blur
- States: idle → validating (spinner) → valid (show @username + green check) → error (show message)
- Fine-grained prefix detection (`github_pat_`): show warning inline before API call
- "Next" disabled until PAT state is valid
- Help text below PAT field: link to GitHub classic PAT creation page with required scopes (`repo` + `read:org`)
- Validated PAT value + username stored in parent component state for use in step 2

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Type checking passes: `npm run build`

#### Manual Verification:

- PAT field renders with appropriate label and help text
- Pasting a valid classic PAT triggers async validation, shows "Connected as @username"
- Pasting an invalid token shows error message
- Pasting a `github_pat_` token shows fine-grained warning
- "Next" is disabled until PAT validates
- Navigating back from step 2 preserves PAT and validation state

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Screen 2 — Repo Picker

### Overview

Implement the full content of screen 2: a searchable list of the user's GitHub repos (fetched via the validated PAT from screen 1) with checkbox selection, plus a manual entry field for adding any accessible public repo by `owner/name`. The "Create Board" button submits name + PAT + selected repos to the board creation endpoint.

### Changes Required:

#### 1. Expand board creation API to accept PAT + repos

**File**: `src/pages/api/boards/index.ts`

**Intent**: Expand the JSON schema to require `pat` and `repos` alongside `name`. After creating the board, store the PAT via RPC and insert repos into `github_repos`.

**Contract**: `POST /api/boards`

- Request body: `{ name: string, pat: string, repos: Array<{ owner: string, name: string }> }`
- Zod validation: name (1–80 chars), pat (non-empty string), repos (non-empty array, each with owner + name)
- Orchestration sequence: `createBoard()` → `set_board_github_pat` RPC → `github_repos` inserts
- Import `GITHUB_TOKEN_ENCRYPTION_KEY` from `astro:env/server`. Pass as third argument to `set_board_github_pat` RPC (matches the pattern in `src/lib/github.ts:73-76`)
- All operations use the same Supabase client (same auth context)
- `connected_by` field on `github_repos` rows set to the authenticated user's ID
- Response unchanged: `{ id: string }` on success (201)
- If PAT storage or repo linking fails after board creation, the board still exists — acceptable for MVP (no transaction rollback across RPC + table inserts)

#### 2. Implement repo picker on screen 2

**File**: `src/components/CreateBoardForm.tsx` (or extracted step component)

**Intent**: When screen 2 mounts, fetch the user's repos via `POST /api/github/repos` using the validated PAT from screen 1. Display a searchable list with checkboxes. Each repo shows `owner/name`, visibility (private/public), and push-access indicator.

**Contract**:

- On step 2 entry: call `POST /api/github/repos` with the PAT → show `Skeleton` placeholders → render repo list
- Each repo item: `Checkbox` (shadcn/ui, Radix-based) + `owner/name` + visibility indicator + push-access `Badge` (read-only repos: `Badge variant="secondary"` with "Read-only")
- Text filter: filters the fetched list by repo full name (client-side, instant)
- Selected repos stored as array in parent state
- At least one repo must be selected for "Create Board" to be enabled

#### 3. Add manual repo entry

**File**: `src/components/CreateBoardForm.tsx` (or extracted step component)

**Intent**: Below the picker, provide an input field for manually adding a repo by `owner/name`. On submit, validate via `POST /api/github/validate-repo`. If valid, add to the selected repos list.

**Contract**:

- Input field with placeholder: `owner/name` (e.g., `facebook/react`)
- "Add" button triggers `POST /api/github/validate-repo` with the PAT + parsed owner/name
- On success: add the repo to the selected list (same format as picker items)
- On error (404): show "Repository not found or not accessible"
- Prevent duplicates (repo already in selected list)
- Manually added repos are visually indistinguishable from picker-selected repos

#### 4. Wire "Create Board" submission

**File**: `src/components/CreateBoardForm.tsx`

**Intent**: The "Create Board" button collects name + PAT + selected repos from component state and submits to `POST /api/boards` as JSON. On success, redirect to the new board page.

**Contract**:

- Submits `{ name, pat, repos: selectedRepos.map(r => ({ owner: r.owner, name: r.name })) }`
- Loading state on the button during submission
- Error handling: display API errors inline (duplicate name, server error)
- On success (201): `window.location.href = /boards/${id}`

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Type checking passes: `npm run build`
- Board creation with PAT + repos works end-to-end (API level)

#### Manual Verification:

- Completing screen 1 and advancing to screen 2 shows repo list loading then repo items
- Text filter narrows the displayed repos
- Selecting repos with checkboxes works
- Manual entry field validates and adds repos
- Duplicate repo entry is prevented
- "Create Board" creates the board with PAT stored and repos linked
- After creation, redirect to `/boards/{id}` works
- Going back to screen 1 and returning to screen 2 preserves repo selections (if PAT unchanged)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 5: Board Detail Page — Linked Repos

### Overview

Replace the "Coming soon (S-02)" placeholder on the board detail page with the list of GitHub repos linked to the board. This closes the S-02 feature stub.

### Changes Required:

#### 1. Fetch linked repos in board service

**File**: `src/lib/services/boards.ts`

**Intent**: Add a function to fetch the `github_repos` linked to a board for display on the board detail page.

**Contract**: New function `getBoardRepos(supabase, boardId): Promise<Array<{ repoOwner: string, repoName: string, connectedAt: string }>>`. Queries `github_repos` table filtered by `board_id`. RLS enforces access (only board members can read).

#### 2. Update board detail page

**File**: `src/pages/boards/[id].astro`

**Intent**: Replace the "Linked GitHub org / Coming soon (S-02)" placeholder with a list of linked repos fetched from the database.

**Contract**:

- Call `getBoardRepos(supabase, board.id)` in the page frontmatter
- Render linked repos in the existing card slot (replacing the S-02 placeholder)
- Each repo displayed as `owner/name`
- If no repos linked (legacy boards created before this change): show "No repositories linked" as fallback
- Keep the "Contribution profiles / Coming soon (S-04)" placeholder unchanged

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Type checking passes: `npm run build`

#### Manual Verification:

- Board detail page shows linked repos instead of "Coming soon (S-02)"
- Each repo displays as `owner/name`
- S-04 placeholder remains unchanged
- Legacy board (no repos) shows graceful fallback

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- Not required for MVP — the API routes are thin wrappers around Octokit calls and Supabase operations. Meaningful testing requires integration with external services.

### Integration Tests:

- Not in scope for this change. Success criteria focus on manual verification via the running app.

### Manual Testing Steps:

1. Start dev server (`npm run dev`)
2. Sign in as an authenticated user
3. Navigate to `/boards/new`
4. Enter a board name, paste a valid classic PAT
5. Verify PAT validates inline, shows GitHub username
6. Click Next, verify repo list loads
7. Filter repos by text, select some via checkboxes
8. Add a public repo manually (e.g., `facebook/react`)
9. Click "Create Board"
10. Verify redirect to `/boards/{id}` with linked repos displayed
11. Test error paths: invalid PAT, fine-grained PAT prefix, duplicate board name, nonexistent manual repo

## Performance Considerations

- **Repo listing latency**: `GET /user/repos` with pagination may take 1–3 seconds for users with 200+ repos. Show a loading state during fetch.
- **PAT validation**: `GET /user` is fast (~50–150ms). Debounce input to avoid excessive calls during typing.
- **No caching**: Repos are fetched fresh each time screen 2 loads. Acceptable for a one-time setup flow.

## References

- Frame brief: `context/changes/link-board-to-github-org/frame.md`
- Research doc: `context/changes/link-board-to-github-org/research.md`
- Existing GitHub infrastructure: `src/lib/github.ts`, `src/lib/services/github-sync.ts`
- Board creation: `src/lib/services/boards.ts:33-47`, `src/pages/api/boards/index.ts`
- Board detail: `src/pages/boards/[id].astro:40-47`
- PAT encryption: `supabase/migrations/20260531100000_github_ingestion_access.sql:111-145`
- Lessons: `context/foundation/lessons.md` (useFormStatus vs native forms, consola logging)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: GitHub API Routes

#### Automated

- [x] 1.1 Linting passes — e3e5611
- [x] 1.2 Type checking / build passes — e3e5611
- [x] 1.3 All 3 endpoints return correct JSON with valid inputs — e3e5611
- [x] 1.4 All 3 endpoints return 401 without session — e3e5611

#### Manual

- [x] 1.5 validate-pat with valid classic PAT returns login + avatar — e3e5611
- [x] 1.6 validate-pat with github_pat_ prefix returns fine-grained warning — e3e5611
- [x] 1.7 validate-pat with invalid token returns error — e3e5611
- [x] 1.8 repos returns user's repo list with push-access flags — e3e5611
- [x] 1.9 validate-repo with existing public repo returns info — e3e5611
- [x] 1.10 validate-repo with nonexistent repo returns 404 — e3e5611

### Phase 2: Form Architecture Refactor

#### Automated

- [x] 2.1 Linting passes — d489069
- [x] 2.2 Type checking / build passes — d489069
- [x] 2.3 Board creation (name-only) works end-to-end — d489069

#### Manual

- [x] 2.4 Form renders with step indicator (step 1 of 2) — d489069
- [x] 2.5 Next advances to step 2, step 2 shows placeholder content + Create Board button — d489069
- [x] 2.6 Back returns to step 1, preserves entered board name — d489069
- [x] 2.7 Create Board creates board and redirects — d489069
- [x] 2.8 Error states display correctly (empty name, duplicate name) — d489069

### Phase 3: Screen 1 — Board Name + PAT

#### Automated

- [x] 3.1 Linting passes
- [x] 3.2 Type checking / build passes

#### Manual

- [x] 3.3 PAT field renders with label and help text
- [x] 3.4 Valid classic PAT triggers validation, shows @username
- [x] 3.5 Invalid token shows error
- [x] 3.6 github_pat_ prefix shows fine-grained warning
- [x] 3.7 Next disabled until PAT validates
- [x] 3.8 Back from step 2 preserves PAT + validation state

### Phase 4: Screen 2 — Repo Picker

#### Automated

- [ ] 4.1 Linting passes
- [ ] 4.2 Type checking / build passes
- [ ] 4.3 Board creation with PAT + repos works (API level)

#### Manual

- [ ] 4.4 Step 2 loads and displays repo list
- [ ] 4.5 Text filter narrows repos
- [ ] 4.6 Checkbox selection works
- [ ] 4.7 Manual repo entry validates and adds
- [ ] 4.8 Duplicate repo entry prevented
- [ ] 4.9 Create Board stores PAT + links repos
- [ ] 4.10 After creation, redirect to /boards/{id} works
- [ ] 4.11 Back to step 1 and return preserves selections (same PAT)

### Phase 5: Board Detail Page — Linked Repos

#### Automated

- [ ] 5.1 Linting passes
- [ ] 5.2 Type checking / build passes

#### Manual

- [ ] 5.3 Board page shows linked repos (not "Coming soon")
- [ ] 5.4 S-04 placeholder unchanged
- [ ] 5.5 Legacy board (no repos) shows graceful fallback
