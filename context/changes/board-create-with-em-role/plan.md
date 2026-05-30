# Board Create with EM Role (S-01) Implementation Plan

## Overview

Deliver the *create a board* flow for GitGud: a signed-in user creates a board, is explicitly shown they become its **Supervisor (EM)** at creation time (PRD FR-016), and can own more than one (FR-017). The slice is almost entirely application-layer — its prerequisite **F-01 (access-control-and-membership) already shipped and deployed the full data layer** (prod 2026-05-29). The only schema work is one additive unique-index migration for per-owner board-name uniqueness.

## Current State Analysis

F-01 delivered, in production:

- `boards` + `board_members` tables with RLS enabled (`supabase/migrations/20260529120000_access_control_and_membership.sql`, `supabase/migrations/20260529130000_board_triggers.sql`).
- `boards_insert` RLS policy: `WITH CHECK (owner_user_id = auth.uid())` — an authenticated user can insert a board only as its own owner, so "creator = EM" is a DB invariant (FR-016).
- `AFTER INSERT` trigger `add_owner_as_board_member()` auto-inserts the creator into `board_members`, so a single insert is sufficient and the owner immediately sees the board.
- Role is derived, not stored: `src/types.ts` → `BoardRole = "supervisor" | "contributor"`; `src/lib/services/boards.ts#getUserBoards` and `#getBoardWithRole` compute `supervisor` when `ownerUserId === userId`.
- `/dashboard` (`src/pages/dashboard.astro`) already lists a user's boards with Supervisor/Contributor badges.

What's missing: any way to create a board, and any destination page once one exists.

Established patterns this slice mirrors:

- **API routes** (`src/pages/api/auth/{signin,signup}.ts`): `export const POST: APIRoute`; build client via `createClient(context.request.headers, context.cookies)` (`src/lib/supabase.ts`); read `FormData`; redirect with `?error=` on failure, redirect to a path on success. No zod yet — but `CLAUDE.md` mandates zod for API routes, so this slice introduces it.
- **Auth/user** (`src/middleware.ts`): resolves `context.locals.user`; `PROTECTED_ROUTES = ["/dashboard"]` (uses `startsWith`).
- **Page→island** (`src/pages/auth/signin.astro` + `src/components/auth/SignInForm.tsx`): Astro reads `?error`, passes `serverError` into a `client:load` island that is a native `<form>` reusing `FormField`, `SubmitButton` (`useFormStatus`), `ServerError` from `src/components/auth/`.
- **shadcn/ui**: only `src/components/ui/button.tsx` present. No Dialog/Input/Card/Toast — not needed here.

## Desired End State

A signed-in user visits `/boards/new`, sees a single name field with an explicit "you'll be the Supervisor (EM)" note, submits, and is redirected to `/boards/[id]` showing the board name and a Supervisor badge. The board appears on `/dashboard` with a Supervisor badge and the row links to its detail page. Submitting a name that duplicates one of their own boards (case/whitespace-insensitive) shows an inline error and creates nothing. `/boards/*` is auth-protected.

**Verify:** sign in as seed user `supervisor-1@example.test` (password `password`) → `/boards/new` → create "QA Board" → land on `/boards/<id>` with a Supervisor badge → it shows on `/dashboard` → retry "qa board" → rejected with a friendly message.

### Key Discoveries:

- Single INSERT into `boards` is enough — the F-01 trigger handles membership (`supabase/migrations/20260529130000_board_triggers.sql:28-47`).
- `getBoardWithRole` already returns `UserBoard | null` (null when RLS denies read) — reuse it for the detail page (`src/lib/services/boards.ts`).
- Role must never be silent: surface it in UI copy (FR-016 resolution in `context/foundation/prd.md`), not in data.
- `lower()`/`trim()` are immutable → a functional unique index on `(owner_user_id, lower(trim(name)))` is valid and additive.
- `zod` is present in `node_modules` only transitively (via `astro`, `@astrojs/sitemap`, and eslint plugins); the root `package.json` does not declare it. This slice must add it as a direct dependency (see Phase 1, step 4).

## What We're NOT Doing

- No GitHub-org linking, contribution profiles, or IC switching (S-02/S-04/S-06) — the detail page only stubs these as "coming soon".
- No invitations / adding other members (S-03).
- No edit/rename/delete board; no separate board-listing page beyond `/dashboard`.
- No shadcn Dialog/Toast install; no react-hook-form (stay with useState + native-POST).
- No change to the F-01 tables, RLS policies, triggers, or the `supervisor`/`contributor` naming.

## Implementation Approach

Backend first (migration + service + API route), then frontend (create page/island, detail page, nav wiring, route protection). Reuse the F-01 insert path; surface the explicit-role requirement in UI copy; use the existing redirect-with-`?error=` convention for server errors.

## Phase 1: Backend — uniqueness migration, service, API route

### Overview

Add the per-owner name-uniqueness rule, a `createBoard` service function, and the create API route with zod validation.

