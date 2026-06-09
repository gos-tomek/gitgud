# F-01: Access Control & Board Membership Implementation Plan

## Overview

Introduce the project's first domain schema — `boards` and `board_members` — with Row-Level Security enabled on every operation from day one. Expose a tiny app-side helper (`getUserBoards`, `getBoardWithRole`) so downstream slices can resolve the current user's boards and role without re-deriving the rules. Role is **not stored**; it is derived from `auth.uid() = boards.owner_user_id`, which keeps the schema minimal and turns FR-016 ("creator = EM") into a database invariant rather than an app-level convention.

## Current State Analysis

- **Auth is in place.** Supabase SSR cookie sessions are wired end-to-end (`src/lib/supabase.ts`, `src/middleware.ts`). `context.locals.user` is populated on every request. Signup / signin / signout API routes work (`src/pages/api/auth/*.ts`) — they're form-based and redirect with `?error=` rather than returning JSON.
- **Data layer is empty.** `supabase/migrations/` does not exist; only `supabase/config.toml` is present. `src/types.ts` is empty.
- **Routing is minimal.** Only `/dashboard` is in `PROTECTED_ROUTES`. No domain API endpoints. Dashboard currently displays `Astro.locals.user?.email`.
- **Toolchain.** Lint + Prettier + build are the only CI gates (`.github/workflows/ci.yml`); no test runner is wired (no vitest, no playwright). Manual verification is the validation path.
- **Constraints from foundation docs.**
  - Cloudflare workerd runtime (`@astrojs/cloudflare`, `output: "server"`).
  - Anon key only — service-role key is forbidden in request paths (infrastructure.md).
  - Every new table must have RLS enabled with granular per-operation, per-role policies (CLAUDE.md).
  - Migration filename convention: `YYYYMMDDHHmmss_short_description.sql`.

## Desired End State

After this change lands:

1. `boards` and `board_members` tables exist in the Supabase schema with RLS enabled and per-operation policies covering SELECT / INSERT / UPDATE / DELETE.
2. A user can only create a board where they are the owner (`WITH CHECK (owner_user_id = auth.uid())`), so FR-016 ("creator = EM") is a database invariant.
3. A user can only see boards they are a member of. A user can only read other members of boards they own.
4. The app exposes `getUserBoards(supabase)` and `getBoardWithRole(supabase, boardId)` from `src/lib/services/boards.ts`, returning typed results with the role derived from `owner_user_id`.
5. A seed file (`supabase/seed.sql`) creates two boards and a shared IC across them so the EM/IC role flip is observable in local dev.
6. `/dashboard` renders a small "Your boards" list with EM or IC badges per row — proof that the helper and RLS both work end-to-end.

### Key Discoveries:

- **No prior membership/role infrastructure exists.** Grep for `membership`, `board`, `role`, `EM`, `IC`, `rls` in `src/` returns nothing relevant. Greenfield design — no compatibility constraints.
- **`updateRow()`-style triggers and audit columns are not part of any existing pattern.** F-01 establishes the schema conventions every later slice will inherit.
- **Auth client factory pattern is `createClient(requestHeaders, cookies)`** from `src/lib/supabase.ts` — helpers must accept the request-scoped Supabase client (not import a global) so RLS policies fire against the user's identity.
- **Dashboard currently has no React island** — adding the boards list as plain Astro markup keeps the page server-rendered and avoids new hydration cost.

## What We're NOT Doing

- **No board-creation UI or API.** That is S-01's deliverable. In F-01, boards can be created only via seed or SQL Editor.
- **No invitations.** That is S-03 (`invite-and-join-board`). F-01's `board_members` INSERT policy already supports owner-driven inserts, which S-03 will build on.
- **No GitHub linking.** That is F-02 / S-02. `boards.github_org` and friends arrive in their own migration.
- **No `profiles` table.** Deferred to S-04 when display names, avatars, and metrics need a home.
- **No `updated_at` triggers.** F-01 doesn't mutate any rows it creates.
- **No middleware role enrichment.** Pages/routes call the helper on demand; middleware keeps its current shape.
- **No service-role key usage anywhere.**
- **No tests added.** The project has no test runner; F-01 doesn't bring one. Validation is lint + build + manual.

