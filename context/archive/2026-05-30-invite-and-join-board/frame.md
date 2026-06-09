# Frame Brief: Invite and Join Board (Confirmed)

> Framing step before /10x-plan. This document captures what is _actually_
> at issue, separated from what was initially assumed.

## Reported Observation

The app needs IC members on boards (S-03). Boards exist with linked GitHub repos
(S-02 done), but only the owner/supervisor is a member. There is no way to
associate ICs with a board.

## Initial Framing (preserved)

- **User's stated cause or approach**: Instead of the email invite + invite link
  flow originally planned (FR-003/004), add a new step to the New Board wizard
  where the EM picks IC contributors from a GitHub collaborator list. No
  invitation links needed.
- **User's proposed direction**: Extend the 2-step CreateBoardForm to 3 steps:
  (1) name + PAT, (2) repos, (3) pick ICs from contributor list. When an IC
  later creates a Supabase account and links GitHub OAuth, they get matched to
  their board membership.
- **Pre-dispatch narrowing**: EM picks from repo collaborators (people with
  push/review access) via GitHub API at wizard time. ICs are GitHub identities
  first; account linking comes later. Scope is creation-only (S-09 handles
  post-creation roster changes).

## Reframe Attempt (2026-06-02): Add GitHub OAuth at Registration

User proposed pulling GitHub OAuth into S-03 scope: add "connect GitHub account"
at registration, then auto-match `board_contributors.github_id` to
`auth.identities.provider_id` when ICs sign up. Investigated as a potential
scope change.

### Dimension Map

| #   | Dimension                            | What would go wrong / what the framing assumes    |
| --- | ------------------------------------ | ------------------------------------------------- |
| 1   | OAuth needed for contributor picker? | Assumes OAuth is required to list collaborators   |
| 2   | OAuth eliminates invitation system?  | Assumes invitations still exist without OAuth     |
| 3   | Downstream slices need OAuth?        | Assumes S-04/S-05 need OAuth infrastructure early |
| 4   | OAuth registration complexity        | What it actually costs to add OAuth to S-03       |

### Hypothesis Investigation

| Hypothesis                   | Evidence                                                                                                                                                                                                  | Verdict                                         |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| OAuth needed for picker      | EM's PAT already has `repo` + `read:org` scopes — exactly what `listCollaborators` requires. All existing GitHub API routes (`validate-pat.ts`, `repos.ts`, `validate-repo.ts`) use the same PAT pattern. | **NONE** — OAuth adds nothing to the picker     |
| OAuth eliminates invitations | Previous frame (2026-06-02) already eliminated invitations by switching to "pick from GitHub collaborators." OAuth is orthogonal.                                                                         | **NONE** — invitations were already gone        |
| Downstream need for OAuth    | S-04 is EM-only viewing (no IC login). S-05 needs IC login but PRD says "No OAuth in MVP" — email+password is MVP auth. No slice before post-MVP needs OAuth.                                             | **NONE** — no consumer exists                   |
| Registration complexity      | ~7 files to create/modify: `config.toml`, 2 new API routes, 2 UI component changes, env vars, GitHub OAuth app registration. Real engineering cost with no S-03 consumer.                                 | **STRONG** — cost without benefit in this slice |

### Narrowing Signals

- User confirmed: focus S-03 on board creation process only.
- User agreed to split GitHub-to-GitGud account linking into a separate issue.
- The PAT already covers everything the contributor picker needs.

### Resolution

**The reframe attempt did not hold.** GitHub OAuth at registration is a valid
future feature but does not belong in S-03:

- The contributor picker works with the existing PAT — no OAuth needed.
- Invitations were already eliminated by the original reframe.
- No downstream slice consumes OAuth until post-MVP.
- The cost is real (~7 files) with no S-03 benefit.

**Action**: create a separate change for "link GitGud account with GitHub
account" — likely targeting S-05 scope or a standalone foundation slice.

## Confirmed Problem Statement

> **The actual problem to plan around is**: introducing a GitHub-identity-based
> contributor model that decouples IC membership from Supabase accounts, plus a
> wizard step to populate it from the GitHub collaborators API.

The original reframed problem statement (2026-06-02) holds. The user's "pick
from list" direction is correct and dramatically simpler than the invite-link
flow. For S-03, ICs are purely GitHub identities the EM selects and tracks. No
Supabase accounts, no OAuth, no email matching.

S-03 deliverables (unchanged from original frame):

1. **New contributor table** — `board_contributors` keyed on `(board_id,
github_id)` with `github_login` and `avatar_url`. No FK to `auth.users`.
   Follows the same identity pattern as `github_pull_requests`.
2. **Collaborators API endpoint** — new `/api/github/collaborators` route that
   calls `octokit.rest.repos.listCollaborators()` for each selected repo and
   deduplicates across repos.
3. **Wizard step 3** — contributor picker in `CreateBoardForm.tsx`, similar UX
   to the existing repo picker (checkbox list, filter, avatars).
4. **Board detail update** — show contributors on the board detail page
   (`boards/[id].astro`), replacing the placeholder with an actual member list.

What the plan should NOT include (deferred):

- GitHub OAuth configuration or `linkIdentity` flow (separate change — account linking)
- IC self-service accounts or login (S-05)
- Post-creation roster management (S-09)
- Email-based matching (ruled out — unreliable)

## Confidence

**HIGH** — original frame confirmed by re-investigation. OAuth reframe attempt
found no supporting evidence across any dimension. User agreed to split OAuth
into a separate change.

## What Changes for /10x-plan

Nothing changes from the original frame. Plan should build a GitHub-identity
contributor model (new table, new API endpoint, wizard step 3, board detail
update). The `board_members` table and its `auth.users` FK remain untouched.
Account linking via GitHub OAuth is explicitly out of scope — tracked as a
separate change.

## References

- Source files: `src/components/CreateBoardForm.tsx`, `src/lib/github.ts`, `src/lib/services/boards.ts`, `src/pages/api/boards/index.ts`
- Schema: `supabase/migrations/20260529120000_access_control_and_membership.sql:13-18` (board_members FK)
- GitHub data model: `supabase/migrations/20260531100000_github_ingestion_access.sql:30-31,46-47,61-62` (login+id pattern)
- Supabase config: `supabase/config.toml` (no GitHub OAuth configured)
- Board detail: `src/pages/boards/[id].astro`
- PRD refs: FR-003, FR-004, FR-005
- Roadmap: S-03 (invite-and-join-board), S-05 (profile-classified-comments), S-09 (manage-ic-roster)
- Research: `context/changes/invite-and-join-board/research.md`