### Changes Required:

#### 1. Migration: unique board name per owner

**File**: `supabase/migrations/20260529140000_boards_unique_name_per_owner.sql` (new)

**Intent**: Prevent an owner from having two boards with the same name; additive and backward-compatible per the expand/contract rule.

**Contract**: `CREATE UNIQUE INDEX boards_owner_name_unique ON public.boards (owner_user_id, lower(trim(name)));` — case/whitespace-insensitive per owner. Compatible with F-01 seed data (no owner currently holds duplicate names).

#### 2. `createBoard` service function

**File**: `src/lib/services/boards.ts`

**Intent**: Insert one `boards` row with `owner_user_id = userId`, return the new id (the F-01 trigger adds membership), and map the Postgres unique-violation to a recognizable outcome.

**Contract**: `createBoard(supabase: SupabaseClient, userId: string, name: string): Promise<{ id: string }>`. Uses `.insert({ name, owner_user_id: userId }).select("id").single()`. Trim name before insert (DB CHECK requires non-empty trimmed). On unique-violation (Postgres `code === "23505"`) throw an error the route can detect (e.g. a `BoardNameTakenError` or check the code); rethrow other errors.

**RLS read-back caveat**: `boards_select` is `USING (is_board_member(id))` — the owner can only read a board once the F-01 `AFTER INSERT` trigger has added their `board_members` row. The `.select("id").single()` projects through that SELECT policy on the `INSERT ... RETURNING`. **Verify locally first** that the happy path returns the id (not a `PGRST116` empty-result error). If the trigger-inserted membership row is not yet visible to the RETURNING projection, board creation fails even though the row was created. In that case, add an additive owner-fallback SELECT policy to the migration in step 1: `CREATE POLICY boards_select_owner ON public.boards FOR SELECT TO authenticated USING (owner_user_id = auth.uid());`. It OR-combines with `boards_select`, makes the read-back deterministic regardless of trigger/RETURNING ordering, and does not loosen existing access (an owner can already read their own boards via membership).

#### 3. Create-board API route

**File**: `src/pages/api/boards/index.ts` (new) — `POST`

**Intent**: Validate input with zod, create the board as the authenticated user, redirect to the new detail page, round-trip errors via `?error=`.

**Contract**: `export const POST: APIRoute`. Build client; if null → redirect `/boards/new?error=...`. Resolve user via `supabase.auth.getUser()`; if absent → redirect `/auth/signin`. Parse `FormData` `name` with `z.string().trim().min(1, "Board name is required").max(80, "Keep it under 80 characters")`. On zod failure → redirect `/boards/new?error=<firstMessage>`. Call `createBoard`; on success → redirect `/boards/<id>`; on `23505` → redirect `/boards/new?error=You%20already%20have%20a%20board%20with%20that%20name`.

#### 4. Declare `zod` as a direct dependency

**File**: `package.json` (+ `package-lock.json`)

**Intent**: The route imports `zod`, but the root `package.json` does not list it — it currently resolves only because `astro`/`@astrojs/sitemap`/eslint plugins pull it in transitively (hoisted `zod@4.x`). If those bumps drop or move zod, `npm ci` + `npm run build` would break silently. Make the dependency explicit.

**Contract**: Run `npm install zod` so `zod` appears under `dependencies` in `package.json` and the lockfile pins it. Verify with `npm ls zod` that the root now declares it.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Build + type-check passes: `npm run build`
- Migration applies cleanly on local reset: `npx supabase db reset`
- `zod` is declared in `package.json` `dependencies`: `npm ls zod` shows it at the project root

#### Manual Verification:

- Creating a board via the flow yields exactly one `boards` row and one matching `board_members` row (trigger) for the creator.
- A same-name board (case/space variants) for the same owner is rejected; a different owner can reuse the name.

**Implementation Note**: After this phase and all automated verification passes, pause for manual confirmation before Phase 2.

---

## Phase 2: Frontend — create page, detail page, nav, route protection

### Overview

Build the dedicated create page + island, a minimal board detail redirect target, dashboard entry points, and protect `/boards/*`.

### Changes Required:

#### 1. Protect `/boards/*`

**File**: `src/middleware.ts`

**Intent**: Require auth for the new routes.

**Contract**: Add `"/boards"` to `PROTECTED_ROUTES` (existing `startsWith` check covers `/boards/new` and `/boards/[id]`).

#### 2. Create-board page

**File**: `src/pages/boards/new.astro` (new)

**Intent**: Full-page form mirroring `auth/signin.astro`; read `?error`, pass to the island.

**Contract**: Render `<CreateBoardForm serverError={error} client:load />` inside `Layout`.

#### 3. Create-board island

**File**: `src/components/CreateBoardForm.tsx` (new)

**Intent**: Native `<form method="POST" action="/api/boards">` with one name field, an explicit inline role note, submit button, and server-error display.

