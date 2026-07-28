# E2E Core User Flows — Plan Brief

> Full plan: `context/changes/e2e-core-user-flows/plan.md`

## What & Why

Add Playwright E2E tests for Phase 8 of the test rollout (test-plan.md §3): board lifecycle, contributor management, and non-owner denial. The existing seed test covers the wizard happy path — these specs fill the remaining risk gaps (#8 board deletion cascade, R5 unauthorized settings mutation, #1 cross-board isolation at the UI level, and contributor CRUD).

## Starting Point

Playwright is fully set up: config with `webServer` block, auth setup project, and a seed test (`seed.spec.ts`) demonstrating the project's E2E patterns — `page.route()` for GitHub API mocking, role-based locators, `Date.now()` board names, and UI-driven cleanup. Only one test user exists; no shared fixtures module; no CI job for E2E.

## Desired End State

Three new spec files pass locally and in CI. A viewer user (non-owner) is tested via a second Playwright auth project. Shared GitHub API fixtures eliminate duplication across specs. A `test-e2e` CI job runs the full Playwright suite on every PR with artifact upload on failure.

## Key Decisions Made

| Decision                       | Choice                                | Why (1 sentence)                                                                  |
| ------------------------------ | ------------------------------------- | --------------------------------------------------------------------------------- |
| Seed test overlap              | Seed covers #3 — focus on gaps        | Avoids redundant wizard coverage; component tests handle wizard edge cases        |
| File layout                    | One spec per risk cluster (3 files)   | Self-contained files mapping to clear risk areas; manageable setup duplication    |
| Second user approach           | Separate Playwright auth project      | Matches Playwright's recommended multi-role pattern; clean session isolation      |
| Fixture strategy               | Shared module, unique board names     | DRY fixtures with timestamp-suffixed names prevent collision                      |
| Dashboard verification         | Verify redirect targets correct board | Tests actual dashboard behavior (auto-redirect logic), not a hypothetical listing |
| Contributor verification scope | Settings AND impact nav               | Full proof that contributor is usable in the UI, not just stored                  |
| Cleanup strategy               | Delete board via UI in afterAll       | Tests the delete flow as part of cleanup; failure is loud                         |
| CI integration                 | In scope                              | E2E tests run on every PR from day one                                            |

## Scope

**In scope:**

- Board lifecycle spec (empty dashboard → create → redirect → delete → empty state)
- Contributor management spec (add via dialog → verify settings + impact nav → remove)
- Non-owner denial spec (UI hidden controls + API 403)
- Shared fixtures module extracted from seed test
- Viewer auth setup (second Playwright project)
- `npm run e2e` script
- CI `test-e2e` job with Supabase + Playwright

**Out of scope:**

- Wizard edge cases (back-nav, name collision) — covered by component tests
- Signup E2E — needs email confirmation handling
- Impact data correctness, sync workflows — Phases 5-7
- Visual regression — reserved for visual-only risks
- Repo management E2E — lower risk, not in Phase 8

## Architecture / Approach

All specs follow the seed test pattern: mock external GitHub APIs via `page.route()`, use real auth/routing/Supabase, create boards with `Date.now()` names, and clean up via the UI delete flow. The non-owner spec creates two browser contexts (owner + viewer) within a single spec file, using Playwright's `browser.newContext({ storageState })` to switch personas.

## Phases at a Glance

| Phase                     | What it delivers                                            | Key risk                                          |
| ------------------------- | ----------------------------------------------------------- | ------------------------------------------------- |
| 1. Foundation             | Shared fixtures, viewer auth project, npm script            | Viewer user account must exist in local Supabase  |
| 2. Board lifecycle        | Dashboard redirect verification + delete cascade E2E        | Empty state assertion assumes no leftover boards  |
| 3. Contributor management | Add/remove contributor via dialog + impact nav verification | Impact dropdown only renders with 2+ contributors |
| 4. Non-owner denial       | UI + API authorization assertions for viewer user           | Identity bridge must link viewer's GitHub login   |
| 5. CI integration         | `test-e2e` job in GitHub Actions                            | 5 new repository secrets needed                   |

**Prerequisites:** Two E2E test accounts (owner + viewer) created in local Supabase; viewer's GitHub username matches a mock collaborator login
**Estimated effort:** ~2-3 sessions across 5 phases

## Open Risks & Assumptions

- E2E test accounts must be pre-created manually (auth setup logs in existing accounts, doesn't create them)
- Board lifecycle empty-state assertion assumes the test user has no other boards — may need a cleanup hook if flaky
- The identity bridge trigger (`user_profiles.github_login` → `board_contributors.github_login`) must work correctly for the non-owner spec — this is itself the thing being tested
- CI job adds ~3-5 min to PR workflow; acceptable for the signal it provides

## Success Criteria (Summary)

- All 4 E2E specs (seed + 3 new) pass locally via `npm run e2e`
- CI `test-e2e` job passes on a PR branch
- Non-owner user is provably denied mutation access through both UI and API