## Implementation Approach

The change ships in two phases that commit independently:

1. **Schema, RLS & app helpers** — the migration + types + service helper. This phase has no user-visible delta; its automated gate is `supabase db reset && lint && build`.
2. **Verification surface** — `supabase/seed.sql` + a small "Your boards" list on `/dashboard` + a documented SQL Editor walk-through. This is the manual-test gate.

Splitting is deliberate: Phase 1 is the load-bearing foundation; Phase 2 is the observability scaffolding for this one slice. If Phase 2 needed to change for stylistic reasons later, Phase 1 wouldn't be touched.

## Critical Implementation Details

- **Role is not a column.** If the implementer is tempted to add `board_members.role TEXT` or a `board_role` enum "for clarity", stop. Role is a derived value (`auth.uid() = boards.owner_user_id`), and adding storage creates two sources of truth that can drift.
- **RLS recursion — break the `boards`↔`board_members` cycle with SECURITY DEFINER helpers.** Postgres applies RLS to any table referenced inside a policy expression. If `boards.SELECT` subqueries `board_members` _and_ `board_members.SELECT` subqueries `boards`, a SELECT on either table re-enters the other's policy and trips Postgres's recursion guard (`infinite recursion detected in policy for relation ...`). This is broader than self-reference. The fix: do membership/ownership lookups through `SECURITY DEFINER` functions (`public.is_board_member`, `public.is_board_owner`) that run as their owner and bypass RLS on the tables they read, so no policy re-entry occurs. Both functions must pin `set search_path = public` to avoid the definer-function search-path hijack footgun. These functions also establish the helper-function convention later slices reuse.
- **Service-role is forbidden in app code.** All helpers accept the request-scoped Supabase client built from cookies in `src/lib/supabase.ts`, so policies fire against the user's identity.
- **Migration filename uses UTC stamp.** Pattern `YYYYMMDDHHmmss_short_description.sql`. This change adds exactly one migration.
- **Both tables `REVOKE ALL ... FROM anon` explicitly.** Anonymous requests must never see board data even by accident.

---

## Phase 1: Schema, RLS & app helpers

### Overview

Land the migration that defines `boards` + `board_members` + their RLS policies, plus the TypeScript types and service helper the rest of the app will consume. No UI changes in this phase.

### Changes Required:

#### 1. First migration

**File:** `supabase/migrations/20260529120000_access_control_and_membership.sql`

**Intent:** Create the foundational schema for board ownership and membership with RLS enforced from the first byte. This is the project's first migration, so it also establishes the naming + structure convention for every later one.

**Contract:**

- `CREATE TABLE public.boards`:
  - `id uuid primary key default gen_random_uuid()`
  - `name text not null check (length(trim(name)) > 0)`
  - `owner_user_id uuid not null references auth.users(id) on delete cascade`
  - `created_at timestamptz not null default now()`
  - `updated_at timestamptz not null default now()`
- `CREATE TABLE public.board_members`:
  - `board_id uuid not null references public.boards(id) on delete cascade`
  - `user_id uuid not null references auth.users(id) on delete cascade`
  - `joined_at timestamptz not null default now()`
  - `primary key (board_id, user_id)`
