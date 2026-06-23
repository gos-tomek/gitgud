# Frame Brief: Link GitHub Account to IC

> Framing step before /10x-plan. This document captures what is _actually_
> at issue, separated from what was initially assumed.

## Reported Observation

ICs who sign up have no way to be linked to their GitHub identity. The
`board_contributors` table (populated by the EM via PAT during board setup)
has `github_login` and `github_id` but `user_id` is NULL. The `board_members`
table (which controls board access via `getUserBoards`) has no entry for the IC.
Result: an IC who signs up sees "You don't have any boards yet."

## Initial Framing (preserved)

- **User's stated cause or approach**: OAuth requires GitHub App configuration per deployment — unwanted overhead for a self-hosted, read-only product.
- **User's proposed direction**: Drop OAuth entirely. Add a GitHub username field to the signup form so the system can match the IC to their `board_contributors` record and grant board access.
- **Pre-dispatch narrowing**: Primary concern is UX (IC sees the right boards), not impersonation risk. ICs always know their GitHub login. The invite-token flow (FR-003/FR-004) was considered and rejected as too complex for now.

## Dimension Map

The observation could originate at any of these dimensions:

1. **Linking mechanism** — how the IC declares/proves their GitHub identity. ← initial framing
2. **Trust/verification** — whether an unverified self-declaration is acceptable.
3. **Two-table synchronization** — the link must update both `board_contributors.user_id` AND insert into `board_members` atomically.
4. **Timing** — whether the link must happen at signup or could happen later (settings, EM-side).

## Hypothesis Investigation

| Hypothesis                                         | Evidence                                                                                                                                                                                                                                                                                                                              | Verdict                                                           |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| H1: Signup self-declaration is the right mechanism | PRD says "No OAuth in MVP" (`prd.md:182`). Self-hosted model makes trust a non-issue. Signup form (`SignUpForm.tsx`) is a straightforward React island posting to `/api/auth/signup`. Adding a field is minimal work.                                                                                                                 | STRONG                                                            |
| H2: Trust/verification is a blocking concern       | Self-hosted deployment: only the team has access to the app URL. The EM controls who gets invited (even without a formal invite flow). Low attack surface. User confirmed trust is secondary.                                                                                                                                         | NONE — not a blocker                                              |
| H3: Two-table sync is the hidden complexity        | `board_contributors` has `user_id` (nullable, `board_contributors.sql:11`). `board_members` controls visibility (`boards.ts:29-30`). Both need updating — but `create_board_atomic` RPC (`20260611120000_create_board_atomic.sql`) shows the project already uses Supabase RPCs for multi-table atomicity. Same pattern applies here. | WEAK — it's real complexity but solvable with an existing pattern |
| H4: Link should happen at a different time         | EM-side linking adds manual work. Post-signup settings page delays the UX. Signup-time is the earliest and cheapest moment for the IC.                                                                                                                                                                                                | NONE — signup-time is the right moment                            |

## Narrowing Signals

- User confirmed "seeing the right boards" is the primary concern, not impersonation.
- User confirmed ICs always know their GitHub login — no UX risk of wrong input.
- User explicitly considered and rejected the invite-token flow (FR-003/FR-004) as too complex for now.

## Cross-System Convention

Self-hosted developer tools commonly use self-declared identity linking when the trust boundary is the deploying organization (e.g., Gitea's "link existing account" flow, self-hosted CI dashboards). OAuth verification is the convention for multi-tenant SaaS where impersonation has real consequences. For GitGud's self-hosted, single-team model, self-declaration matches the convention.

## Reframed (or Confirmed) Problem Statement

> **The actual problem to plan around is**: an IC who signs up needs a mechanism to self-declare their GitHub username so the system can link their auth account to `board_contributors` and grant `board_members` access to the right boards — cheaply, at signup time, without OAuth.

The initial framing was correct. The user correctly identified that OAuth is unnecessary overhead for a self-hosted product, and that a signup-time GitHub username field is the cheapest viable approach. The only nuance the plan should address is the two-table synchronization (`board_contributors.user_id` + `board_members` insert), which should use an RPC or transaction to stay atomic.

## Confidence

- **HIGH** — the self-hosted trust model, PRD's "No OAuth in MVP" stance, and the existing data model all align with the proposed direction. No contradicting evidence found.

## What Changes for /10x-plan

Plan should cover: (1) adding `github_username` field to signup form + API, (2) an atomic linking mechanism (RPC or trigger) that sets `board_contributors.user_id` and inserts into `board_members` for all matching boards, (3) handling the edge case where the username doesn't match any contributor (IC signs up before being added to a board), (4) **username validation** — typos in the GitHub login are a real UX risk; plan should address validation at two levels: checking against `board_contributors.github_login` for immediate feedback, and optionally validating against the public GitHub API (`GET /users/{username}`, no auth needed) to catch nonexistent usernames before persisting.

## References

- Source files: `src/components/auth/SignUpForm.tsx`, `src/pages/api/auth/signup.ts`, `src/lib/services/boards.ts:26-31`
- Schema: `supabase/migrations/20260602120000_board_contributors.sql`, `supabase/migrations/20260529120000_access_control_and_membership.sql:13`
- Atomic RPC pattern: `supabase/migrations/20260611120000_create_board_atomic.sql`
- PRD: `context/foundation/prd.md:182` ("No OAuth in MVP")
