# Frame Brief: Move PAT to user profile + account-settings surfaces

> Framing step before /10x-plan. This document captures what is _actually_
> at issue, separated from what was initially assumed.

## Reported Observation

`edit-board-connection` is currently an empty change (no commits, scaffold
`change.md` only). The user proposes implementing, as one "small refactor"
inside this item: (a) move PAT storage from `boards.github_pat_encrypted`
to a per-user `user_profiles` field, (b) make the create-board form's PAT
field conditional on whether the user already has one, (c) add a new
user-profile page showing PAT expiry + editable profile data, (d) replace
the initial-letter avatar in `BoardTopbar.astro` with a real avatar image,
(e) add a 7-days-before-expiry PAT notification shown on all boards.

## Initial Framing (preserved)

- **User's stated cause or approach**: "to jest mały refactor" — all five
  pieces are PAT/identity related, so they belong together in one item.
- **User's proposed direction**: implement all five inside
  `edit-board-connection`.
- **Pre-dispatch narrowing** (user confirmed):
  1. PAT scope → **one PAT per user, shared across all of that user's
     boards** (explicitly chosen over "per-board, just pre-filled" or "hadn't
     considered multi-board").
  2. Avatar target → **`BoardTopbar.astro`** (the initial-letter component),
     not `Banner.astro` (the email-showing component).
  3. Item scope → **confirmed broader account-settings initiative**, not a
     narrow board-connection edit.

## Dimension Map

1. **PAT cardinality (per-board vs per-user)** — does the data model support
   one PAT serving all of a user's boards? ← initial framing
2. **Scope bundling under `edit-board-connection`** — does a data-model
   change + 3 new UI surfaces belong in one change, or several?
3. **Avatar UI gap** — does `BoardTopbar.astro` actually need new data, or
   only a rendering change?
4. **PAT expiry data availability** — does any stored expiry value exist
   today, independent of where the PAT lives?

## Hypothesis Investigation

| Hypothesis                                    | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Verdict                                                                                                                                                                                                  |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1: One PAT per user is a safe simplification | PRD `FR-017` ("EM can create and belong to more than one Board"), `FR-018` ("EM can update a Board's GitHub connection settings (PAT, linked org)"), `FR-020`/`FR-022` (PAT change/invalidity affects "that Board" specifically) all model PAT as **independent per board, by design**. `context/archive/2026-05-30-github-ingestion-access/plan-brief.md:26` records the per-board choice was made to avoid a separate token table — not for a multi-org reason, but `context/archive/2026-06-01-link-board-to-github-org/research.md:120-121` separately documents: "GitGud boards span repos across multiple orgs... A user with repos in 3 orgs would need 3 separate fine-grained PATs." A single user-level PAT cannot serve boards that require different fine-grained, org-scoped tokens, and would make one PAT's expiry/revocation freeze **all** of that user's boards simultaneously — directly contradicting `FR-022`. | **CONTRADICTS DOCUMENTED PRD** — not absent evidence, but evidence the proposed direction conflicts with three existing requirements.                                                                    |
| H2: This is rightly one bundled change        | `boards.ts:getUserBoards` and schema confirm multi-board ownership is real (no `UNIQUE` on `owner_user_id`). The profile page, avatar, and notification UI all read from the same migrated PAT/expiry data — they are downstream of the data-model move, not independent. Bundling is defensible _if_ sequenced (data model first), but is five distinct deliverables under one change-id.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | WEAK-to-PLAUSIBLE — bundling is workable but the plan should phase it, not treat it as "small."                                                                                                          |
| H3: Avatar swap needs no new data             | `user_profiles.avatar_url` already exists (`20260622120000_user_profiles.sql`), populated when an account links its GitHub identity (`link-github-account`, archived). `BoardTopbar.astro:87-128` currently renders `userInitial`, not `avatar_url`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | STRONG — this is a render-only change, decoupled from the PAT move, already unblocked today.                                                                                                             |
| H4: PAT expiry is already tracked somewhere   | `grep -i "expir"` across the repo only matches the generic "Token is invalid or expired" error string from GitHub API failures. No column, RPC, or scheduled job stores a PAT expiration timestamp anywhere.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | STRONG (absence confirmed) — expiry must be captured net-new (e.g. at PAT-entry time, or read from GitHub's `github-authentication-token-expiration` response header) regardless of where the PAT lives. |

## Narrowing Signals

- User confirmed the PAT-per-user choice is deliberate, not an oversight of the multi-board case.
- User confirmed the avatar target is `BoardTopbar.astro`.
- User confirmed the item is intentionally a broader account-settings initiative.

## Cross-System Convention

Per-board/per-connection credentials with independent failure domains (PAT A expiring doesn't break PAT B's board) is the documented GitGud convention (`FR-022`) and matches common multi-tenant-within-one-account patterns (e.g. a CI tool storing one deploy token per project, not one per account, so a leaked/rotated token has bounded blast radius). The proposed per-user PAT departs from this convention and from the project's own prior decision record on multi-org boards.

## Reframed (or Confirmed) Problem Statement

> **The actual problem to plan around is**: implement four mostly-decoupled deliverables — (1) a PAT storage location change that the user has chosen as one-per-user despite it contradicting `FR-017/018/020/022` and the multi-org-per-board precedent, (2) a profile page, (3) an avatar-rendering fix that already has its data and ships independently, (4) a PAT-expiry notification that requires net-new expiry capture — and explicitly resolve the PRD conflict in (1) before building on it.

The user's scope choice (broad account-settings item) and avatar target are confirmed and not in question. The one place where the initial framing has a real, evidence-backed conflict is PAT cardinality: moving to one-PAT-per-user is not "just a refactor," it overrides three documented requirements and the prior multi-org decision. This isn't blocking — the user gets to make that call — but it must be made _explicitly and visibly_ (PRD update or recorded exception), not silently, because `/10x-plan` and future readers will otherwise assume `FR-022`'s per-board isolation still holds when it won't.

## Confidence

**HIGH** — the PRD requirements are explicit and unambiguous (`FR-017`, `FR-018`, `FR-020`, `FR-022`), the prior multi-org research is on record, and the user has directly confirmed the choice that conflicts with them. No further investigation needed; the open item is a decision to record, not evidence to gather.

## What Changes for /10x-plan

The plan should:

1. Open by recording the PRD deviation explicitly — either update `FR-018/020/022` to reflect "PAT is per-user" semantics (and accept that one user's PAT issue freezes all their boards, and that boards needing different GitHub orgs/scopes can't be supported per-user without re-adding per-board override), or scope the change to only support single-org users and flag multi-org as a known gap.
2. Use an expand/contract migration for the data move per `CLAUDE.md`: add the PAT field to `user_profiles` (additive), backfill/cut over reads+writes, and only drop `boards.github_pat_encrypted` in a later release — never in the same deploy.
3. Treat the `BoardTopbar.astro` avatar swap as an independent, low-risk phase that can ship first (data already exists).
4. Design PAT-expiry capture as net-new (no existing field): decide whether expiry is user-entered at PAT-save time or derived from GitHub's `github-authentication-token-expiration` response header on validation calls, since today's `/api/github/validate-pat.ts` flow doesn't capture or persist it either way.
5. Phase the profile page and the 7-day notification banner after the data-model + expiry-capture phases, since both depend on that data existing.

## References

- Source files: `src/components/CreateBoardForm.tsx:283-314`, `src/components/BoardTopbar.astro:87-128`, `src/components/Banner.astro:8-22`, `src/pages/api/github/validate-pat.ts:61`, `src/lib/services/boards.ts:27-34`
- Schema: `supabase/migrations/20260531100000_github_ingestion_access.sql`, `supabase/migrations/20260622120000_user_profiles.sql`, `supabase/migrations/20260611120000_create_board_atomic.sql`, `supabase/migrations/20260529120000_access_control_and_membership.sql:8`
- PRD: `context/foundation/prd.md` `FR-017`, `FR-018`, `FR-020`, `FR-022`
- Prior decisions: `context/archive/2026-05-30-github-ingestion-access/plan-brief.md:25-26`, `context/archive/2026-06-01-link-board-to-github-org/research.md:120-121`, `context/archive/2026-06-22-link-github-account/plan-brief.md` (origin of `user_profiles.avatar_url`)
- Investigation: ad-hoc Agent reads (no formal TaskCreate tracking — evidence was conclusive within 2 rounds)
