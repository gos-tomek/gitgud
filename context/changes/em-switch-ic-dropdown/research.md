---
date: 2026-06-22T15:59:23+02:00
researcher: Tomasz Sierpinski
git_commit: dc5db776ac85f3bda0c730008272dc5221756eb5
branch: change/em-switch-ic-dropdown
repository: GitGud
topic: "Is em-switch-ic-dropdown (S-06 / FR-007) already implemented?"
tags: [research, codebase, impact-view, contributor-selector, roadmap-s06]
status: complete
last_updated: 2026-06-22
last_updated_by: Tomasz Sierpinski
---

# Research: Is em-switch-ic-dropdown (S-06 / FR-007) already implemented?

**Date**: 2026-06-22T15:59:23+02:00
**Researcher**: Tomasz Sierpinski
**Git Commit**: dc5db776ac85f3bda0c730008272dc5221756eb5
**Branch**: change/em-switch-ic-dropdown
**Repository**: GitGud

## Research Question

User asked (PL): "czy to nie jest już zrobione?" — i.e., isn't the `em-switch-ic-dropdown` change already done?

## Summary

**Partially — UI exists, but the slice's defining acceptance criterion is not met.**

A working contributor-switcher dropdown (`ContributorSelector` in `src/components/impact/ImpactView.tsx:67-170`) already exists and is wired up, with role-based scoping already correct (supervisors/EMs see all contributors; contributors/ICs see only themselves). It shipped as an **unplanned scope addition inside S-04** (`profile-raw-github-metrics`, already `done`), not as a dedicated S-06 implementation.

However, `roadmap.md` correctly lists S-06 as `proposed` (not done), because the dropdown's navigation uses `window.location.assign(...)` — a full browser navigation — which directly violates the explicit FR-007/US-01 acceptance criterion: _"Switching between ICs loads the selected IC's profile without a full page reload."_

So: the visual/interaction shell is done; the one behavior the story exists to deliver (no full reload) is not.

## Detailed Findings

### PRD requirement (the actual ask)

- `context/foundation/prd.md:59,65` — US-01 acceptance criteria: EM selects IC from dropdown; "Switching between ICs loads the selected IC's profile without a full page reload."
- `context/foundation/prd.md:123` — FR-007: "EM can switch between ICs via a dropdown on the Board."
- `context/foundation/prd.md:184` — Roles are **IC** and **EM** at the product level; both see identical data (data-parity guardrail).

### Roadmap status (source of truth for "is it done")

- `context/foundation/roadmap.md:41` — `S-06 | em-switch-ic-dropdown | switch between ICs on a board without a full page reload | S-04 | FR-007, US-01 | proposed`
- `context/foundation/roadmap.md:201-211` — S-06 detail: "Outcome: An EM can switch between ICs on a board via a dropdown, loading the selected IC's profile without a full page reload." Status: `proposed`. Risk noted as low ("Pure client-side navigation over data S-04 already provides").
- The roadmap is accurate: it has not been promoted to `done`, and the gap it's tracking (client-side nav) is real.

### Existing implementation (built inside S-04, not S-06)

- `src/pages/board/[id]/impact/[githubLogin]/[...dateRange].astro:27-46` — server loads `contributors` (all board contributors) and `boards`; computes `visibleContributors` — full list for `board.role === "supervisor"` (EM), filtered to self for `contributor` (IC) role. This is the role-separation guardrail from the PRD, already correctly enforced server-side.
- `src/components/impact/ImpactView.tsx:67-170` — `ContributorSelector` component: renders current contributor's avatar/name; if `contributors.length > 1`, renders a clickable dropdown listing all visible contributors with a checkmark on the active one, closes on outside-click (`useEffect` + ref, lines 81-90).
- `src/components/impact/ImpactView.tsx:92-94` — the actual switch action:
  ```ts
  function navigate(login: string) {
    window.location.assign(`/board/${boardId}/impact/${login}/${period}`);
  }
  ```
  This is a **full page navigation**, not a client-side route/state update — directly contradicts the "without a full page reload" acceptance criterion.
- Contrast: period switching in the same file (`ImpactView.tsx:189-196`, `handlePeriodChange`) already does this correctly — `history.replaceState(...)` + local `setPeriod(...)` to re-fetch sections without a reload. The pattern S-06 needs already exists one function away; it just isn't applied to the contributor switch.

### Provenance — when/why this was built

