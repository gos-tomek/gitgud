# Invite and Join Board — Implementation Plan

## Overview

Add a GitHub-identity-based contributor model to GitGud so an EM can select ICs from the GitHub collaborator list during board creation. Contributors are stored as GitHub identities (login + numeric ID) with no FK to `auth.users` — decoupled from Supabase accounts. A nullable `user_id` column is included for future account linking (F-04).

## Current State Analysis

- **Board creation wizard** (`src/components/CreateBoardForm.tsx`) is a 2-step React island: step 1 (name + PAT), step 2 (repo picker). State managed with `useState` hooks; step type is `1 | 2`.
- **Board creation API** (`src/pages/api/boards/index.ts`) accepts `{ name, pat, repos }` and inserts into `boards` + `github_repos`. Uses Zod validation.
- **Board detail page** (`src/pages/boards/[id].astro`) shows board name, role badge, linked repos, and a "Coming soon" placeholder for contribution profiles.
- **GitHub API routes** follow a consistent pattern: Supabase auth → Zod validation → `makeOctokit(pat)` → domain error mapping.
- **GitHub identity pattern**: `*_github_id` (bigint) + `*_login` (text) used across `github_pull_requests`, `github_reviews`, `github_review_comments`.
- **RLS pattern**: SECURITY DEFINER helpers (`is_board_member()`, `is_board_owner()`) prevent recursion. Per-operation policies: SELECT for members, INSERT/DELETE for owner.
- **No `board_contributors` table exists** — ICs currently have no representation on a board.

### Key Discoveries:

- `src/components/CreateBoardForm.tsx:268-276` — step indicator hardcodes `[1, 2].map(...)` and "Step {step} of 2"
- `src/components/CreateBoardForm.tsx:237-261` — `handleCreate()` POSTs `{ name, pat, repos }` and redirects to `/boards/{id}`
- `src/pages/api/boards/index.ts:20-24` — Zod schema for board creation; needs `contributors` array added
- `src/pages/api/github/repos.ts:46-64` — paginated repo fetch pattern to follow for collaborators
- `src/pages/boards/[id].astro:58-61` — "Coming soon" placeholder to replace with contributor list
- `src/lib/services/boards.ts:78-95` — `getBoardRepos()` pattern to follow for `getBoardContributors()`
- `supabase/migrations/20260531100000_github_ingestion_access.sql:30-31` — `author_login` + `author_github_id` pattern

## Desired End State

After this plan is complete:

1. An EM creating a board sees a 3-step wizard: name+PAT → repos → contributors. Step 3 shows a deduplicated list of GitHub collaborators across all selected repos. The EM selects at least 1 contributor. Contributors are stored in `board_contributors` as GitHub identities.
2. The board detail page shows a vertical list of contributors with avatar, @login, and a future-ready "linked" badge slot.
3. The `board_contributors` table follows the established `github_id` + `login` pattern and includes a nullable `user_id` for future F-04 linking.

**Verification**: create a board with repos → see collaborators in step 3 → select ICs → board detail shows contributor list. Database has `board_contributors` rows with correct `github_id`, `github_login`, `avatar_url`.

## What We're NOT Doing

- GitHub OAuth configuration or `linkIdentity` flow (F-04 — separate change)
- IC self-service accounts or login (S-05)
- Post-creation roster management — add/remove ICs after board setup (S-09)
- Email-based matching (ruled out — unreliable)
- Populating `board_contributors.user_id` (always NULL until F-04)
- Bot filtering heuristics — the `type` field from GitHub API is noted in the response but not auto-filtered; EM makes the selection

## Implementation Approach

Four phases, each independently testable:

1. **Database first** — create `board_contributors` table with RLS, following the established github_id + login pattern.
2. **API layer** — new `/api/github/collaborators` endpoint to fetch and deduplicate collaborators across repos, plus service functions for CRUD.
3. **Wizard extension** — extend CreateBoardForm from 2→3 steps with a contributor picker; update the board creation API to accept and store contributors.
4. **Board detail** — replace the "Coming soon" placeholder with the contributor list.

