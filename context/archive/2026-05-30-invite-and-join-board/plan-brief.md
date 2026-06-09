# Invite and Join Board — Plan Brief

> Full plan: `context/changes/invite-and-join-board/plan.md`
> Frame brief: `context/changes/invite-and-join-board/frame.md`
> Research: `context/changes/invite-and-join-board/research.md`

## What & Why

Introducing a GitHub-identity-based contributor model that decouples IC membership from Supabase accounts, plus a wizard step to populate it from the GitHub collaborators API. Boards exist with linked repos (S-02 done), but only the owner is a member — there is no way to associate ICs with a board.

## Starting Point

The CreateBoardForm is a 2-step wizard (name+PAT → repos). Board detail shows repos and a "Coming soon" placeholder. GitHub ingestion tables already use the `github_id` (bigint) + `login` (text) identity pattern. RLS uses `is_board_member()` / `is_board_owner()` SECURITY DEFINER helpers. No contributor table or concept exists yet.

## Desired End State

An EM creating a board goes through a 3-step wizard: name+PAT → repos → pick ICs from GitHub collaborators. Contributors are stored as GitHub identities in `board_contributors` — no Supabase account required. The board detail page shows a vertical list of contributors with avatars and @login. A nullable `user_id` column is ready for F-04 (GitHub OAuth account linking).

## Key Decisions Made

| Decision                   | Choice                              | Why (1 sentence)                                                                   | Source |
| -------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------- | ------ |
| Contributor identity model | GitHub ID + login, no auth.users FK | ICs are GitHub identities the EM selects; accounts come later via F-04             | Frame  |
| Deduplication across repos | Union by github_id, show once       | Matches the DB model (unique on board_id + github_id) — simplest UX                | Plan   |
| Picker default selection   | None pre-selected, EM selects       | Explicit opt-in prevents accidentally including bots or external contributors      | Plan   |
| Contributors required?     | Yes, at least 1                     | Every board has ICs from day one — avoids empty-state edge case                    | Plan   |
| Board detail display       | List with avatar + login + badge    | More detail per contributor; easy to extend with "linked" status for F-04          | Plan   |
| OAuth in S-03 scope?       | No — PAT covers everything          | The EM's PAT already has `repo` + `read:org` scopes needed for `listCollaborators` | Frame  |

## Scope

**In scope:**

- `board_contributors` table with RLS (github_id + login pattern, nullable user_id)
- `/api/github/collaborators` endpoint (fetch + deduplicate across repos)
- Wizard step 3 (contributor picker with filter, min 1 required)
- Board detail contributor list (avatar + @login + badge slot)
- Update board creation API to accept and store contributors

**Out of scope:**

- GitHub OAuth / account linking (F-04)
- IC self-service accounts or login (S-05)
- Post-creation roster management (S-09)
- Email-based matching (ruled out)
- Bot auto-filtering (EM makes the selection)

## Architecture / Approach

New `board_contributors` table keyed on `(board_id, github_id)` following the existing ingestion identity pattern. A new `/api/github/collaborators` endpoint calls `listCollaborators` per selected repo and deduplicates by numeric ID. The wizard extends from 2→3 steps — step 3 fetches collaborators after repos are chosen and requires the EM to select at least 1. Board creation API adds contributors after board + PAT + repos. Board detail page replaces the placeholder with a contributor list.

## Phases at a Glance

| Phase                          | What it delivers                          | Key risk                                                                |
| ------------------------------ | ----------------------------------------- | ----------------------------------------------------------------------- |
| 1. Database schema             | `board_contributors` table + RLS policies | Low — follows established patterns                                      |
| 2. Collaborators API + service | Endpoint + CRUD functions                 | Rate limits if board has many repos (mitigated by hard cap)             |
| 3. Wizard step 3               | Contributor picker in CreateBoardForm     | React Compiler compatibility with new state; step navigation complexity |
| 4. Board detail update         | Contributor list on board page            | Low — template-only change                                              |

**Prerequisites:** S-01 (board create), F-01 (access control), S-02 (GitHub org link) — all done.
**Estimated effort:** ~2-3 sessions across 4 phases.

## Open Risks & Assumptions

- GitHub `listCollaborators` requires the PAT to have admin or push access to the repo. If the PAT has read-only access, the endpoint returns 403. Note: PAT validation (`validate-pat.ts`) only checks liveness via `getAuthenticated()` — it does not inspect scopes. The collaborators endpoint handles per-repo 403s by skipping the repo and returning a warning in the response.
- Hard cap of 200 unique collaborators — orgs with very large teams may hit this. Acceptable for MVP.
- `github_login` can become stale if a user renames their GitHub account. The numeric `github_id` is stable; login refresh deferred to S-09 or a periodic sync.

## Success Criteria (Summary)

- An EM can create a board and select ICs from a deduplicated list of GitHub collaborators across linked repos
- The board detail page shows selected contributors with avatars and @login
- `board_contributors` data is correct and RLS policies enforce owner-only writes