- `git log --follow --diff-filter=A -- src/components/impact/ImpactView.tsx` → first introduced in commit `d42f7a8` ("feat: contribution profile with raw GitHub metrics (#32)"), squashed sub-commit `6a18a4b` ("impact page UI — all sections, heatmap, own-PR fix (p3)").
- The PR body for `d42f7a8` explicitly documents this as a p4 scope addition: _"ImpactView: ContributorSelector dropdown — click to switch contributor, closes on outside-click, navigates via window.location.assign"_ — confirming the full-reload navigation was a deliberate (if minimal) choice at the time, made before S-06 existed as a scoped story.
- The archived plan (`context/archive/2026-06-15-profile-raw-github-metrics/plan.md:418`) documents one related unplanned addition (the `/impact` index redirect) via an impl-review addendum, but does **not** flag the full-reload navigation as a deviation — likely because S-06 hadn't been carved out of the roadmap yet at that point.
- The impl-review fix-up commit for that PR ("impl-review triage — RPC join, board-role guard, plan addenda") added the supervisor-only switching guard now visible in `[...dateRange].astro:40-42` — so the access-control half of FR-007 was hardened, but the "no reload" half was never addressed.

### Role naming note

- Code uses `BoardRole = "supervisor" | "contributor"` (`src/types.ts:1`), which maps to the PRD's **EM** and **IC** respectively. No code-level "EM"/"IC" enum exists — searches for those terms hit only docs/content (avatar initials, GitHub collaborator labels), not role logic.

### Test coverage

- No existing tests reference `ContributorSelector` or `ImpactView` switching behavior (`tests/` has no hits for either name). `tests/component/impact.test.tsx` exists (added in the same PR) but does not appear to cover the selector's navigation behavior specifically — worth confirming scope when planning.

## Code References

- `src/components/impact/ImpactView.tsx:67-170` — `ContributorSelector` component (dropdown UI, already built)
- `src/components/impact/ImpactView.tsx:92-94` — `navigate()` — the full-reload call that needs to change
- `src/components/impact/ImpactView.tsx:172-205` — `ImpactView` root: owns `period`/`fetchKey` state and the `handlePeriodChange` pattern (`189-196`) that already demonstrates reload-free navigation for period switching
- `src/pages/board/[id]/impact/[githubLogin]/[...dateRange].astro:27-46` — server-side contributor list + role-based visibility filtering (already correct)
- `src/pages/board/[id]/impact/index.astro:11-19` — entry redirect to first contributor (unrelated to switching, but shares the contributor list)
- `src/types.ts:1` — `BoardRole = "supervisor" | "contributor"`

## Architecture Insights

- The codebase already has an established reload-free pattern for similar surface-level navigation within `ImpactView` (period switching via `history.replaceState` + state), so closing the S-06 gap is mechanical: replace `window.location.assign` in `navigate()` with the same `history.replaceState` + state-update approach already used for `period`, re-keyed on `githubLogin` instead of (or in addition to) `period`. The four section fetches in `ImpactView`'s `useEffect` (lines 180-187) already depend on `githubLogin`, so updating that piece of state should re-trigger fetches for the new contributor without a reload, mirroring `handlePeriodChange`.
- Access control for "who can switch" is already solid and tested by a prior impl-review pass — no work needed there.

## Historical Context (from prior changes)

- `context/archive/2026-06-15-profile-raw-github-metrics/plan.md` — origin plan for S-04; `ContributorSelector` is an unplanned (p4) addition not described in the original plan, confirmed via impl-review addenda for two _other_ deviations (F3 list-endpoint fields, F4 `/impact` index redirect) — the reload behavior itself was never flagged as a deviation against a not-yet-existing S-06.
- `context/foundation/roadmap.md:55` — Stream B (`F-02 → S-02 → S-04 → S-06`) groups S-06 right after S-04, consistent with S-06 being "the next increment on top of what S-04 already built" rather than a from-scratch feature.

## Related Research

- No prior `research.md` exists yet for `em-switch-ic-dropdown` (this is the first).
- See `context/archive/2026-06-15-profile-raw-github-metrics/research.md` and `plan.md` for the S-04 work this slice builds on.

## Open Questions

- Should the fix scope to _only_ removing the full reload (minimal S-06), or also add a regression test (none exist today) covering reload-free contributor switching? Recommend deciding this in `/10x-plan`, not here.
- `period` is currently re-keyed via `history.replaceState` per-period; when switching contributor, should the URL also update via `history.pushState`/`replaceState` (so back/forward and direct links still work), or is `replaceState` sufficient? Worth a one-line decision in the plan.
