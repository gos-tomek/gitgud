# Board Creation Contract — Plan Brief

> Full plan: `context/changes/board-creation-contract/plan.md`
> Research: `context/changes/board-creation-contract/research.md`

## What & Why

Prove the board creation contract with tests covering both the 4-step API orchestration (POST /api/boards) and the 3-step React wizard (CreateBoardForm). This is test-plan Phase 2, addressing risks #3 (wizard state regression) and #4 (API partial-failure state). The research uncovered 3 API defects and 4 wizard bugs — tests document these as known behavior without fixing them.

## Starting Point

Phase 1 shipped Vitest 4.x with integration tests against real Supabase (`tests/integration/`). No component testing tooling exists — `@testing-library/react`, `happy-dom` are not installed. The vitest config is Node-only and excludes `.tsx` files. The API endpoint and wizard component are fully implemented but untested.

## Desired End State

`npm test` runs three test suites (integration, hermetic, component) — all green. Every partial-failure scenario from the research (H1-H8) has a hermetic test; every wizard state transition (W1-W9) has a component test. Cookbook §6.2 documents the patterns so future contributors can add tests without re-learning the setup.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|----------|--------|-------------------|--------|
| Bug fix vs document | Document first, fix later | Clean separation — this change is about testing, not refactoring | Plan |
| DOM environment | happy-dom | 2-3x faster than jsdom; sufficient for standard form inputs and checkboxes | Plan |
| Stub strategy | vi.fn() mocks on imported modules | User preference; vi.mock() works with @/ alias and handles the fluent chain | Plan |
| Wizard test scope | Full W1-W9 | Complete contract coverage per user decision | Plan |
| Phase ordering | Tooling → Hermetic → Component → Cookbook | Hermetic tests are simpler and validate the mock pattern before tackling DOM tests | Plan |
| Integration tests (I1-I3) | Excluded | Test plan defines Phase 2 as component + hermetic only | Research |

## Scope

**In scope:**
- Install testing-library + happy-dom + jest-dom + user-event
- Configure Vitest for dual environments (Node + happy-dom per-file)
- 8 hermetic API tests (H1-H8) with stubbed Supabase client
- 9 component tests (W1-W9) with mocked fetch
- Cookbook update (§6.2 component patterns, new hermetic pattern section)
- Test-plan §3 Phase 2 → shipped

**Out of scope:**
- Fixing defects S3, S4, S6 (PAT orphan, silent repo failure, cleanup-of-cleanup)
- Integration tests I1-I3 (real Supabase board creation)
- PAT validation race condition (Bug 2)
- E2e / Playwright tests

## Architecture / Approach

Two new test directories (`tests/hermetic/`, `tests/component/`) alongside existing `tests/integration/`. Hermetic tests mock at the module boundary (`@/lib/supabase`, `@/lib/services/boards`) using `vi.mock()` + `vi.hoisted()`, then import and call the POST handler directly. Component tests use `// @vitest-environment happy-dom` docblock for per-file DOM, mock `globalThis.fetch` for API calls, and use `@testing-library/react` with `userEvent.setup()` for interactions.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|-------|-----------------|----------|
| 1. Tooling & Infrastructure | npm packages installed, vitest config updated, directory structure | Peer dependency conflicts with React 19 |
| 2. Hermetic API Tests (H1-H8) | 8 tests covering all partial-failure scenarios | astro:env/server virtual module mock; BoardNameTakenError instanceof across mock boundary |
| 3. Component Tests (W1-W9) | 9 tests covering wizard state machine | 500ms debounce timing in tests; fetch mock sequencing across multi-step flows |
| 4. Cookbook & Plan Sync | Updated test-plan §6.2, new hermetic pattern section, Phase 2 shipped | None |

**Prerequisites:** Phase 1 test infrastructure (vitest, helpers) — already shipped.
**Estimated effort:** ~2-3 sessions across 4 phases.

## Open Risks & Assumptions

- `@testing-library/react` v16 peer dependency compatibility with React 19 is confirmed via npm registry but not yet tested in this project
- happy-dom's `fetch` implementation may behave differently from the browser — tests mock `globalThis.fetch` anyway, so this is low-risk
- The `astro:env/server` virtual module mock approach is untested in this codebase — if Vitest cannot resolve the mock, a `resolve.alias` entry in vitest.config.ts is the fallback

## Success Criteria (Summary)

- `npm test` passes with all 17 new tests (8 hermetic + 9 component) plus existing integration tests
- Every scenario from the research test contract (H1-H8, W1-W9) has a named test case
- Cookbook §6.2 is filled in with actionable patterns; test-plan §3 Phase 2 is marked shipped