---

## Phase 1: Database Schema

### Overview

Create the `board_contributors` table and RLS policies. This is the data foundation everything else builds on.

### Changes Required:

#### 1. New migration file

**File**: `supabase/migrations/YYYYMMDDHHMMSS_board_contributors.sql`

**Intent**: Create a `board_contributors` table that stores GitHub identities selected by the EM during board creation. Follows the same `github_id` (bigint) + `login` (text) pattern used in `github_pull_requests`, `github_reviews`, and `github_review_comments`. Includes a nullable `user_id` column for future F-04 account linking.

**Contract**:

Table schema:

```sql
board_contributors (
  board_id     uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  github_id    bigint NOT NULL,
  github_login text NOT NULL,
  avatar_url   text,
  user_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  added_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (board_id, github_id)
)
```

Indexes:

- `board_contributors_user_id_idx` on `user_id` — for future F-04 reverse lookup

RLS policies (same pattern as `board_members` and `github_repos`):

- SELECT: `is_board_member(board_id)` — any board member can see contributors
- INSERT: `is_board_owner(board_id)` — only board owner can add contributors
- DELETE: `is_board_owner(board_id)` — only board owner can remove contributors
- No UPDATE policy — replace via delete + insert

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npx supabase db reset`
- No RLS policy conflicts with existing policies
- `npm run build` passes (no type regressions)

#### Manual Verification:

- Verify via Supabase Studio that the table exists with correct columns and constraints
- Verify RLS policies by querying as owner vs non-owner

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Collaborators API + Service Layer

### Overview

Add the GitHub collaborators endpoint and the service functions for reading/writing `board_contributors`. This provides the data layer that Phase 3 (wizard) and Phase 4 (board detail) consume.

### Changes Required:

#### 1. TypeScript types

**File**: `src/types.ts`

**Intent**: Add `BoardContributor` interface following the established naming pattern (`GitHubPullRequest`, `GitHubReview`, etc.).

**Contract**: New interface with fields: `boardId`, `githubId` (number), `githubLogin`, `avatarUrl` (string | null), `userId` (string | null), `addedAt` (string).

#### 2. Collaborators API endpoint

**File**: `src/pages/api/github/collaborators.ts` (new)

**Intent**: Fetch collaborators across multiple repos using the EM's PAT and return a deduplicated list keyed by `github_id`. Follows the same route structure as `repos.ts`.

**Contract**:

Request schema (Zod):

```typescript
{ pat: string, repos: Array<{ owner: string, name: string }> }
```

Response:

```typescript
{
  collaborators: Array<{ login: string, id: number, avatarUrl: string, type: string }>,
  warnings: Array<{ repo: string, message: string }>
}
```

The endpoint calls `octokit.rest.repos.listCollaborators({ owner, repo })` for each repo, deduplicates by `id` (Map keyed on numeric ID), and returns the union. The `type` field (User/Bot/Organization) is passed through for the UI to display but not filtered server-side.

Per-repo error handling: wrap each `listCollaborators` call in a try/catch. If a repo returns 403 (PAT lacks push/admin access), skip that repo and append `{ repo: "owner/name", message: "Insufficient access" }` to the `warnings` array. If all repos fail, return 200 with an empty `collaborators` array and all warnings — the UI decides whether to block (no collaborators to pick from).

Error mapping: `GitHubAuthError` → 401 (PAT itself is invalid), generic → 500. Per-repo 403s are not endpoint-level errors — they produce warnings.

Pagination: use `octokit.paginate.iterator()` with `per_page: 100`, hard cap at 200 unique collaborators.

#### 3. Board contributor service functions

**File**: `src/lib/services/boards.ts`

**Intent**: Add `getBoardContributors()` and `addBoardContributors()` functions following the same patterns as `getBoardRepos()` and the repo insert in `api/boards/index.ts`.

**Contract**:

- `getBoardContributors(supabase, boardId)` — SELECT from `board_contributors` where `board_id`, ordered by `added_at` ascending. Returns `BoardContributor[]`.
- `addBoardContributors(supabase, boardId, contributors)` — INSERT into `board_contributors` with `board_id`, `github_id`, `github_login`, `avatar_url`. Accepts array of `{ githubId, githubLogin, avatarUrl }`.

### Success Criteria:

#### Automated Verification:

- `npm run build` passes
- `npm run lint` passes
- Endpoint returns valid JSON matching the response schema

#### Manual Verification:

- Call `/api/github/collaborators` with a valid PAT and repos → returns deduplicated collaborator list
- Verify collaborators from multiple repos are merged by github_id (no duplicates)
- Verify error responses for invalid PAT (401) and missing repos (400)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Wizard Step 3 — Contributor Picker

### Overview

Extend the CreateBoardForm from 2 steps to 3, adding a contributor picker that fetches collaborators after the EM selects repos. Update the board creation API to accept and store contributors. At least 1 contributor is required.

### Changes Required:

#### 1. Extend wizard step state and indicator

**File**: `src/components/CreateBoardForm.tsx`

**Intent**: Change the step type from `1 | 2` to `1 | 2 | 3`, update the step indicator from `[1, 2]` to `[1, 2, 3]` and the label from "Step {step} of 2" to "Step {step} of 3".

**Contract**: `useState<1 | 2>` at line 40 becomes `useState<1 | 2 | 3>`. Step indicator at lines 268-276 maps over `[1, 2, 3]`.

#### 2. Add contributor state and fetch logic

**File**: `src/components/CreateBoardForm.tsx`

**Intent**: Add state for collaborators (fetched list), selected contributors, loading/error states, and a filter string. Fetch collaborators from `/api/github/collaborators` when transitioning from step 2 → step 3.

**Contract**: New state variables following the same pattern as the repo state (lines 51-58):

- `collaborators: CollaboratorItem[]` — fetched from API
- `selectedContributors: CollaboratorItem[]` — EM's selection
- `collaboratorsLoading: boolean`
- `collaboratorsError: string | undefined`
- `contributorFilter: string`

New interface `CollaboratorItem` with `{ login, id, avatarUrl, type }`.

Fetch function `fetchCollaborators()` calls POST `/api/github/collaborators` with `{ pat, repos: selectedRepos }`. Called when the EM clicks "Next" on step 2. None are pre-selected — the EM picks from the list.

#### 3. Add step 3 UI — contributor picker

**File**: `src/components/CreateBoardForm.tsx`

**Intent**: Render a contributor picker UI when `step === 3`, following the same visual pattern as the repo picker in step 2: filter input, scrollable checkbox list with avatars and @login, loading skeletons, error state.

**Contract**: Uses the same shadcn components as step 2: `Input` (filter), `Checkbox` (selection), `Skeleton` (loading). Each list item shows a 32px circular avatar, `@login`, and the `type` field as a subtle label. Filter matches on `login` (case-insensitive).

Navigation: "Back" returns to step 2 (preserving repo selection). "Create Board" (previously on step 2) moves to step 3. The final "Create Board" button is on step 3 and is disabled when `selectedContributors.length === 0`.

#### 4. Update step 2 → step 3 transition

**File**: `src/components/CreateBoardForm.tsx`

**Intent**: The current "Create Board" button on step 2 (lines ~495-520) becomes a "Next" button that advances to step 3. The create action moves to step 3.

**Contract**: Step 2's primary button changes from calling `handleCreate()` to calling a new `handleNextToStep3()` that validates at least 1 repo is selected, fetches collaborators, and sets `step` to 3. `handleCreate()` moves to step 3's "Create Board" button.

#### 5. Update handleCreate to include contributors

**File**: `src/components/CreateBoardForm.tsx`

**Intent**: Extend the POST body sent to `/api/boards` to include the selected contributors.

**Contract**: The `handleCreate()` function at line 237 adds `contributors` to the JSON body:

```typescript
contributors: selectedContributors.map((c) => ({
  githubId: c.id,
  githubLogin: c.login,
  avatarUrl: c.avatarUrl,
}));
```

#### 6. Update board creation API to accept and store contributors

**File**: `src/pages/api/boards/index.ts`

**Intent**: Extend the Zod schema and POST handler to accept a `contributors` array and insert into `board_contributors` after board creation.

**Contract**: Add to `createBoardSchema`:

```typescript
contributors: z.array(
  z.object({
    githubId: z.number().int().positive(),
    githubLogin: z.string().min(1),
    avatarUrl: z.string().optional(),
  }),
).min(1, "At least one contributor is required");
```

After PAT storage (line 63), call `addBoardContributors()` from the service layer. Unlike the repo insert (which logs a warning and continues), contributor insert failure is a blocking error — return 500. The wizard enforces "at least 1 contributor"; a board with 0 contributors contradicts that guarantee.

### Success Criteria:

#### Automated Verification:

- `npm run build` passes
- `npm run lint` passes (React Compiler compatibility)
- `npm run format` passes

#### Manual Verification:

- Full wizard flow: step 1 (name + PAT) → step 2 (repos) → step 3 (contributors) → board created
- Step 3 shows deduplicated collaborators from selected repos
- Filter narrows the list by login
- At least 1 contributor required — "Create Board" disabled when none selected
- Back navigation preserves selections across all steps
- Board creation succeeds and redirects to board detail
- Verify `board_contributors` rows in database match the selection

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Board Detail Update

### Overview

Replace the "Contribution profiles — Coming soon" placeholder on the board detail page with an actual contributor list showing avatar, @login, and a future-ready badge slot.

### Changes Required:

#### 1. Fetch contributors in board detail page

**File**: `src/pages/boards/[id].astro`

**Intent**: Import and call `getBoardContributors()` alongside the existing `getBoardRepos()` call, passing the data to the template.

**Contract**: Add `getBoardContributors` import from `@/lib/services/boards`. Call it at the same point as `getBoardRepos` (line 16). Pass `contributors` array to the template.

#### 2. Replace placeholder with contributor list

**File**: `src/pages/boards/[id].astro`

**Intent**: Replace the "Coming soon (S-04)" placeholder (lines 58-61) with a vertical list of contributors. Each item shows a circular avatar (24px), `@login` text, and an empty badge slot for future "linked" status (F-04). Show "No contributors yet" if the array is empty.

**Contract**: Replaces the content inside the existing `rounded-lg border border-white/10 bg-white/5 px-4 py-3` container. Section header changes from "Contribution profiles" to "Contributors". Uses the same styling conventions as the repos list above it (text-sm, text-blue-100/80, monospace for login). Avatar is an `<img>` with `rounded-full` class.

### Success Criteria:

#### Automated Verification:

- `npm run build` passes
- `npm run lint` passes

#### Manual Verification:

- Board detail page shows contributor list with avatars and @login
- Empty state ("No contributors yet") displays when board has zero contributors
- Contributors match what was selected during board creation
- No visual regressions on the rest of the board detail page

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- No dedicated unit test files planned for MVP — the codebase has no test infrastructure yet. Validation is through build, lint, and manual testing.

### Integration Tests:

- Not applicable for MVP scope.

### Manual Testing Steps:

1. Create a new board with a valid PAT → verify 3-step wizard works end-to-end
2. On step 3, verify collaborators are deduplicated across repos (same person in multiple repos appears once)
3. Verify filter narrows the contributor list by login
4. Try to create a board with 0 contributors selected → button should be disabled
5. After board creation, visit board detail → verify contributors displayed with avatars
6. Create a second board with different repos → verify different collaborator list
7. Check `board_contributors` table in Supabase Studio → correct `github_id`, `github_login`, `avatar_url` values
8. Verify RLS: query `board_contributors` as non-owner member → SELECT works; INSERT → denied
9. Verify back navigation in wizard preserves selections across all 3 steps

## Performance Considerations

- The collaborators endpoint calls `listCollaborators` per repo sequentially. For boards with many repos (10+), this could be slow. Acceptable for MVP — the wizard shows a loading state. Future optimization: parallel fetches with `Promise.allSettled`.
- Deduplication uses a Map keyed on numeric `github_id` — O(n) and trivial even for hundreds of collaborators.
- Hard cap of 200 unique collaborators prevents unbounded responses.

## Migration Notes

- The migration is additive only (new table). No changes to existing tables. Backward-compatible — existing boards continue to work without contributors.
- The `ON DELETE CASCADE` on `board_id` means deleting a board (S-10) automatically cleans up contributors.
- The `ON DELETE SET NULL` on `user_id` means deleting a Supabase user doesn't orphan contributor rows — they revert to GitHub-identity-only.

## References

- Frame brief: `context/changes/invite-and-join-board/frame.md`
- Research: `context/changes/invite-and-join-board/research.md`
- Wizard component: `src/components/CreateBoardForm.tsx:39-261`
- Board creation API: `src/pages/api/boards/index.ts:20-85`
- Board detail page: `src/pages/boards/[id].astro:58-61`
- Board service: `src/lib/services/boards.ts:78-95`
- GitHub identity pattern: `supabase/migrations/20260531100000_github_ingestion_access.sql:30-31`
- RLS helpers: `supabase/migrations/20260529120000_access_control_and_membership.sql:37-64`
- Types: `src/types.ts`
- Roadmap: S-03 (this), S-09 (post-creation roster), F-04 (GitHub OAuth linking)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Database Schema

#### Automated

- [x] 1.1 Migration applies cleanly: `npx supabase db reset` — 788c62c
- [x] 1.2 No RLS policy conflicts — 788c62c
- [x] 1.3 `npm run build` passes — 788c62c

#### Manual

- [x] 1.4 Table exists with correct columns and constraints in Supabase Studio
- [x] 1.5 RLS policies verified (owner vs non-owner)

### Phase 2: Collaborators API + Service Layer

#### Automated

- [x] 2.1 `npm run build` passes — 413106a
- [x] 2.2 `npm run lint` passes — 413106a
- [x] 2.3 Endpoint returns valid JSON matching the response schema — 413106a

#### Manual

- [x] 2.4 `/api/github/collaborators` returns deduplicated collaborator list — 413106a
- [x] 2.5 Collaborators from multiple repos are merged by github_id (no duplicates) — 413106a
- [x] 2.6 Error responses for invalid PAT (401) and missing repos (400) — 413106a

### Phase 3: Wizard Step 3 — Contributor Picker

#### Automated

- [x] 3.1 `npm run build` passes — 09e654e
- [x] 3.2 `npm run lint` passes — 09e654e
- [x] 3.3 `npm run format` passes — 09e654e

#### Manual

- [x] 3.4 Full 3-step wizard flow works end-to-end — 09e654e
- [x] 3.5 Step 3 shows deduplicated collaborators from selected repos — 09e654e
- [x] 3.6 Filter narrows the list by login — 09e654e
- [x] 3.7 At least 1 contributor required — button disabled when none selected — 09e654e
- [x] 3.8 Back navigation preserves selections across all steps — 09e654e
- [x] 3.9 Board creation succeeds and redirects to detail page — 09e654e
- [x] 3.10 `board_contributors` rows match selection in database — 09e654e

### Phase 4: Board Detail Update

#### Automated

- [x] 4.1 `npm run build` passes — f7ec815
- [x] 4.2 `npm run lint` passes — f7ec815

#### Manual

- [x] 4.3 Board detail shows contributor list with avatars and @login — f7ec815
- [x] 4.4 Empty state displays when board has zero contributors — f7ec815
- [x] 4.5 Contributors match what was selected during board creation — f7ec815
- [x] 4.6 No visual regressions on board detail page — f7ec815
