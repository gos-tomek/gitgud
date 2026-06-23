# Link GitHub Account — Plan Brief

> Full plan: `context/changes/link-github-account/plan.md`
> Frame brief: `context/changes/link-github-account/frame.md`

## What & Why

An IC who signs up needs a mechanism to self-declare their GitHub username so the system can link their auth account to `board_contributors` and grant board access — cheaply, at signup time, without OAuth. Additionally, we replace the explicit `board_members` table with a derived access model that's architecturally cleaner for an analytics tool.

## Starting Point

Signup is email+password only. Board access is gated by `board_members` (explicit membership table). `board_contributors` stores GitHub identities (`github_id`, `github_login`) but has no link to auth users (`user_id` is nullable, never populated). An IC who signs up sees "no boards" even if they're a contributor.

## Desired End State

ICs provide their GitHub username at signup. The system validates it via the public GitHub API, stores the identity in `user_profiles`, and derives board access from `board_contributors.github_id = user_profiles.github_id`. No `board_members` table — access is computed, not manually synchronized.

## Key Decisions Made

| Decision              | Choice                                           | Why (1 sentence)                                                                    | Source |
| --------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------- | ------ |
| Linking mechanism     | Self-declared GitHub username at signup          | No OAuth in MVP (PRD); self-hosted trust model makes verification secondary.        | Frame  |
| Link timing           | At signup API call                               | Earliest and cheapest moment; email confirmation is a separate Supabase config.     | Plan   |
| GitHub API validation | Server-side, fail if unreachable                 | Catches typos that would cause silent linking failure; no partial-state complexity. | Plan   |
| Access model          | Derived via `user_profiles ⟕ board_contributors` | Eliminates redundant `board_members` table; natural fit for an analytics dashboard. | Plan   |
| Profile data          | github_id + github_login + avatar_url            | Minimum for linking + avatar for future UI use.                                     | Plan   |
| No-match behavior     | Allow signup, show "no boards" + create option   | IC shouldn't be blocked; EM may not have set up the board yet.                      | Plan   |

## Scope

**In scope:**

- `github_login` field on signup form with client-side validation
- Server-side GitHub API validation (`GET /users/{username}`)
- `user_profiles` table (github_id, github_login, avatar_url)
- Refactor `is_board_member()` to derived access model
- Simplify `getUserBoards` (remove `board_members` join)
- Drop `board_members` table and all references
- Updated dashboard empty state

**Out of scope:**

- OAuth / GitHub App integration
- Invite-token flow (FR-003/FR-004)
- Post-signup settings to change GitHub username
- Auto-linking trigger on `board_contributors` INSERT
- Email confirmation enforcement

## Architecture / Approach

The key insight: `is_board_member()` is a SECURITY DEFINER abstraction layer called by all 7 RLS policies. Changing its implementation from a `board_members` lookup to an `owner_user_id + contributors⟕user_profiles` join means **no downstream policy changes**. The refactor is contained to one SQL function, one TS query, and cleanup.

## Phases at a Glance

| Phase                                    | What it delivers                                         | Key risk                                             |
| ---------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------- |
| 1. user_profiles migration + RLS tests   | New table with policies; integration tests               | Low — additive change, no existing code affected     |
| 2. Signup with github_login              | Form field, GitHub API validation, user_profile creation | GitHub API rate limiting (60 req/hr unauthenticated) |
| 3. Refactor `is_board_member()`          | Derived access model (owner + contributors⟕profiles)     | RLS recursion if SECURITY DEFINER is misconfigured   |
| 4. Refactor getUserBoards + dashboard UX | Simplified query, better empty state                     | Minor — mostly removing code                         |
| 5. Drop board_members                    | Clean removal of table, trigger, policies, references    | Must verify all access paths work before dropping    |

**Prerequisites:** Local Supabase running for integration tests; `SUPABASE_SERVICE_ROLE_KEY` env var for admin client.
**Estimated effort:** ~3-4 sessions across 5 phases.

## Open Risks & Assumptions

- GitHub public API rate limit (60/hr per IP) is assumed sufficient for a self-hosted single-team product.
- `is_board_member()` performance with two EXISTS subqueries (vs. single PK lookup) is assumed acceptable at current scale (<100 contributors).
- No auto-linking when EM adds a contributor post-signup — IC must refresh. This may need a follow-up change if UX friction is too high.

## Success Criteria (Summary)

- An IC can sign up with their GitHub username and immediately see boards where they are a contributor.
- An IC whose GitHub username isn't in any board sees a helpful message and can create their own board.
- All existing access boundary tests pass against the new derived model.