- `CREATE INDEX board_members_user_id_idx ON public.board_members (user_id)` — speeds up "list my boards".
- `ALTER TABLE public.boards ENABLE ROW LEVEL SECURITY`.
- `ALTER TABLE public.board_members ENABLE ROW LEVEL SECURITY`.
- `REVOKE ALL ON public.boards FROM anon`. Same for `public.board_members`.
- **SECURITY DEFINER helper functions** (break the `boards`↔`board_members` RLS recursion cycle — see Critical Implementation Details):
  - `CREATE FUNCTION public.is_board_member(p_board_id uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$ SELECT EXISTS (SELECT 1 FROM public.board_members WHERE board_id = p_board_id AND user_id = auth.uid()); $$;`
  - `CREATE FUNCTION public.is_board_owner(p_board_id uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$ SELECT EXISTS (SELECT 1 FROM public.boards WHERE id = p_board_id AND owner_user_id = auth.uid()); $$;`
  - `REVOKE ALL ON FUNCTION public.is_board_member(uuid), public.is_board_owner(uuid) FROM public, anon;` then `GRANT EXECUTE ... TO authenticated;` — only authenticated requests may call them.
- Policies — all `TO authenticated`. Because the helpers run as definer and bypass RLS on the tables they read, the cross-table policy references below no longer recurse:
  - `boards`:
    - **SELECT** `USING (public.is_board_member(id))`.
    - **INSERT** `WITH CHECK (owner_user_id = auth.uid())`.
    - **UPDATE** `USING (owner_user_id = auth.uid()) WITH CHECK (owner_user_id = auth.uid())`.
    - **DELETE** `USING (owner_user_id = auth.uid())`.
  - `board_members`:
    - **SELECT** `USING (user_id = auth.uid() OR public.is_board_owner(board_id))`.
    - **INSERT** `WITH CHECK (public.is_board_owner(board_id))`.
    - **UPDATE** — omitted (no policy = no rows updatable).
    - **DELETE** `USING (user_id = auth.uid() OR public.is_board_owner(board_id))`.

#### 2. TypeScript types

**File:** `src/types.ts`

**Intent:** Give the rest of the app a typed surface for boards, memberships, and the derived role so call sites stop using `any`.

**Contract:** Export three named types:

- `BoardRole = "em" | "ic"` — TypeScript-only union, never persisted.
- `Board = { id: string; name: string; ownerUserId: string; createdAt: string; updatedAt: string }`.
- `UserBoard = Board & { role: BoardRole }`.

Column-name mapping (`owner_user_id` → `ownerUserId`) happens inside the helper, not at call sites.

#### 3. Board service helper

**File:** `src/lib/services/boards.ts` (new file; create the `services/` directory)

**Intent:** Two helpers that every downstream slice will call. They accept the request-scoped Supabase client so RLS applies; neither uses the service-role key.

**Contract:**

Both helpers type their `supabase` parameter as the **non-null** request-scoped client (the return type of `createClient` excluding `null`). Null-handling is the caller's job — see the dashboard contract in Phase 2.

- `getUserBoards(supabase): Promise<UserBoard[]>`
  - Reads `auth.getUser()` to obtain the current user id.
  - Queries `boards` joined to `board_members` filtered on `user_id`: `from('boards').select('id,name,owner_user_id,created_at,updated_at,board_members!inner(user_id)').eq('board_members.user_id', userId).order('created_at', { ascending: false })`.
  - Maps each row to camelCase and derives `role` per row from `ownerUserId === userId`.
- `getBoardWithRole(supabase, boardId): Promise<UserBoard | null>`
  - Single-row variant.
  - Returns `null` when RLS denies the read (i.e., not a member).
  - Never throws on "not found" — only on actual connection / SDK errors.

Both helpers are pure functions (no shared state, no I/O outside the passed client) so React Compiler rules don't trip.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npx supabase db reset` succeeds with no errors.
- RLS smoke check passes: a self-contained psql script (run against the local DB URL) proves the policies behave, catching recursion (F1) and inverted `USING`/`WITH CHECK` before Phase 2. The script runs in a single transaction that **rolls back** at the end so it leaves no residue and does not depend on Phase 2's `seed.sql`:
  - Insert (as a privileged role) one owner user + one member user + one outsider user, one board, and the owner+member membership rows.
  - `SET LOCAL role authenticated; SELECT set_config('request.jwt.claims', '{"sub":"<member-uuid>"}', true);` → assert `SELECT count(*) FROM public.boards = 1` and the board is visible (proves no recursion error is raised — a recursion bug surfaces here as a thrown error, failing the script).
  - Re-impersonate the outsider → assert `SELECT count(*) FROM public.boards = 0`.
  - `ROLLBACK`.
  - The script exits non-zero on any failed assertion or thrown policy error.
