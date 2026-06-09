# F-01: Access Control & Board Membership — Plan Brief

> Full plan: `context/changes/access-control-and-membership/plan.md`

## What & Why

GitGud has Supabase email + password auth but zero domain schema — no boards, no memberships, no notion of who is EM vs IC. Every downstream slice in the roadmap (S-01 board creation, S-03 invites, S-04 IC profile, F-03 classification batch) depends on this question being answerable. F-01 introduces the `boards` + `board_members` tables, enables Row-Level Security on every operation from day one, and exposes a small app-side helper for resolving the current user's boards and role.

## Starting Point

Supabase SSR cookie auth is wired end-to-end; `context.locals.user` is populated on every request. The data layer is empty — no `supabase/migrations/` directory exists, `src/types.ts` is empty, and there are no domain API routes. Lint + build are the only CI gates (no test runner). This is the project's first migration.

## Desired End State

Two new tables with full per-operation RLS. The board owner (`boards.owner_user_id`) is the EM by definition — role is a derived value, never stored. A typed helper (`getUserBoards`, `getBoardWithRole`) returns each row with `role` computed at the call site from `ownerUserId === currentUserId`. The dashboard renders a small "Your boards" list with `EM`/`IC` badges so the whole path is observable in local dev.

## Key Decisions Made

| Decision                     | Choice                                                                | Why (1 sentence)                                                                                          | Source |
| ---------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------ |
| Deliverable scope            | Schema + RLS + role-lookup helper + small verification surface        | Tight foundation; S-01 keeps the board-creation UX as its own deliverable.                                | Plan   |
| `profiles` table now?        | No — FK directly to `auth.users(id)`                                  | Smallest schema delta; S-04 introduces profiles when it actually needs display names / metrics.           | Plan   |
| EM count per board           | Exactly one (the creator)                                             | Matches the PRD reading (FR-016) and simplifies ownership semantics.                                      | Plan   |
| Role representation          | Not stored — derived from `auth.uid() = boards.owner_user_id`         | Eliminates an enum + a column; FR-016 ("creator = EM") becomes a database invariant via RLS `WITH CHECK`. | Plan   |
| Owner row in `board_members` | Yes — owner is also a member                                          | Makes "list my boards" and "is X a member?" each a single-table query; uniform RLS shape.                 | Plan   |
| Cascades                     | `ON DELETE CASCADE` on all FKs; no soft delete                        | Standard Supabase pattern; no audit-trail requirement at MVP.                                             | Plan   |
| Role lookup propagation      | On-demand via helper in pages/routes                                  | Pages that don't need boards pay nothing; middleware stays minimal.                                       | Plan   |
| Verification approach        | `supabase/seed.sql` + dashboard role badges + SQL Editor walk-through | No throwaway endpoints; exercises the real policies; reproducible from the plan doc.                      | Plan   |

## Scope

**In scope:**

- One migration creating `boards` and `board_members` with FKs, indexes, RLS enabled, and 7 policies (boards × 4, board_members × 3 — UPDATE intentionally omitted).
- `src/types.ts` populated with `BoardRole`, `Board`, `UserBoard`.
- `src/lib/services/boards.ts` exporting `getUserBoards` and `getBoardWithRole`.
- `supabase/seed.sql` with 3 users, 2 boards, 4 memberships.
- Small "Your boards" list on `/dashboard` with role badges.

**Out of scope:**

- Board-creation UI or API (S-01).
- Invitations (S-03).
- GitHub linking (F-02 / S-02).
- `profiles` table (S-04).
- Middleware role enrichment.
- Tests (no runner exists; F-01 doesn't add one).
- `updated_at` triggers (no flow in F-01 mutates rows).
- Service-role key usage anywhere.

## Architecture / Approach

```
auth.users (Supabase-managed)
    │
    ├──< boards.owner_user_id                          ─┐
    │                                                   │  joined via
    └──< board_members.user_id ────> boards.id           │  board_members
                                                         │  for RLS
                                                       <─┘
```

The schema is two tables with cascading FKs. RLS policies are read in plain English:

- A user can see boards they are a member of.
- A user can create a board only if they put themselves as owner.
- A user can update/delete only boards they own.
- A user can see other members only of boards they own (plus their own row).
- An owner can add/remove members of their board; any member can self-leave.

The app reads through `src/lib/services/boards.ts`, which builds on the existing cookie-bound Supabase client (`src/lib/supabase.ts`). No service-role anywhere.

## Phases at a Glance

| Phase                        | What it delivers                                                           | Key risk                                                                       |
| ---------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 1. Schema, RLS & app helpers | Migration, RLS policies, types, board service helper                       | RLS recursion on `board_members` SELECT — must not self-reference.             |
| 2. Verification surface      | `supabase/seed.sql`, dashboard "Your boards" list, SQL Editor walk-through | Seed-time `INSERT INTO auth.users` patterns can be Supabase-version-sensitive. |

**Prerequisites:** existing Supabase auth wiring (already in place). Local Docker for `npx supabase start` if reviewing locally.

**Estimated effort:** ~1–2 sessions across the 2 phases.

## Open Risks & Assumptions

- **RLS recursion in `board_members` SELECT.** The policy must check ownership via `boards.owner_user_id` directly, not by querying `board_members` again. This is called out in the plan but easy to get wrong.
- **`INSERT INTO auth.users` in seed.sql** is undocumented but commonly used in Supabase community examples. If the CLI version on the developer machine rejects it, fall back to inserting via Studio UI.
- **No test coverage.** Regressions surface only via lint + build + manual verification. Acceptable for F-01 because the slice is small; revisit when the surface grows.
- **No platform-admin role.** EMs are the highest scope. If a "super-admin" role is needed later, it will be a separate change (likely via a `super_admins` table or a JWT claim).

## Success Criteria (Summary)

- The three seeded users see the role split the plan describes (`em-1` sees their own board as EM; `em-2` sees theirs as EM; `ic-1` sees both as IC).
- A brand-new signup sees the "You don't belong to any boards yet." empty state.
- Direct SQL queries against `boards` / `board_members` enforce the documented RLS rules (verified via the three SQL Editor snippets).
- `npm run lint` and `npm run build` remain green.
