# Link GitHub Account Implementation Plan

## Overview

Add a `github_login` field to the signup form so ICs can self-declare their GitHub identity. The system validates the login against the public GitHub API, stores it in a new `user_profiles` table, and uses it to derive board access — replacing the explicit `board_members` table with a join-based model (`board_contributors.github_id = user_profiles.github_id`). Owners retain access via `boards.owner_user_id`.

## Current State Analysis

- Signup is email+password only (`SignUpForm.tsx:66`, `signup.ts:13`). No user metadata is passed to Supabase auth.
- Board access is gated by `board_members` table. `is_board_member()` (`access_control_and_membership.sql:37-48`) checks for a row in `board_members`. Seven downstream RLS policies depend on this function.
- `board_contributors` has `user_id` (nullable) and `github_id`/`github_login`, but `user_id` is never populated.
- No `user_profiles` or equivalent table exists.
- Dashboard (`dashboard.astro:24`) shows "You don't have any boards yet" when `getUserBoards` returns empty.

### Key Discoveries:

- `is_board_member()` is a SECURITY DEFINER abstraction layer — all 7 RLS policies call this function. Changing its implementation means **no downstream policy changes** are needed.
- `boards.owner_user_id` already exists and `is_board_owner()` function already queries it — owner access doesn't need `board_members`.
- The `add_owner_as_board_member` trigger (`board_triggers.sql:28-40`) auto-inserts the owner into `board_members` on board creation — this trigger becomes unnecessary.
- `getUserBoards` (`boards.ts:26-36`) joins through `board_members` — after the refactor, RLS handles filtering so the join is unnecessary.
- Seed data (`seed.sql:68-74`) and 3 integration test files reference `board_members` directly.

## Desired End State

After this plan is complete:

1. The signup form has a "GitHub username" field. The API validates it against `GET https://api.github.com/users/{login}` and stores `github_id`, `github_login`, and `avatar_url` in `user_profiles`.
2. If GitHub API is unreachable, signup fails with a clear error message.
3. Board access for contributors is derived: `board_contributors.github_id = user_profiles.github_id`. No `board_members` row needed.
4. Board access for owners is derived: `boards.owner_user_id = auth.uid()`.
5. The `board_members` table, its trigger, RLS policies, and all code references are removed.
6. Dashboard shows a helpful message when the user has no boards, with a "Create board" option.
7. All existing integration tests pass against the new access model.

### Verification:

- `npm run lint` passes
- `npm run test:typecheck` passes
- `npm test` passes (unit + component + hermetic + integration)
- Manual: sign up with a valid GitHub username → see matching boards on dashboard
- Manual: sign up with a GitHub username not in any board → see "no boards" message + create option

## What We're NOT Doing

- OAuth / GitHub App integration (PRD explicitly excludes: `prd.md:182`)
- Invite-token flow (FR-003/FR-004 — rejected as too complex for now)
- Post-signup linking (e.g., settings page to change GitHub username)
- Auto-linking trigger on `board_contributors` INSERT (deferred — IC can refresh/re-login)
- Email confirmation enforcement (separate Supabase config concern, not a code change)

## Implementation Approach

**Tests first in each phase.** Write/update failing tests, then make the code changes that make them pass.

The refactor splits into 5 phases ordered by dependency:

1. **user_profiles table** — the new foundation. No existing code depends on it, so it can land independently.
2. **Signup form + API** — adds the GitHub username field and populates `user_profiles`. Still uses `board_members` for access at this point (existing behavior preserved).
3. **Refactor `is_board_member()`** — the key migration. Changes the function's implementation from `board_members` lookup to `owner_user_id + contributors⟕user_profiles` join. All downstream RLS policies continue to work unchanged.
4. **Refactor `getUserBoards` + dashboard UX** — simplifies the TypeScript query and updates the dashboard empty state.
5. **Drop `board_members`** — cleanup migration removing the now-unused table, trigger, policies, seed data, and test references.

## Critical Implementation Details

### RLS recursion cycle

The original `is_board_member()` is SECURITY DEFINER specifically to break an RLS recursion cycle: `boards` policies call `is_board_member()` which reads `board_members` whose policies call `is_board_owner()` which reads `boards`. The refactored function must remain SECURITY DEFINER and bypass RLS on `board_contributors` and `user_profiles` — otherwise the same recursion problem reappears through different tables.