- Linting passes: `npm run lint`.
- Build passes: `npm run build` produces an SSR bundle without TypeScript errors.

#### Manual Verification:

- _Deferred to Phase 2 — the full UI verification surface lives there._

**Implementation Note**: Phase 1 has no user-visible delta. The manual gate is Phase 2.

---

## Phase 2: Verification surface

### Overview

Add the seed file, the dashboard "Your boards" list, and a SQL Editor walk-through. After this phase, the EM/IC role split is observable in local dev without any further code.

### Changes Required:

#### 1. Seed file

**File:** `supabase/seed.sql` (new file)

**Intent:** Make F-01 observable in local dev without needing the future S-01 UI. Two boards owned by two different seed users plus a shared IC, so logging in as each user reveals a different role split.

**Contract:**

- Inserts three `auth.users` rows directly with `encrypted_password = crypt('password', gen_salt('bf'))`. Dev-only emails: `em-1@example.test`, `em-2@example.test`, `ic-1@example.test`. Password documented in a comment at the top of the file. Each user row must set `email_confirmed_at = now()` (config has `enable_confirmations = false`, but the column must still be non-null for login) along with the usual `instance_id`, `aud = 'authenticated'`, `role = 'authenticated'`.
- **Inserts one `auth.identities` row per seeded user** — required for email+password login in current GoTrue; without it the manual login checks below fail even though the data is correct. Each row: `provider = 'email'`, `provider_id = <user-uuid>`, `user_id = <user-uuid>`, and `identity_data = jsonb_build_object('sub', <user-uuid>::text, 'email', <email>)`.
- Inserts two `public.boards` rows: one owned by `em-1`, one by `em-2`.
- Inserts four `public.board_members` rows: each EM as a member of their own board (the "owner is also a member" invariant), plus the shared IC as a member of both boards.
- Every INSERT uses `ON CONFLICT DO NOTHING` so the seed is idempotent against `supabase db reset` re-runs.

#### 2. Dashboard "Your boards" list

**File:** `src/pages/dashboard.astro`

**Intent:** Render the helper's output so the role-derivation path is exercised on a real request. This is the manual-test surface for F-01.

**Contract:** In the Astro frontmatter, build `supabase = createClient(Astro.request.headers, Astro.cookies)`. Because `createClient` returns `null` when env vars are missing (`src/lib/supabase.ts:6`), guard before use — mirror the middleware pattern: if `supabase` is null, treat `boards` as an empty array (render the empty state) and skip the call. Otherwise call `getUserBoards(supabase)`. This keeps the helper param non-null and the page type-checks under `strict`. Below the existing email line, render:

