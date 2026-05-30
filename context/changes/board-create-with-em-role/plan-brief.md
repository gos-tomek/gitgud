# Board Create with EM Role (S-01) — Plan Brief

> Full plan: `context/changes/board-create-with-em-role/plan.md`

## What & Why

Let a signed-in user create a board and be **explicitly** shown they become its **Supervisor (EM)** at creation time (PRD FR-001, FR-016, FR-017). Today the data layer exists but there is no way to create a board or view one.

## Starting Point

Prerequisite **F-01 (access-control-and-membership) is done and deployed** (prod 2026-05-29): `boards` + `board_members` tables, RLS that makes "creator = EM" a DB invariant (`boards_insert WITH CHECK (owner_user_id = auth.uid())`), an `AFTER INSERT` trigger that auto-adds the creator as a member, derived `supervisor`/`contributor` roles in `src/types.ts`, the `getUserBoards`/`getBoardWithRole` service helpers, and a `/dashboard` that already lists boards with role badges.

## Desired End State

A user opens `/boards/new`, sees a clear "you'll be the Supervisor (EM)" note, creates the board, and lands on a minimal `/boards/[id]` page confirming the role via a Supervisor badge. The board shows on `/dashboard` and the row links to its detail page. A duplicate name (per owner, case/space-insensitive) is rejected with an inline message.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| UI surface | Dedicated `/boards/new` page | Mirrors the existing full-page auth-form pattern; no new shadcn components. | Plan |
| Explicit EM role (FR-016) | Inline label before submit + Supervisor badge on detail page | Sets the expectation at decision time and reconfirms after — satisfies "explicit, not silent". | Plan |
| Post-create destination | Redirect to `/boards/[id]` | A real landing page; built as a minimal stub here. | Plan |
| Name rules | Non-empty + max-length (zod) **and** unique per owner (new index) | Matches DB CHECK and FR-017 (multiple boards), prevents ambiguous duplicates. | Plan |
| Form mechanics | Native form POST → redirect-with-`?error=` | Matches the existing auth routes; no fetch/react-hook-form. | Plan |
| Validation | zod in the API route | `CLAUDE.md` mandates zod for API routes. | Plan |

## Scope

**In scope:** unique-name migration; `createBoard` service; `POST /api/boards`; `/boards/new` page + island; minimal `/boards/[id]` detail page; dashboard "New board" link + clickable rows; protect `/boards/*`.

**Out of scope:** GitHub-org link (S-02), invites (S-03), profiles/IC switching (S-04/S-06), edit/delete board, shadcn Dialog/Toast, any change to F-01 schema/RLS/triggers.

## Architecture / Approach

Backend then frontend. Create = single INSERT into `boards` (owner = auth user); the F-01 trigger adds membership. Server errors round-trip via `?error=`. The detail page reuses `getBoardWithRole` (returns `null` → redirect, since RLS hides non-member boards). Only DB change is one additive functional unique index `(owner_user_id, lower(trim(name)))`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Backend | Unique-name migration, `createBoard`, `POST /api/boards` with zod | Mapping the Postgres `23505` unique-violation to a clean user error |
| 2. Frontend | `/boards/new` + island, `/boards/[id]` stub, dashboard wiring, route protection | Detail page must handle RLS `null` (non-member) gracefully |

**Prerequisites:** F-01 (done/deployed); local Supabase for migration testing.
**Estimated effort:** ~1 session across 2 phases.

## Open Risks & Assumptions

- Assumes the `supervisor`/`contributor` naming stays as F-01 set it (UI says "Supervisor (EM)").
- The redirect target `/boards/[id]` is intentionally a stub; future slices fill it in.

## Success Criteria (Summary)

- A user can create a board and is explicitly told they are its Supervisor (EM) at creation.
- The new board is visible and navigable from `/dashboard`; the detail page confirms the role.
- Duplicate per-owner names are rejected with a clear inline message; unauthenticated and non-member access are blocked.
