# EM Switch IC Dropdown — Plan Brief

> Full plan: `context/changes/em-switch-ic-dropdown/plan.md`
> Research: `context/changes/em-switch-ic-dropdown/research.md`

## What & Why

S-06 closes the last gap in FR-007/US-01: an EM can already switch between ICs via a dropdown, but the switch triggers a full page reload (`window.location.assign`). The PRD explicitly requires "without a full page reload." This plan replaces the reload with a client-side state update.

## Starting Point

`ContributorSelector` in `ImpactView.tsx` is fully built (shipped as part of S-04). Role-based scoping is correct. The exact pattern we need — `history` API + state reset + setter — already exists in `handlePeriodChange` in the same file. The `useEffect` that fetches all four data sections already depends on `githubLogin`. No tests exist for the switching behavior.

## Desired End State

Clicking a contributor in the dropdown instantly updates the header, URL, and data sections without a full page reload. The browser back button returns to the previous contributor's URL. A component test guards the no-reload behavior against regression.

## Key Decisions Made

| Decision             | Choice               | Why (1 sentence)                                                          | Source |
| -------------------- | -------------------- | ------------------------------------------------------------------------- | ------ |
| URL history method   | `pushState`          | Back button = "undo switch" — natural for an EM comparing 2-3 ICs         | Plan   |
| Period on switch     | Preserve current     | EM comparing ICs within a timeframe shouldn't re-select period each time  | Plan   |
| Loading UX on switch | Flash skeletons      | Consistent with period switch; avoids showing mismatched contributor data | Plan   |
| Test scope           | Fix + component test | Guards the exact regression S-06 exists to close                          | Plan   |

## Scope

**In scope:**

- Replace `window.location.assign` with state update + `history.pushState` in `ImpactView.tsx`
- Promote `githubLogin` and `contributor` from props to state
- Add component test for `ContributorSelector` switching behavior

**Out of scope:**

- Role-based access control changes (already correct)
- Dropdown visual/UX redesign
- Keyboard navigation / a11y improvements
- `popstate` event handling (back button triggers full navigation — acceptable)

## Architecture / Approach

Single-file change in `ImpactView.tsx`: promote two props to state, add a `handleContributorChange` handler mirroring the existing `handlePeriodChange`, pass it into `ContributorSelector` as a callback. No new components, no API changes, no schema changes.

## Phases at a Glance

| Phase                    | What it delivers                                     | Key risk                                                     |
| ------------------------ | ---------------------------------------------------- | ------------------------------------------------------------ |
| 1. Client-side switching | No-reload contributor switch with URL + state update | Low — mirrors existing pattern exactly                       |
| 2. Regression test       | Component test guarding no-reload behavior           | Low — follows established test patterns in `impact.test.tsx` |

**Prerequisites:** S-04 complete (already done)
**Estimated effort:** ~1 session, single phase each

## Open Risks & Assumptions

- Assumes `contributors` prop array is stable across the component's lifetime (no dynamic additions during a session) — true today since the list is server-rendered
- `popstate` (browser back) will do a full page load to the previous URL — acceptable for this slice; can be enhanced later if needed

## Success Criteria (Summary)

- Switching contributor in the dropdown does not trigger a full page reload
- URL, header, and all data sections update correctly on switch
- Component test prevents regression to `window.location.assign`