- A heading "Your boards".
- A `<ul>` of board names, each followed by an `EM` or `IC` text badge (small Tailwind pill — reuse the project's existing color tokens).
- Empty state: a single italic line "You don't belong to any boards yet." when the list is empty.
- No new components, no React island.

#### 3. SQL Editor walk-through (documentation only)

Three SQL snippets the reviewer runs in Studio's SQL Editor as different users to confirm RLS is enforcing. They live in this plan, not in the codebase. To simulate a user, use:

```sql
SET LOCAL role authenticated;
SET LOCAL request.jwt.claims = '{"sub":"<user-uuid>"}';
```

Snippets:

1. As `em-1`: `SELECT * FROM public.boards` → returns one row (board 1 only).
2. As `em-1`: `SELECT * FROM public.board_members WHERE board_id = '<board-2-id>'` → returns zero rows.
3. As `ic-1`: `SELECT * FROM public.boards` → returns both rows.

### Success Criteria:

#### Automated Verification:

- `npx supabase db reset` re-applies migration + seed cleanly with no errors.
- `npm run lint` passes after the dashboard change.
- `npm run build` produces an SSR bundle without TypeScript errors.

#### Manual Verification:

- Log in to local dev as `em-1@example.test`; hit `/dashboard`. The boards list shows one entry with the `EM` badge.
- Log out, log in as `ic-1@example.test`; hit `/dashboard`. The list shows both boards, both with the `IC` badge.
- Run the three SQL Editor snippets above; results match expectations.
- Sign up a brand-new user; hit `/dashboard`. The boards list shows the "You don't belong to any boards yet." empty state.

**Implementation Note**: After Phase 2 automated verification passes, pause here for manual confirmation that the four manual checks above pass before considering F-01 complete.

---

## Testing Strategy

The project has no test runner. Strategy is:

- **Schema correctness** — `npx supabase db reset` is the canonical check that the migration parses and applies.
- **RLS correctness** — manual SQL Editor walk-through against the seeded fixtures (three snippets above).
- **End-to-end correctness** — manual UI walk-through of the dashboard against the three seeded users + one fresh signup.
- **No regressions** — `npm run lint && npm run build` must remain green; pre-commit hooks already enforce ESLint + Prettier on staged files.

## Performance Considerations

Negligible at MVP scale. The "list my boards" query touches an index (`board_members_user_id_idx`) and joins to `boards` on PK. The dashboard becomes one extra SELECT per render — acceptable on Cloudflare workerd within the free tier 10ms CPU budget for an SSR page that previously did only `auth.getUser()`.

If a future slice adds high-cardinality lookups (e.g., per-comment classification reads), revisit; F-01 itself does not move any needle.

## Migration Notes

- This is the project's first migration. No existing data, no rollback concerns.
- Cloudflare adapter and `astro:env` schema are unaffected (no new env vars).
- Downstream slices that add columns to these tables (e.g., `boards.github_org` in F-02) will own their own migration. F-01 does not pre-add columns it doesn't use.

## References

- Roadmap entry: `context/foundation/roadmap.md` § F-01 (lines 67–78).
- PRD: `context/foundation/prd.md` § Access Control, § Authentication (FR-014, FR-015, FR-016), § Functional Requirements FR-001..FR-005, FR-017.
- Stack constraints: `context/foundation/tech-stack.md`, `context/foundation/infrastructure.md`.
- Auth scaffolding to reuse: `src/lib/supabase.ts`, `src/middleware.ts`, `src/pages/api/auth/*.ts`, `src/pages/dashboard.astro`.
- Change identity: `context/changes/access-control-and-membership/change.md`.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Schema, RLS & app helpers

#### Automated

- [x] 1.1 Migration applies cleanly: `npx supabase db reset` — 62baceb
- [x] 1.2 RLS smoke check passes: self-contained rolled-back psql script asserts member sees 1 board, outsider sees 0, no recursion error — 62baceb
- [x] 1.3 Linting passes: `npm run lint` — 62baceb
- [x] 1.4 Build passes: `npm run build` — 62baceb

### Phase 2: Verification surface

#### Automated

- [x] 2.1 `npx supabase db reset` re-applies migration + seed cleanly — ec36d52
- [x] 2.2 `npm run lint` passes — ec36d52
- [x] 2.3 `npm run build` passes — ec36d52

#### Manual

- [x] 2.4 `em-1@example.test` dashboard shows one board with `EM` badge — ec36d52
- [x] 2.5 `ic-1@example.test` dashboard shows both boards with `IC` badge — ec36d52
- [x] 2.6 SQL Editor walk-through snippets return expected rows — ec36d52
- [x] 2.7 Newly signed-up user sees empty-state on the dashboard — ec36d52
