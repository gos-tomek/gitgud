# Frame Brief: Invite and Join Board

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.

## Reported Observation

The app has auth (email+password signup/login) and board creation (F-01, S-01 done), but no way
for an EM to invite ICs to a board or for an IC to join one. Roadmap S-03 is the next ready slice
in Stream A.

## Initial Framing (preserved)

- **User's stated cause or approach**: Build an invite-by-email flow using Supabase's
  `inviteUserByEmail()` — EM enters email, IC receives link, IC creates account, IC is auto-added
  to the board. No separate acceptance gate (FR-004).
- **User's proposed direction**: Implement S-03 as the next slice, parallel with S-02.
- **Pre-dispatch narrowing**: Both new-user and existing-user invite paths matter equally.
  EM adds ICs to the board regardless of account status — ICs should be visible in the member
  list even before they sign in. Existing users get auto-added + notification; new users get
  Supabase invite email. No confirmation gate for either path.

## Dimension Map

The observation could originate at any of these dimensions:

1. **Membership identity model** — Can `board_members` (with `user_id` FK to `auth.users`)
   represent ICs who haven't signed up yet? If `inviteUserByEmail()` pre-creates the user in
   `auth.users`, the FK works; if not, the schema needs a parallel track.
2. **IC onboarding callback flow** — What happens after the IC clicks the invite link?
   The app needs to receive the token, verify it, prompt the IC to set a password, and redirect
   them to their board. ← **initial framing assumed Supabase handles this**
3. **Two distinct user paths** — New users (no account → invite email) vs existing users
   (already registered → add to board + notify). `inviteUserByEmail()` only handles new users.
   The framing treats this as a single flow.
4. **Admin client infrastructure** — `inviteUserByEmail()` requires the service role key,
   which isn't configured. Env schema in `astro.config.mjs` doesn't declare it.

## Hypothesis Investigation

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| 1. Schema can't represent pre-signup members | `inviteUserByEmail()` pre-creates the user in `auth.users` immediately — `board_members.user_id` FK works even before IC sets a password. No schema change needed for this dimension. | WEAK |
| 2. IC post-click onboarding flow is missing | No auth callback handler exists anywhere in the app. No token parsing in middleware (`src/middleware.ts:1-40`). `confirm-email.astro` is a static page — doesn't handle invite tokens. No "set password" page exists. If IC clicks the invite link → lands on homepage → token ignored → no way to complete onboarding. | **STRONG** |
| 3. Two-path bifurcation is unaccounted for | `inviteUserByEmail()` is for new users only. For existing users, the EM needs to: check if email is registered, add directly to `board_members`, send a notification email. No existing-user lookup or board-add endpoint exists. User confirmed both paths must work. | MEDIUM |
| 4. Service role key is missing | `.env` and `.dev.vars` contain only `SUPABASE_URL` and `SUPABASE_KEY` (anon). `astro.config.mjs` env schema declares only these two. Adding the service role key is a config step, not an architectural issue. | WEAK |

## Narrowing Signals

- User confirmed: "EM should be able to switch between ICs even if they never sign in."
  This means membership exists at invite time, not at signup time. Supabase invite's
  pre-creation of users in `auth.users` makes this work without schema changes.
- User confirmed: both new-user and existing-user paths must work in this slice.
- User confirmed: Supabase invite email as delivery mechanism — ruling out custom token
  systems.
- User raised testability concern: "I wouldn't like to send mails to real people while
  testing." Supabase local dev has Inbucket on port 54324 — emails are intercepted, not sent.
  This resolves the concern for local dev but should be documented.

## Cross-System Check

Supabase invite flows conventionally require three components the app currently lacks:

1. **Auth callback route** — handles the redirect from the invite email link, exchanges the
   token for a session. Supabase docs recommend a `/auth/callback` or `/auth/confirm` route
   that calls `supabase.auth.exchangeCodeForSession()` or processes the token hash from the
   URL fragment.
2. **Password-setting flow** — after the invite token is verified, the user needs to set
   their password via `supabase.auth.updateUser({ password })`. The existing signup page
   (`/auth/signup`) creates a NEW user and can't be reused for this.
3. **Redirect to board** — after password is set, redirect the IC to the board they were
   invited to. This requires the invite context (board ID) to survive the email → click →
   callback → password-set chain.

The leading hypothesis (Dimension 2: missing callback flow) matches this convention exactly.
The gap is not an architectural decision to make — it's a well-established pattern that hasn't
been implemented yet.

## Reframed Problem Statement

> **The actual problem to plan around is**: the IC's post-invite onboarding flow — from
> clicking the invite link through setting a password to landing on their board — is the
> primary engineering surface, not the invite-sending itself.

The initial framing ("invite ICs by email using Supabase") correctly identifies the delivery
mechanism but frames the work around the EM's action (sending the invite — a single API call).
The actual complexity is threefold:

1. **Auth callback infrastructure**: a new route to handle Supabase's invite link redirect,
   exchange the token, and establish a session. This doesn't exist anywhere in the app today.
2. **Password-setting UX**: a new page/flow where the invited IC sets their password after
   clicking the invite link. The existing signup page can't serve this purpose.
3. **Two-path branching**: when the EM enters an email, the system must check whether the
   user exists. New user → `inviteUserByEmail()` (pre-creates user + sends email). Existing
   user → `board_members` INSERT + notification. Both paths produce the same result (IC
   appears on the board).

The invite-sending endpoint (EM's action) is the simplest part. The plan should weight
the callback flow and two-path logic accordingly.

## Confidence

**HIGH** — strong evidence (no callback handler, no password page, no token parsing) + matches
Supabase convention (invite flows require callback infrastructure) + decisive narrowing signal
(user confirmed both paths must work, ICs visible before signin).

## What Changes for /10x-plan

The plan should allocate primary effort to the IC onboarding callback chain (auth callback route,
password-setting page, board redirect), not to the invite-sending endpoint. It should explicitly
address the new-user vs existing-user bifurcation as two distinct code paths that converge on
the same outcome (IC in `board_members`). The service role key addition is a prerequisite task.

## References

- Source files: `src/middleware.ts`, `src/pages/auth/confirm-email.astro`, `src/pages/api/auth/signup.ts`, `src/lib/supabase.ts`
- Schema: `supabase/migrations/20260529120000_access_control_and_membership.sql`
- Board service: `src/lib/services/boards.ts`
- Supabase config: `supabase/config.toml` (Inbucket on port 54324, email confirmations disabled)
- PRD refs: FR-003, FR-004, FR-005, FR-014, FR-015
- Roadmap: S-03 (invite-and-join-board)
