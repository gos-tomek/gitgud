<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Invite and Join Board

- **Plan**: context/changes/invite-and-join-board/plan.md
- **Scope**: Phases 1–4 of 4
- **Date**: 2026-06-02
- **Verdict**: NEEDS ATTENTION → TRIAGED
- **Findings**: 0 critical, 3 warnings, 2 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

## Findings

### F1 — listContributors used instead of listCollaborators

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Plan Adherence
- **Location**: src/pages/api/github/collaborators.ts:65
- **Detail**: Plan specified `octokit.rest.repos.listCollaborators()` (users with push/admin access). Implementation uses `octokit.rest.repos.listContributors()` (anyone who has ever committed). These are different GitHub APIs returning different user sets. listCollaborators returns team members with explicit repo permissions (the plan's intent: "select ICs from the GitHub collaborator list"). listContributors returns anyone who has committed, including external contributors, bots with commits, and former team members. Additionally, listContributors can return HTTP 202 (stats being computed) for repos not recently queried — the code does not handle this, silently returning an empty list for that repo.
- **Fix A ⭐ Recommended**: Switch to listCollaborators per plan
  - Strength: Matches the plan's stated intent ("GitHub collaborator list") and returns the set of users who actually have repo access — the people an EM would want to add.
  - Tradeoff: Requires the PAT to have push or admin access to the repo. A read-only PAT would get 403 for every repo.
  - Confidence: HIGH — the plan and frame brief both say "collaborator."
  - Blind spot: Whether the PATs users provide have sufficient scope.
- **Fix B**: Keep listContributors but rename and document
  - Strength: Works with read-only PATs since listContributors is public for public repos. Broader net catches all code authors.
  - Tradeoff: Endpoint named "collaborators" fetches "contributors" — naming mismatch. Returns users without current access. Must add 202 handling.
  - Confidence: MEDIUM — valid if the product intent shifts to "anyone who contributed code" rather than "current team members."
  - Blind spot: Whether 202 handling is straightforward with paginate.
- **Decision**: FIXED via Fix B — kept listContributors, added 202 handling, added clarifying comment. Plan updated to document intentional API choice.

### F2 — Unbounded contributors array in board creation schema

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/boards/index.ts:30
- **Detail**: The `contributors` Zod array has `.min(1)` but no upper bound. The collaborators endpoint caps at 200 (`COLLABORATOR_LIMIT`), but a crafted POST to /api/boards bypasses the UI entirely and can send thousands of contributor objects, causing a large INSERT.
- **Fix**: Add `.max(200)` to the contributors array in `createBoardSchema` to match `COLLABORATOR_LIMIT`.
- **Decision**: FIXED — added `.max(200)` to contributors array in createBoardSchema.

### F3 — Contributor insert failure leaves board in partial state

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/boards/index.ts:84-92
- **Detail**: Board creation is multi-step: create board → store PAT → link repos → add contributors. If `addBoardContributors` throws (e.g., constraint violation), the board and repos already exist but the user sees a 500 error. The board is left without contributors, contradicting the "at least 1 contributor" invariant enforced by the wizard. The plan specified contributor failure as a "blocking error — return 500," which the code does, but it doesn't address rollback of the already-created board.
- **Fix A ⭐ Recommended**: Delete the board on contributor failure
  - Strength: Simple cleanup — one DELETE cascades to repos and PAT via ON DELETE CASCADE. User retries cleanly.
  - Tradeoff: If delete also fails, orphan board remains. Adds a catch-within-catch.
  - Confidence: HIGH — CASCADE handles the cleanup automatically.
  - Blind spot: Whether the board owner can delete via RLS in this error path (they should — they just created it).
- **Fix B**: Return partial success with board ID
  - Strength: User can navigate to the board and add contributors manually (once post-creation roster management ships).
  - Tradeoff: Post-creation roster management (S-09) doesn't exist yet, so the user can't actually fix it.
  - Confidence: LOW — depends on S-09 which is out of scope.
  - Blind spot: UI has no way to handle a partial-success response.
- **Decision**: FIXED via Fix A — added cleanup delete on contributor failure; CASCADE removes repos and PAT.

### F4 — Sequential repo iteration in collaborators endpoint

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/github/collaborators.ts:61
- **Detail**: Repos are iterated sequentially with paginated API calls per repo. For 10 repos this could take many seconds. However, the plan's Performance Considerations section explicitly acknowledges this: "Acceptable for MVP — the wizard shows a loading state."
- **Fix**: No action needed for MVP. Noted for future optimization with Promise.allSettled.
- **Decision**: SKIPPED — acknowledged in plan; acceptable for MVP.

### F5 — REVOKE ALL FROM anon not in plan

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: supabase/migrations/20260602120000_board_contributors.sql
- **Detail**: Migration includes `REVOKE ALL ON board_contributors FROM anon, authenticated` which was not in the plan. This is a sensible security hardening measure that complements the RLS policies.
- **Fix**: No action needed — beneficial addition. Consider documenting as a standard pattern for future migrations.
- **Decision**: ACCEPTED-AS-RULE: Always REVOKE ALL before relying on RLS (appended to context/foundation/lessons.md).