**Contract**: Reuse `FormField`, `SubmitButton`, `ServerError` from `src/components/auth/`. Props `{ serverError?: string | null }`. Visible copy: "You'll be the **Supervisor (EM)** of this board." Client-side: require non-empty name before submit (mirror `SignInForm.validate()`).

#### 4. Minimal board detail page

**File**: `src/pages/boards/[id].astro` (new)

**Intent**: Real redirect target that confirms the EM role and stubs future slices.

**Contract**: Resolve `id` from `Astro.params`; build client; `board = await getBoardWithRole(supabase, id, user.id)`. If `null` → `return Astro.redirect("/dashboard")`. Render board `name`, a Supervisor/Contributor badge (reuse dashboard badge styling), `createdAt`, and "coming soon" placeholders for "Linked GitHub org" (S-02) and "Contribution profiles" (S-04).

#### 5. Dashboard wiring

**File**: `src/pages/dashboard.astro`

**Intent**: Provide entry to creation and make board rows navigable.

**Contract**: Add a "New board" link/button → `/boards/new`; wrap each board row in a link to `/boards/{board.id}`.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Build + type-check passes: `npm run build`

#### Manual Verification:

- `/boards/new` while signed out redirects to `/auth/signin`; signed in, shows the form with the explicit Supervisor (EM) note.
- Creating a board redirects to `/boards/<id>` showing the board name + Supervisor badge.
- The new board appears on `/dashboard` with a Supervisor badge; clicking the row opens its detail page.
- Visiting `/boards/<id>` for a board the user is not a member of redirects to `/dashboard` (RLS returns null).
- Submitting a duplicate name shows the inline "already have a board with that name" error and creates nothing.

**Implementation Note**: After this phase and all automated verification passes, pause for manual confirmation.

---

## Testing Strategy

### Unit Tests:

- No unit-test harness exists in the repo; rely on type-check/build + manual verification (consistent with F-01).

### Integration Tests:

- `npx supabase db reset` confirms the new migration applies alongside F-01 migrations and seed data.

### Manual Testing Steps:

1. Sign in as `supervisor-1@example.test` (password `password`).
2. Visit `/boards/new`, confirm the explicit Supervisor (EM) note, create "QA Board".
3. Confirm redirect to `/boards/<id>` with a Supervisor badge.
4. Confirm "QA Board" appears on `/dashboard`; click the row → detail page.
5. Create "qa board" again → inline duplicate-name error, no new board.
6. Sign out, hit `/boards/new` → redirected to `/auth/signin`.
7. As a non-member, visit a known other board's `/boards/<id>` → redirected to `/dashboard`.

## Performance Considerations

Negligible — single-row insert and single-row reads, all RLS-scoped. The unique index also speeds owner+name lookups.

## Migration Notes

The unique index is additive and backward-compatible (expand/contract safe) — no `wrangler rollback` schema-revert hazard. Production migration is applied by `deploy.yml`, never manually (`CLAUDE.md`).

## References

- Roadmap S-01: `context/foundation/roadmap.md` (lines 111–121)
- PRD FR-001 / FR-016 / FR-017: `context/foundation/prd.md`
- F-01 schema/RLS/trigger: `supabase/migrations/20260529120000_access_control_and_membership.sql`, `supabase/migrations/20260529130000_board_triggers.sql`
- Existing service: `src/lib/services/boards.ts`; types: `src/types.ts`
- Patterns to mirror: `src/pages/auth/signin.astro`, `src/components/auth/SignInForm.tsx`, `src/pages/dashboard.astro`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Backend — uniqueness migration, service, API route

#### Automated

- [x] 1.1 Linting passes: `npm run lint` — eb8bb25
- [x] 1.2 Build + type-check passes: `npm run build` — eb8bb25
- [x] 1.3 Migration applies cleanly on local reset: `npx supabase db reset` — eb8bb25
- [x] 1.4 `zod` is declared in `package.json` `dependencies` (`npm ls zod` shows it at root) — eb8bb25

#### Manual

- [x] 1.5 Creating a board yields one `boards` row + one matching `board_members` row (trigger) for the creator — eb8bb25
- [x] 1.6 Same-name board for the same owner is rejected; a different owner can reuse the name — eb8bb25

### Phase 2: Frontend — create page, detail page, nav, route protection

#### Automated

- [x] 2.1 Linting passes: `npm run lint` — eb8bb25
- [x] 2.2 Build + type-check passes: `npm run build` — eb8bb25

#### Manual

- [x] 2.3 `/boards/new` signed out redirects to `/auth/signin`; signed in shows the form with the explicit Supervisor (EM) note — eb8bb25
- [x] 2.4 Creating a board redirects to `/boards/<id>` showing name + Supervisor badge — eb8bb25
- [x] 2.5 New board appears on `/dashboard` with a Supervisor badge; row click opens the detail page — eb8bb25
- [x] 2.6 `/boards/<id>` for a non-member redirects to `/dashboard` (RLS returns null) — eb8bb25
- [x] 2.7 Duplicate name shows the inline error and creates nothing — eb8bb25
