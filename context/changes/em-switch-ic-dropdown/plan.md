# EM Switch IC Dropdown — Implementation Plan

## Overview

Replace the full-page `window.location.assign` navigation in `ContributorSelector` with a client-side state update + `history.pushState`, so switching between ICs loads the selected profile without a full page reload. This closes the one remaining acceptance criterion for S-06 (FR-007 / US-01).

## Current State Analysis

The dropdown UI already exists and works — it shipped as an unplanned addition inside S-04. Role-based scoping is correct (supervisors see all contributors; ICs see only themselves). The only gap is the navigation method: `window.location.assign` triggers a full reload, violating the PRD's explicit "without a full page reload" criterion.

### Key Discoveries:

- `ImpactView.tsx:92-94` — `navigate()` uses `window.location.assign` (full reload)
- `ImpactView.tsx:189-196` — `handlePeriodChange` already demonstrates the exact pattern needed: `history.replaceState` + state reset + setter
- `ImpactView.tsx:180-187` — `useEffect` already includes `githubLogin` in its dependency array, so promoting it to state will auto-trigger all four section fetches
- `githubLogin` and `contributor` are currently **props** from the Astro page — they need to become React state to enable client-side switching
- No tests cover `ContributorSelector` or contributor switching behavior (`tests/component/impact.test.tsx` covers only `PeriodSelector` and `KpiCards`)

## Desired End State

Clicking a contributor in the dropdown:

1. Updates the URL via `history.pushState` (back button returns to previous contributor)
2. Resets all four data sections to loading state (skeleton flash)
3. Re-fetches all sections for the new contributor
4. Preserves the current period selection
5. Updates the header to show the new contributor's avatar and login

No full page reload occurs. A component test guards this behavior against regression.

## What We're NOT Doing

- Changing the role-based access control (already correct, hardened by S-04 impl-review)
- Modifying the Astro page or server-side contributor list logic
- Adding keyboard navigation or accessibility enhancements to the dropdown (separate concern)
- Changing the dropdown visual design
- Handling browser popstate (back/forward) — `history.pushState` updates the URL for bookmarkability, but pressing back will do a full navigation to the previous URL, which is acceptable for this slice

## Implementation Approach

Mirror the existing `handlePeriodChange` pattern: promote `githubLogin` and `contributor` from props to state, create a `handleContributorChange` callback that resets sections + updates URL + sets state, and pass it into `ContributorSelector` instead of having the selector call `window.location.assign` directly.

## Phase 1: Client-side contributor switching

### Overview

Replace the full-reload navigation with client-side state management in `ImpactView.tsx`. This is the core behavioral change that satisfies the S-06 acceptance criterion.

### Changes Required:

#### 1. Promote `githubLogin` and `contributor` to state

**File**: `src/components/impact/ImpactView.tsx`

**Intent**: Convert `githubLogin` and `contributor` from static props to React state so they can be updated client-side when the user switches contributors. Initial values come from the existing props.

**Contract**: `ImpactView` gains `useState` calls for `currentLogin` (initialized from `props.githubLogin`) and `currentContributor` (initialized from `props.contributor`). All downstream references to `githubLogin` and `contributor` in `ImpactView`'s body update to use the state values. The `useEffect` dependency array at line 187 already references `githubLogin` — it must reference the state variable instead.

#### 2. Create `handleContributorChange` handler

**File**: `src/components/impact/ImpactView.tsx`

**Intent**: Add a handler that mirrors `handlePeriodChange` but for contributor switching — updates the URL, resets all section states to loading, and sets the new contributor state.

**Contract**: Function signature: `(login: string) => void`. Uses `history.pushState` (not `replaceState`) to add a history entry. Constructs URL as `/board/${boardId}/impact/${login}/${period}`. Resets all four section states via `idle()` calls (same pattern as `handlePeriodChange`). Sets both `currentLogin` and `currentContributor` (looking up the contributor from the `contributors` prop array).

#### 3. Wire `ContributorSelector` to use the handler

**File**: `src/components/impact/ImpactView.tsx`

**Intent**: Replace the internal `navigate()` function in `ContributorSelector` with the `onContributorChange` callback from `ImpactView`, removing the `window.location.assign` call.

