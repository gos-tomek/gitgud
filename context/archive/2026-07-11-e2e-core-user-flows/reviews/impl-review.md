<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: E2E Core User Flows

- **Plan**: context/changes/e2e-core-user-flows/plan.md
- **Scope**: Phases 1-4 of 5
- **Date**: 2026-07-29
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 2 observations

## Verdicts

| Dimension           | Verdict                 |
| ------------------- | ----------------------- |
| Plan Adherence      | WARNING ⚠️ (2 findings) |
| Scope Discipline    | PASS ✅                 |
| Safety & Quality    | PASS ✅                 |
| Architecture        | PASS ✅                 |
| Pattern Consistency | WARNING ⚠️ (1 finding)  |
| Success Criteria    | PASS ✅                 |

## Findings

### F1 — Empty-state assertion weakened in board-lifecycle spec

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: tests/e2e/board-lifecycle.spec.ts:76-84
- **Detail**: Plan specifies asserting "Welcome to GitGud" heading after board deletion to confirm the dashboard returns to empty state. Implementation instead checks that the URL no longer contains the deleted board ID. A comment explains the deviation: the "Welcome to GitGud" assertion breaks when parallel specs create boards concurrently. The weaker assertion proves the deleted board is unreachable but does not confirm the empty-state UI renders.
- **Fix A ⭐ Recommended**: Accept as-is and document in the plan as an addendum
  - Strength: The deviation is already documented in-code with a clear rationale. The "Welcome to GitGud" assertion is inherently incompatible with parallel test execution.
  - Tradeoff: Plan drifts from its original spec; the empty-state UI rendering is not E2E-tested.
  - Confidence: HIGH — the parallelism constraint is real and reproducible.
  - Blind spot: None significant.
- **Fix B**: Isolate the empty-state assertion in a separate serial spec
  - Strength: Restores the original plan's assertion without breaking parallelism for other tests.
  - Tradeoff: Adds a new spec file and forces serial execution for one test, increasing suite runtime.
  - Confidence: MEDIUM — serial mode works but the isolation setup (cleaning all owner boards) is fragile.
  - Blind spot: Whether the existing `deleteOwnerBoards` cleanup is sufficient to guarantee empty state.
- **Decision**: FIXED via Fix A — deviation documented in plan as addendum (Phase 2)

### F2 — DELETE /api/board/{id} 403 assertion omitted

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: tests/e2e/non-owner-denied.spec.ts:22-25
- **Detail**: Plan specifies four API denial assertions including `DELETE /api/board/{id} → 403`. Implementation omits this one, with an in-code comment explaining: the DELETE endpoint uses Supabase RLS which silently drops 0 rows (returns 200 with no effect) rather than returning 403. Three of four planned API assertions are present (PATCH settings, POST contributors, DELETE contributors).
- **Fix A ⭐ Recommended**: Accept the omission and add an assertion for the actual behavior (200 + board still exists)
  - Strength: Tests the real security boundary — RLS prevents deletion even though the status code isn't 403. Proves the board survives the attempt.
  - Tradeoff: Diverges from plan's "403" expectation; requires understanding that RLS silent-drop is the intended protection.
  - Confidence: HIGH — Supabase RLS behavior is well-documented and this is how the app's authorization works.
  - Blind spot: If the endpoint is ever refactored to use `getBoardWithRole()` instead of RLS, the expected status code would change to 403 and this test would need updating.
- **Fix B**: Refactor the DELETE endpoint to return 403 explicitly
  - Strength: Makes the API behavior consistent (all mutation endpoints return 403 for non-owners).
  - Tradeoff: App code change driven by a test expectation; out of scope for this E2E plan.
  - Confidence: LOW — requires investigating whether other consumers rely on the current silent-drop behavior.
  - Blind spot: Full blast radius of changing the DELETE endpoint's auth strategy.
- **Decision**: FIXED via Fix A — added DELETE 200 + board-still-exists assertion to non-owner-denied.spec.ts

### F3 — Raw CSS selector in contributor-management spec

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: tests/e2e/contributor-management.spec.ts:77
- **Detail**: Uses `dialog.locator("label").filter({ hasText: "@bob-viewer" }).click()` — a raw CSS selector. Project rules require `getByRole` / `getByLabel` / `getByText` first; CSS selectors are forbidden.
- **Fix**: Replace with `dialog.getByRole("checkbox", { name: /@bob-viewer/ }).click()` or `dialog.getByText("@bob-viewer").click()` depending on the DOM structure.
- **Decision**: FIXED — replaced label locator with dialog.getByRole("checkbox", { name: /@bob-viewer/ }).click()

### F4 — Hardcoded Supabase anon key fallback

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: tests/e2e/board-lifecycle.spec.ts:24-26
- **Detail**: The well-known local Supabase demo anon key is hardcoded as a fallback: `process.env.SUPABASE_KEY ?? "eyJhbG..."`. This is not a real secret (it's the demo key), but if the local Supabase CLI changes its default keys, this fallback would silently use a stale key rather than failing fast.
- **Fix**: Consider removing the fallback and relying solely on the env var from `.dev.vars`.
- **Decision**: FIXED — removed hardcoded fallback; SUPABASE_KEY now required alongside email/password

### F5 — Missing explicit trash-button assertions for non-owner view

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: tests/e2e/non-owner-denied.spec.ts:117-128
- **Detail**: Plan says viewer should see "no trash icons" for repos and "no trash icons" for contributors. Implementation asserts no "Add repository" button and no "Add contributors" button, but does not explicitly assert the absence of per-item trash/remove buttons for repos or contributors. The settings page hides all interactive components for non-supervisors, so the "Add" button checks are strong proxies, but the plan's specific "no trash icons" assertion is not present.
- **Fix**: Add `expect(page.getByRole("button", { name: /remove/i })).not.toBeVisible()` assertions for both repo and contributor sections.
- **Decision**: FIXED — added aria-label to Trash2 buttons in ContributorManager.tsx and RepoManager.tsx; added getByRole("button", { name: /^Remove/ }) not.toBeVisible() assertions to non-owner-denied.spec.ts for both sections.