### GitHub API rate limiting

The public `GET /users/{username}` endpoint allows 60 requests/hour per IP without authentication. For a self-hosted product with one team, this is sufficient. The plan does NOT add a GitHub PAT for this call — it stays unauthenticated.

---

## Phase 1: `user_profiles` — Migration + RLS Tests

### Overview

Create the `user_profiles` table and its RLS policies. Write integration tests for the new table's access rules before the migration lands.

### Changes Required:

#### 1. Integration tests for `user_profiles` RLS

**File**: `tests/integration/access-boundary.test.ts`

**Intent**: Add test cases for `user_profiles` access rules: a user can read their own profile, cannot read another user's profile, cannot insert/update/delete another user's profile. Tests should fail initially (table doesn't exist yet).

**Contract**: New `describe("user_profiles RLS")` block within the existing test structure. Uses `seedTwoBoards` fixture, which will need `user_profiles` rows seeded (see helper changes below).

#### 2. Test helper: seed `user_profiles` rows

**File**: `tests/helpers/seed.ts`

**Intent**: Extend `seedTwoBoards` to create `user_profiles` rows for both test owners so RLS tests have data to work with. Add `github_id` fields to the fixture interface.

**Contract**: `TwoBoardFixture.ownerA` and `ownerB` gain `githubId: number`. After creating test users, insert `user_profiles` rows via `adminClient`.

#### 3. Migration: `user_profiles` table

**File**: `supabase/migrations/YYYYMMDDHHMMSS_user_profiles.sql`

**Intent**: Create `user_profiles` with the user's GitHub identity. One profile per Supabase auth user, one GitHub identity per profile.

**Contract**:

```sql
CREATE TABLE public.user_profiles (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  github_id  bigint NOT NULL,
  github_login text NOT NULL,
  avatar_url text
);
```

RLS: `REVOKE ALL FROM anon, authenticated` then `GRANT SELECT, INSERT, UPDATE ON user_profiles TO authenticated`. Policies:

- SELECT: `USING (user_id = auth.uid())` — users can only read their own profile.
- INSERT: `WITH CHECK (user_id = auth.uid())` — users can only create their own profile.
- UPDATE: `USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid())` — users can only update their own profile.
- No DELETE policy — profiles are permanent.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npx supabase db reset`
- Type checking passes: `npx tsc --noEmit`
- Integration tests pass: `npx vitest run tests/integration/access-boundary.test.ts`

#### Manual Verification:

- Verify `user_profiles` table exists in Supabase Studio with correct columns and constraints

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Signup with `github_login` — Form + API + GitHub Validation

### Overview

Add a `github_login` field to the signup form, validate it against the GitHub API server-side, and create a `user_profiles` row on successful signup.

### Changes Required:

#### 1. Component test for SignUpForm

**File**: `tests/component/SignUpForm.test.ts` (new or extend existing)

**Intent**: Test that the form renders a `github_login` field, validates it client-side (required, no spaces, no `@` prefix), and submits it as form data.

**Contract**: Tests for: field presence, required validation, trimming/lowercase normalization, form submission includes `github_login` in FormData.

#### 2. Add `github_login` field to SignUpForm

**File**: `src/components/auth/SignUpForm.tsx`

**Intent**: Add a GitHub username input field between the email field and the password field.

**Contract**: New `FormField` with `id="githubLogin"`, `name="github_login"`. State: `const [githubLogin, setGithubLogin] = useState("")`. Client-side validation: required, no whitespace, stripped leading `@`. Icon: `Github` from lucide-react.

#### 3. Signup API: validate GitHub + create user via metadata

**File**: `src/pages/api/auth/signup.ts`

**Intent**: After reading `github_login` from form data, call `GET https://api.github.com/users/{login}` to validate and retrieve `github_id` + `avatar_url`. If GitHub API returns 404 or is unreachable, fail signup. On success, pass the GitHub identity as user metadata to `supabase.auth.signUp`. A database trigger (step 4) atomically creates the `user_profiles` row from this metadata.

**Contract**:

- Read `github_login` from form data, trim and lowercase.
- Fetch `https://api.github.com/users/${github_login}` with `Accept: application/json`.
- On 404: redirect with error "GitHub username not found".
- On network error / non-200: redirect with error "Could not verify GitHub username. Please try again later."
- On 200: extract `id` (→ `github_id`), `login` (→ `github_login` — use GitHub's canonical casing), `avatar_url`.
- Call `supabase.auth.signUp({ email, password, options: { data: { github_id, github_login, avatar_url } } })`.
- No separate `user_profiles` INSERT — the trigger from step 4 handles it atomically.
- If signUp returns an error (including trigger failures like missing metadata), redirect with a generic "Account creation failed. Please try again." message. The existing `error.message` redirect already covers standard auth errors.

#### 4. Database trigger: populate user_profiles from auth metadata

**File**: `supabase/migrations/YYYYMMDDHHMMSS_user_profiles_trigger.sql`

**Intent**: Create a trigger on `auth.users` that fires after INSERT and populates `user_profiles` from `raw_user_meta_data`. This makes profile creation atomic with signUp — no orphan auth users if the insert fails (the whole transaction rolls back).

**Contract**:

```sql
CREATE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_profiles (user_id, github_id, github_login, avatar_url)
  VALUES (
    NEW.id,
    (NEW.raw_user_meta_data->>'github_id')::bigint,
    NEW.raw_user_meta_data->>'github_login',
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
```

Note: `github_id` is NOT unique in `user_profiles` — multiple users may declare the same GitHub identity. This is acceptable in the self-hosted trust model.

#### 5. UserProfile type

**File**: `src/types.ts`

**Intent**: Add a TypeScript type for the `user_profiles` table row.

**Contract**: `export interface UserProfile { userId: string; githubId: number; githubLogin: string; avatarUrl: string | null; }`

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx tsc --noEmit` and `npm run test:typecheck`
- Lint passes: `npm run lint`
- Component tests pass: `npx vitest run tests/component/`
- Non-integration tests pass: `npx vitest run --exclude 'tests/integration/**'`

#### Manual Verification:

- Sign up with a valid GitHub username → account created, `user_profiles` row exists in Supabase Studio
- Sign up with a non-existent GitHub username → error "GitHub username not found"
- Sign up with GitHub API unreachable (e.g., disconnect network) → error about verification failure

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Refactor `is_board_member()` — Derived Access

### Overview

Rewrite `is_board_member()` to derive board access from `boards.owner_user_id` (for owners) and `board_contributors.github_id ⟕ user_profiles.github_id` (for contributors). This is the core architectural change. All 7 downstream RLS policies continue to call `is_board_member()` unchanged.

### Changes Required:

#### 1. Update integration tests for derived access

**File**: `tests/integration/access-boundary.test.ts`

**Intent**: Update the test fixture and assertions to reflect the new access model. Board access is now derived from `board_contributors + user_profiles` join, not `board_members` rows. Add test cases for:

- A contributor (user with matching `user_profiles.github_id` in `board_contributors`) can read the board and its data.
- A non-contributor (user without matching github_id) cannot read the board.
- Cross-board isolation still holds.

**Contract**:

- `seedTwoBoards` must create `user_profiles` for test users and add them as `board_contributors` (via admin) instead of relying on `board_members`.
- Remove tests that directly query `board_members` (SELECT, INSERT, DELETE denial tests for `board_members`).
- Add a new test user who is a contributor to Board A (has matching github_id) but not Board B — verify they can read Board A data but not Board B.

#### 2. Update test helper seed

**File**: `tests/helpers/seed.ts`

**Intent**: Refactor `seedTwoBoards` to create contributor access via `user_profiles` + `board_contributors` instead of `board_members`. Add a third test user who is a linked contributor.

**Contract**:

- After creating users, insert `user_profiles` rows with unique `github_id` values.
- Add `board_contributors` entries linking the contributor's `github_id` to the boards they should access.
- Stop inserting `board_members` rows (the trigger still inserts owner rows at this point — that's OK, they'll be ignored by the new `is_board_member()`).
- Extend `TwoBoardFixture` with a contributor user: `contributor: { client, userId, githubId }`.

#### 3. Migration: rewrite `is_board_member()`

**File**: `supabase/migrations/YYYYMMDDHHMMSS_derived_board_access.sql`

**Intent**: Replace the `is_board_member()` implementation to check ownership via `boards.owner_user_id` and contributor access via `board_contributors ⟕ user_profiles`, instead of looking up `board_members`.

**Contract**:

```sql
CREATE OR REPLACE FUNCTION public.is_board_member(p_board_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.boards
    WHERE id = p_board_id AND owner_user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1
    FROM public.board_contributors bc
    JOIN public.user_profiles up ON bc.github_id = up.github_id
    WHERE bc.board_id = p_board_id AND up.user_id = auth.uid()
  );
$$;
```

Must remain SECURITY DEFINER to bypass RLS on `boards`, `board_contributors`, and `user_profiles` — avoiding the recursion cycle.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npx supabase db reset`
- Integration tests pass: `npx vitest run tests/integration/`
- All non-integration tests pass: `npx vitest run --exclude 'tests/integration/**'`
- Type checking passes: `npx tsc --noEmit`

#### Manual Verification:

- Sign up with a GitHub username that matches a `board_contributors` entry → dashboard shows the matching board(s)
- Sign up with a GitHub username not in any board → dashboard shows "no boards" message
- Board owner (EM) still sees their own boards without being a contributor
- Existing cross-board isolation holds: user cannot see boards where they are neither owner nor contributor

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Refactor `getUserBoards` + Dashboard UX

### Overview

Simplify the `getUserBoards` query (remove `board_members` join, rely on RLS) and update the dashboard empty state with a more helpful message.

### Changes Required:

#### 1. Simplify `getUserBoards`

**File**: `src/lib/services/boards.ts`

**Intent**: Remove the `board_members!inner(user_id)` join from the query. With the refactored `is_board_member()` in RLS, a simple `SELECT` on `boards` already returns only boards the user can access.

**Contract**: The query becomes:

```ts
const { data, error } = await supabase
  .from("boards")
  .select("id,name,owner_user_id,created_at,updated_at")
  .order("created_at", { ascending: false });
```

#### 2. Remove `board_contributors.user_id` references

**File**: `src/lib/services/boards.ts`

**Intent**: The `getBoardContributors` function returns `userId` from `board_contributors.user_id`. This column becomes unnecessary — contributor-to-user linking is via `github_id ⟕ user_profiles`. Remove `user_id` from the select and mapping.

**Contract**: Remove `user_id` from the `.select()` call and from the return mapping in `getBoardContributors`.

#### 3. Update `BoardContributor` type

**File**: `src/types.ts`

**Intent**: Remove `userId` field from `BoardContributor` since the link is now through `github_id ⟕ user_profiles`.

**Contract**: Remove `userId: string | null` from `BoardContributor` interface.

#### 4. Update dashboard empty state

**File**: `src/pages/dashboard.astro`

**Intent**: Improve the empty state message to clarify why the user has no boards — either they haven't been added as a contributor or they haven't created a board yet.

**Contract**: Update the copy in the empty state section. Keep the "Create your first board" CTA. Add a line like "Your GitHub username hasn't been added as a contributor to any board yet. Ask your EM to add you, or create your own board."

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx tsc --noEmit` and `npm run test:typecheck`
- Lint passes: `npm run lint`
- All tests pass: `npm test`

#### Manual Verification:

- Dashboard shows boards correctly for contributors and owners
- Empty state shows the updated message with "Create board" option
- Board detail pages still load correctly

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 5: Drop `board_members` — Cleanup

### Overview

Remove the now-unused `board_members` table, its trigger, RLS policies, privilege grants, and all remaining code/test/seed references.

### Changes Required:

#### 1. Migration: drop `board_members` and related objects

**File**: `supabase/migrations/YYYYMMDDHHMMSS_drop_board_members.sql`

**Intent**: Remove the `board_members` table and all objects that depend on it: the auto-insert trigger, the trigger function, RLS policies, and privilege grants.

**Contract**:

```sql
-- Drop trigger first (depends on function and table)
DROP TRIGGER IF EXISTS boards_insert_owner_as_member ON public.boards;
DROP FUNCTION IF EXISTS public.add_owner_as_board_member();

-- Drop policies (depend on table)
DROP POLICY IF EXISTS board_members_select ON public.board_members;
DROP POLICY IF EXISTS board_members_insert ON public.board_members;
DROP POLICY IF EXISTS board_members_delete ON public.board_members;

-- Drop the table
DROP TABLE IF EXISTS public.board_members;
```

#### 2. Remove `board_contributors.user_id` column

**File**: `supabase/migrations/YYYYMMDDHHMMSS_drop_board_members.sql` (same migration)

**Intent**: The `user_id` column on `board_contributors` is now unused — linking is through `github_id ⟕ user_profiles`. Remove it.

**Contract**: `ALTER TABLE public.board_contributors DROP COLUMN IF EXISTS user_id;`

#### 3. Remove `board_members` from hardening migration grants

**File**: `supabase/migrations/20260614120000_revoke_all_hardening.sql`

**Intent**: Remove the `REVOKE ALL` and `GRANT` lines for `board_members` since the table no longer exists.

**Contract**: Remove lines 11 and 19 referencing `public.board_members`.

#### 4. Update seed data

**File**: `supabase/seed.sql`

**Intent**: Replace `board_members` inserts with `user_profiles` inserts so seed users get board access through the new derived model.

**Contract**: Remove `INSERT INTO public.board_members` block (lines 68-74). Add `INSERT INTO public.user_profiles` for the contributor user, and `INSERT INTO public.board_contributors` entries linking their `github_id` to both boards.

#### 5. Remove `board_members` test references

**File**: `tests/integration/access-boundary.test.ts`

**Intent**: Remove any remaining test cases that directly query or assert against `board_members`.

**Contract**: Remove `board_members` SELECT/INSERT/DELETE denial tests if not already removed in Phase 3. Remove comments referencing `board_members`.

#### 6. Update remaining integration tests

**Files**: `tests/integration/pat-leak.test.ts`, `tests/integration/smoke.test.ts`

**Intent**: Remove `board_members` references from these test files.

**Contract**: In `pat-leak.test.ts`, replace the `board_members` setup with `user_profiles` + `board_contributors` setup. In `smoke.test.ts`, update comments referencing `is_board_member`.

#### 7. Clean up `create_board_atomic` RPC

**File**: `supabase/migrations/YYYYMMDDHHMMSS_drop_board_members.sql` (same migration)

**Intent**: The `create_board_atomic` RPC doesn't reference `board_members` directly (the trigger handled it). No changes needed to the RPC itself. Verify this is the case.

**Contract**: No code change — verification only.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npx supabase db reset`
- Type checking passes: `npx tsc --noEmit` and `npm run test:typecheck`
- Lint passes: `npm run lint`
- All tests pass: `npm test`
- Build succeeds: `npm run build`

#### Manual Verification:

- Full signup → dashboard flow works end-to-end
- Board creation still works (owner sees board via `owner_user_id`)
- `board_members` table no longer exists in Supabase Studio
- No references to `board_members` remain in codebase (verified via grep)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding.

---

## Testing Strategy

### Integration Tests:

- `access-boundary.test.ts` — updated for derived access model: owner access via `owner_user_id`, contributor access via `user_profiles ⟕ board_contributors`, cross-board isolation preserved
- `pat-leak.test.ts` — updated setup (no `board_members`)
- `smoke.test.ts` — updated setup

### Component Tests:

- `SignUpForm` — new `github_login` field: renders, validates, submits

### Manual Testing Steps:

1. Sign up with valid GitHub username (matching a board contributor) → see board on dashboard
2. Sign up with valid GitHub username (not matching any contributor) → see "no boards" message + create option
3. Sign up with invalid GitHub username → error message
4. Sign up when GitHub API is down → error about verification failure
5. EM creates board → EM sees board (owner access)
6. EM adds contributor with matching `github_id` → contributor sees board after refresh

## Performance Considerations

`is_board_member()` changes from a single-table PK lookup (`board_members(board_id, user_id)`) to two EXISTS subqueries (one on `boards`, one joining `board_contributors` + `user_profiles`). Mitigation:

- `boards.id` is PK — indexed.
- `board_contributors(board_id, github_id)` is PK — indexed. The join to `user_profiles` uses `github_id` which has a UNIQUE index.
- `user_profiles.user_id` is PK — indexed. The `auth.uid()` comparison uses this index.
- For the expected scale (single-team, <100 contributors), this is negligible.

## Migration Notes

- All migrations are additive until Phase 5 (expand/contract pattern). Phase 5 is destructive (DROP TABLE) — it should only land after Phase 3 and 4 are verified.
- The hardening migration (`20260614120000_revoke_all_hardening.sql`) is modified in-place — this is safe because Supabase migrations are idempotent on `db reset` but not re-run on `db push`. The DROP migration handles removing the stale grants at runtime.
- Seed data changes are backward-incompatible — `supabase db reset` applies all migrations + seed together, so this is fine.

## References

- Frame brief: `context/changes/link-github-account/frame.md`
- PRD (no OAuth in MVP): `context/foundation/prd.md:182`
- Existing atomic RPC pattern: `supabase/migrations/20260611120000_create_board_atomic.sql`
- Existing access model: `supabase/migrations/20260529120000_access_control_and_membership.sql`
- Board trigger: `supabase/migrations/20260529130000_board_triggers.sql:28-40`
- Lessons learned (REVOKE ALL): `context/foundation/lessons.md:22-30`
- Lessons learned (useFormStatus): `context/foundation/lessons.md:6-14`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: user_profiles — Migration + RLS Tests

#### Automated

- [x] 1.1 Migration applies cleanly (`npx supabase db reset`)
- [x] 1.2 Type checking passes (`npx tsc --noEmit`)
- [x] 1.3 Integration tests pass (`npx vitest run tests/integration/access-boundary.test.ts`)

#### Manual

- [x] 1.4 Verify `user_profiles` table in Supabase Studio

### Phase 2: Signup with github_login — Form + API + GitHub Validation

#### Automated

- [ ] 2.1 Type checking passes (`npx tsc --noEmit` and `npm run test:typecheck`)
- [ ] 2.2 Lint passes (`npm run lint`)
- [ ] 2.3 Component tests pass (`npx vitest run tests/component/`)
- [ ] 2.4 Non-integration tests pass (`npx vitest run --exclude 'tests/integration/**'`)

#### Manual

- [ ] 2.5 Sign up with valid GitHub username → `user_profiles` row created
- [ ] 2.6 Sign up with non-existent GitHub username → error message
- [ ] 2.7 Sign up with GitHub API unreachable → error about verification failure

### Phase 3: Refactor is_board_member() — Derived Access

#### Automated

- [ ] 3.1 Migration applies cleanly (`npx supabase db reset`)
- [ ] 3.2 Integration tests pass (`npx vitest run tests/integration/`)
- [ ] 3.3 Non-integration tests pass (`npx vitest run --exclude 'tests/integration/**'`)
- [ ] 3.4 Type checking passes (`npx tsc --noEmit`)

#### Manual

- [ ] 3.5 Contributor sees matching boards on dashboard
- [ ] 3.6 Non-contributor sees "no boards" message
- [ ] 3.7 Board owner still sees own boards
- [ ] 3.8 Cross-board isolation holds

### Phase 4: Refactor getUserBoards + Dashboard UX

#### Automated

- [ ] 4.1 Type checking passes (`npx tsc --noEmit` and `npm run test:typecheck`)
- [ ] 4.2 Lint passes (`npm run lint`)
- [ ] 4.3 All tests pass (`npm test`)

#### Manual

- [ ] 4.4 Dashboard shows boards correctly for contributors and owners
- [ ] 4.5 Empty state shows updated message with "Create board" option
- [ ] 4.6 Board detail pages still load correctly

### Phase 5: Drop board_members — Cleanup

#### Automated

- [ ] 5.1 Migration applies cleanly (`npx supabase db reset`)
- [ ] 5.2 Type checking passes (`npx tsc --noEmit` and `npm run test:typecheck`)
- [ ] 5.3 Lint passes (`npm run lint`)
- [ ] 5.4 All tests pass (`npm test`)
- [ ] 5.5 Build succeeds (`npm run build`)

#### Manual

- [ ] 5.6 Full signup → dashboard flow works end-to-end
- [ ] 5.7 Board creation still works
- [ ] 5.8 `board_members` table no longer exists in Supabase Studio
- [ ] 5.9 No `board_members` references in codebase (`grep -r "board_members" src/ supabase/ tests/`)