**Contract**: `ContributorSelector` receives an `onContributorChange: (login: string) => void` prop instead of `boardId` and `period`. The `navigate` function inside `ContributorSelector` is removed. Each contributor button's `onClick` calls `onContributorChange(c.githubLogin)` and closes the dropdown.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run test:typecheck` and `npx tsc --noEmit`
- Linting passes: `npm run lint`
- Existing tests pass: `npm test`
- Build succeeds: `npm run build`

#### Manual Verification:

- On the impact page as a supervisor with multiple contributors, clicking a contributor in the dropdown switches to their profile without a full page reload (no white flash, no spinner in browser tab)
- URL updates to reflect the new contributor's login
- All four data sections show loading skeletons briefly, then load the new contributor's data
- Period selection is preserved across contributor switches
- Browser back button returns to the previous contributor's URL (full reload on back is acceptable)
- The header avatar and login update to the selected contributor

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Regression test

### Overview

Add a component test for `ContributorSelector` that verifies clicking a contributor calls the `onContributorChange` callback (not `window.location.assign`), guarding against re-introduction of full-reload navigation.

### Changes Required:

#### 1. Add ContributorSelector tests

**File**: `tests/component/impact.test.tsx`

**Intent**: Add a `describe("ContributorSelector")` block that tests the switching behavior — verifying the callback is invoked with the correct login and that `window.location.assign` is never called.

**Contract**: Tests render `ContributorSelector` (needs to be exported from `ImpactView.tsx` or extracted). The test provides a mock `onContributorChange` callback and a `contributors` array with 2+ entries. Asserts: (1) clicking a non-current contributor calls `onContributorChange` with that contributor's login, (2) `window.location.assign` is not called (spy on `window.location.assign`). Uses the same `@testing-library/react` + `userEvent` setup as the existing `PeriodSelector` tests.

#### 2. Export `ContributorSelector` for testability

**File**: `src/components/impact/ImpactView.tsx`

**Intent**: Add a named export for `ContributorSelector` so the test file can import it directly.

**Contract**: `export function ContributorSelector` (add `export` keyword to existing function declaration). `ContributorAvatar` does not need exporting — it's an internal dependency that renders as part of `ContributorSelector`.

### Success Criteria:

#### Automated Verification:

- New tests pass: `npm test`
- Type checking passes: `npm run test:typecheck`
- Linting passes: `npm run lint`

#### Manual Verification:

- Test output confirms the new `ContributorSelector` describe block runs with passing assertions

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Component Tests:

- ContributorSelector calls `onContributorChange` with correct login on click
- ContributorSelector does NOT call `window.location.assign`
- Dropdown opens/closes correctly (optional, lower priority)

### Manual Testing Steps:

1. Navigate to impact page as supervisor with 2+ contributors on the board
2. Click dropdown, select a different contributor — verify no full reload
3. Verify URL updates, data refreshes, period is preserved
4. Click back button — verify URL returns to previous contributor
5. Test with single contributor — verify dropdown doesn't render (existing behavior preserved)

## References

- Research: `context/changes/em-switch-ic-dropdown/research.md`
- Existing pattern: `src/components/impact/ImpactView.tsx:189-196` (`handlePeriodChange`)
- PRD requirement: `context/foundation/prd.md:59,65` (US-01 acceptance criteria)
- Roadmap: `context/foundation/roadmap.md:201-211` (S-06 detail)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Client-side contributor switching

#### Automated

- [x] 1.1 Type checking passes (`npm run test:typecheck` and `npx tsc --noEmit`)
- [x] 1.2 Linting passes (`npm run lint`)
- [x] 1.3 Existing tests pass (`npm test`)
- [x] 1.4 Build succeeds (`npm run build`)

#### Manual

- [x] 1.5 Contributor switch works without full page reload
- [x] 1.6 URL updates, data refreshes, period preserved
- [x] 1.7 Back button returns to previous contributor URL

### Phase 2: Regression test

#### Automated

- [ ] 2.1 New ContributorSelector tests pass (`npm test`)
- [ ] 2.2 Type checking passes (`npm run test:typecheck`)
- [ ] 2.3 Linting passes (`npm run lint`)

#### Manual

- [ ] 2.4 Test output confirms ContributorSelector describe block runs
