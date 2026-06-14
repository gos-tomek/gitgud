# Board Creation Contract — Implementation Plan

## Overview

Prove the board creation contract with two test layers: hermetic API tests (stubbed Supabase client) covering the 4-step POST /api/boards orchestration and its partial-failure modes, and React component tests (testing-library + happy-dom) covering the 3-step CreateBoardForm wizard's state machine. This is test-plan Phase 2, covering risks #3 and #4.

Tests document current behavior — known defects (S3 PAT-failure orphan, S4 silent repo failure) are asserted as-is with clear annotations, not fixed. Bug fixes ship separately.

## Current State Analysis

Phase 1 shipped a working Vitest 4.x setup (`vitest.config.ts`, `tests/integration/`, `tests/helpers/`) with real-Supabase integration tests. The test runner is configured for Node environment only. No component testing tooling exists — `@testing-library/react`, `happy-dom`, and `@testing-library/user-event` are not installed. The vitest include pattern (`tests/**/*.test.ts`) excludes `.tsx` files.

The API endpoint at `src/pages/api/boards/index.ts:33-112` has asymmetric error handling across its 4 steps. The wizard at `src/components/CreateBoardForm.tsx` manages 17 `useState` hooks with no state machine library.

### Key Discoveries:

- `vi.mock()` works with the `@/` path alias — Vitest resolves aliases via Vite's resolve pipeline (`vitest.config.ts:8-10`)
- `astro:env/server` is a virtual module that must be explicitly mocked in tests — Vitest cannot resolve it without a factory
- `BoardNameTakenError` must be re-declared inside the mock factory because the handler uses `instanceof` checks (`index.ts:106`)
- POST handler is a plain async function — importable and callable directly as `POST(mockContext)` without Astro middleware
- Per-file environment override via `// @vitest-environment happy-dom` docblock keeps integration tests on Node while component tests use happy-dom

## Desired End State

After this plan is complete:

1. `npm test` runs three test suites: integration (existing), hermetic API, and component — all green.
2. Hermetic tests prove all 6 partial-failure scenarios from the research (H1-H8), documenting defects S3 and S4 as known behavior.
3. Component tests prove the wizard's step guards, data carry-forward, complete submit flow, and stale-state bugs (W1-W9).
4. Cookbook §6.2 documents how to add component tests; a new §6.x documents the hermetic stub pattern.
5. Test-plan §3 Phase 2 status is "shipped".

Verification: `npm test` passes. Each test scenario from the research (H1-H8, W1-W9) has a corresponding test case with a name matching the scenario ID.

## What We're NOT Doing

- Fixing defects S3 (PAT-failure orphan), S4 (silent repo failure), or S6 (cleanup-of-cleanup failure). Tests document these as known behavior.
- Integration tests for board creation (I1-I3). Those hit real Supabase and are out of scope for Phase 2.
- Testing the PAT validation race condition (Bug 2 from research). It's a wizard bug but not in risk #3's description.
- E2e tests via Playwright. Not in the rollout scope.
- Fixing wizard bugs (stale contributors, empty collaborator dead-end). Tests document them.

## Implementation Approach

Four sequential phases: (1) install tooling and configure Vitest for dual environments, (2) write hermetic API tests using `vi.mock()` to stub the Supabase client and service functions, (3) write component tests using testing-library with mocked fetch, (4) update the cookbook and test-plan status.

Hermetic tests come before component tests because they're simpler (pure request/response, no DOM) and validate the mock pattern foundation that component tests also depend on (vi.mock, vi.hoisted).

## Critical Implementation Details

### vi.hoisted() for mock variables

Any variable referenced inside a `vi.mock()` factory must be declared with `vi.hoisted()`. Without it, the variable declaration hasn't executed when the hoisted factory runs, causing `ReferenceError`. This applies to the mock Supabase client object, mock service functions, and the re-declared `BoardNameTakenError` class.

### Supabase fluent chain mocking

The endpoint calls `supabase.from("github_repos").insert([...])` and `supabase.from("boards").delete().eq("id", boardId)`. These are different tables returning different chain shapes. Use `mockSupabase.from.mockImplementation()` with a table-name switch to return the correct chain shape per table.

---

## Phase 1: Tooling & Infrastructure

### Overview

Install component testing dependencies, configure Vitest for dual environments (Node for integration, happy-dom for component), and create the directory structure for new test types.

### Changes Required:

#### 1. Install npm packages

**Intent**: Add testing-library ecosystem and happy-dom as dev dependencies.

**Contract**: `npm install --save-dev @testing-library/react@^16 @testing-library/dom@^10 @testing-library/jest-dom@^6 @testing-library/user-event@^14 happy-dom@^20`

`@testing-library/react` v16 is required for React 19 peer dependency support.

#### 2. Update Vitest config

**File**: `vitest.config.ts`

**Intent**: Extend the test include pattern to cover `.tsx` files and register a setup file for jest-dom matchers.

**Contract**: `include` changes from `["tests/**/*.test.ts"]` to `["tests/**/*.test.{ts,tsx}"]`. Add `setupFiles: ["tests/setup-dom.ts"]`.

#### 3. Create jest-dom setup file

**File**: `tests/setup-dom.ts`

**Intent**: Register `@testing-library/jest-dom` matchers (e.g. `toBeInTheDocument()`) globally for all tests.

**Contract**: Single import: `import "@testing-library/jest-dom/vitest";` — safe in Node environment (only extends `expect`).

#### 4. Update test TypeScript config

**File**: `tests/tsconfig.json`

**Intent**: Allow `.tsx` files in the test directory.

**Contract**: Add `./**/*.tsx` to the `include` array.

#### 5. Create directory structure

**Intent**: Create `tests/component/` and `tests/hermetic/` directories as peers to `tests/integration/`.

**Contract**: Two new directories matching the test-plan vocabulary: `tests/hermetic/` for stubbed-client API tests, `tests/component/` for React component tests.

### Success Criteria:

#### Automated Verification:

- `npm install` succeeds with no peer dependency conflicts
- `npx vitest run --reporter=verbose` runs existing integration tests without regression
- TypeScript compiles: `npx tsc --noEmit -p tests/tsconfig.json` (after adding a trivial `.tsx` placeholder)

#### Manual Verification:

- `package.json` devDependencies include all 5 new packages

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Hermetic API Tests (H1-H8)

### Overview

Test the POST /api/boards endpoint with a fully stubbed Supabase client. Each of the 6 partial-failure scenarios from the research gets a dedicated test case, plus validation and auth edge cases.

### Changes Required:

#### 1. Create hermetic test file with mock scaffolding

**File**: `tests/hermetic/board-creation.test.ts`

**Intent**: Set up the module mocks that all H-scenarios share: stubbed `createClient`, stubbed service functions, mocked `astro:env/server`, mocked logger. Each test configures which step fails.

**Contract**: Four `vi.mock()` calls covering `@/lib/supabase`, `@/lib/services/boards`, `astro:env/server`, `@/lib/logger`. A `beforeEach` resets all mocks and configures happy-path defaults. A `makeContext(body)` helper constructs the minimal `APIContext` shape the handler needs.

The `BoardNameTakenError` class must be re-declared inside the `vi.hoisted()` block:

```ts
const mockBoardServices = vi.hoisted(() => ({
  createBoard: vi.fn(),
  addBoardContributors: vi.fn(),
  BoardNameTakenError: class BoardNameTakenError extends Error {
    constructor() {
      super("You already have a board with that name");
      this.name = "BoardNameTakenError";
    }
  },
}));
```

The `supabase.from()` mock dispatches by table name:

```ts
mockSupabase.from.mockImplementation((table: string) => {
  if (table === "github_repos") return { insert: mockRepoInsert };
  if (table === "boards") return { delete: vi.fn(() => ({ eq: mockDeleteEq })) };
  throw new Error(`Unexpected table: ${table}`);
});
```

#### 2. Implement test scenarios H1-H8

**Intent**: One `it()` block per scenario from the research test contract. Tests document current behavior, including known defects.

**Contract**: Scenarios map to test cases as follows:

| Test | Scenario                               | Key assertion                                                               |
| ---- | -------------------------------------- | --------------------------------------------------------------------------- |
| H1   | Happy path: all 4 steps succeed        | `status === 201`, body `{ id }`                                             |
| H2   | Step 1 fails: unique name (code 23505) | `status === 409`, error message, no further calls                           |
| H3   | Step 2 fails: PAT storage              | `status === 500`, board not deleted (documents S3 defect)                   |
| H4   | Step 3 fails: repo linking             | `status === 201` (documents S4 defect), `addBoardContributors` still called |
| H5   | Step 4 fails, cleanup succeeds         | `status === 500`, board delete called with correct ID                       |
| H6   | Step 4 fails, cleanup fails            | `status === 500`, `logger.error` called with cleanup failure                |
| H7   | Validation: missing/invalid fields     | `status === 400`, specific error messages per field                         |
| H8   | Auth: no session                       | `status === 401`                                                            |

H3 and H4 must include a comment documenting the known defect (e.g. `// Known defect S3: PAT failure does not clean up orphaned board`).

### Success Criteria:

#### Automated Verification:

- All 8 hermetic tests pass: `npx vitest run tests/hermetic/board-creation.test.ts`
- Lint passes: `npm run lint`
- TypeScript compiles: `npx tsc --noEmit -p tests/tsconfig.json`

#### Manual Verification:

- Each test name clearly identifies its scenario (H1-H8)
- Defect-documenting tests (H3, H4) have inline comments explaining the known behavior

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Component Tests (W1-W9)

### Overview

Test the CreateBoardForm wizard's state machine: step transition guards, data persistence across steps, the complete submit flow, and known stale-state bugs. Uses testing-library with happy-dom environment.

### Changes Required:

#### 1. Create component test file with test infrastructure

**File**: `tests/component/CreateBoardForm.test.tsx`

**Intent**: Set up the happy-dom environment, fetch mock, and window.location mock that all wizard tests share.

**Contract**: File begins with `// @vitest-environment happy-dom` docblock. `beforeEach` installs a `vi.fn()` as `globalThis.fetch` and mocks `window.location` to prevent navigation. `afterEach` restores originals.

A helper function configures the common fetch mock sequence for advancing through steps:

- PAT validation → `{ ok: true, json: { login, avatarUrl } }`
- Name check → `{ ok: true, status: 204 }`
- Repos fetch → `{ ok: true, json: { repos: [...] } }`
- Collaborators fetch → `{ ok: true, json: { collaborators: [...] } }`

#### 2. Implement test scenarios W1-W9

**Intent**: One `it()` block per wizard scenario from the research test contract.

**Contract**: Scenarios map to test cases:

| Test | Scenario                                 | Key assertion                                                                   |
| ---- | ---------------------------------------- | ------------------------------------------------------------------------------- |
| W1   | Step 1→2: name empty                     | Next button click does not advance, error shown                                 |
| W2   | Step 1→2: PAT not validated              | Next button disabled                                                            |
| W3   | Step 1→2→3→submit: complete flow         | `fetch` called with POST /api/boards, body contains data from all 3 steps       |
| W4   | Step 2→1→2: PAT changed                  | `selectedRepos` cleared, repos re-fetched                                       |
| W5   | Step 3→2→3: repos changed                | Collaborators re-fetched                                                        |
| W6   | Step 3→2→3: stale contributors           | `selectedContributors` still contains entries from old repo set (documents bug) |
| W7   | Step 2: no repos selected                | Next button disabled                                                            |
| W8   | Step 3: no contributors selected         | Create Board button disabled                                                    |
| W9   | Step 3: empty collaborator list from API | "No collaborators found" shown, submit disabled                                 |

W6 must include a comment documenting the stale-selection bug.

The PAT validation uses a 500ms debounce (`CreateBoardForm.tsx:127`). Tests should use `vi.useFakeTimers()` + `vi.advanceTimersByTime(500)` or `waitFor()` to handle the debounce. Use `userEvent.setup()` (not bare `userEvent.click()`) for all interactions.

### Success Criteria:

#### Automated Verification:

- All 9 component tests pass: `npx vitest run tests/component/CreateBoardForm.test.tsx`
- Full suite passes: `npm test`
- Lint passes: `npm run lint`

#### Manual Verification:

- Tests use accessible queries (`getByRole`, `getByText`, `getByPlaceholderText`) — no class-name assertions
- Stale-state bug test (W6) has inline comment explaining the known defect

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Cookbook & Plan Sync

### Overview

Update the test plan cookbook with patterns for component tests and hermetic tests. Mark Phase 2 as shipped.

### Changes Required:

#### 1. Fill in cookbook §6.2

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the "TBD" placeholder in §6.2 with documented patterns for component testing (React islands with testing-library + happy-dom).

**Contract**: §6.2 section covers: per-file environment docblock, fetch mock pattern, window.location mock, debounce handling with fake timers or waitFor, userEvent.setup() requirement, accessible query preference.

#### 2. Add cookbook §6.x for hermetic API tests

**File**: `context/foundation/test-plan.md`

**Intent**: Document the hermetic testing pattern — how to stub the Supabase client for API route tests.

**Contract**: New subsection (after §6.2, before §6.3) covering: vi.hoisted pattern for mock variables, vi.mock for @/lib/supabase and service modules, astro:env/server virtual module mock, fluent chain mocking with table-name dispatch, makeContext helper, BoardNameTakenError re-declaration.

#### 3. Update test-plan §3 Phase 2 status

**File**: `context/foundation/test-plan.md`

**Intent**: Mark Phase 2 as shipped and record the change folder.

**Contract**: In the §3 rollout table, Phase 2 row: `Status` changes from `not started` to `shipped`, `Change folder` changes from `—` to `context/changes/board-creation-contract/`.

#### 4. Update change.md status

**File**: `context/changes/board-creation-contract/change.md`

**Intent**: Mark the change as implemented after all phases complete.

**Contract**: Frontmatter `status` changes from `planned` to `implemented`, `updated` set to current date.

### Success Criteria:

#### Automated Verification:

- Full test suite passes: `npm test`
- Lint passes on updated markdown: `npm run format`

#### Manual Verification:

- §6.2 contains actionable patterns matching what was implemented in Phase 3
- §3 Phase 2 row shows "shipped" with correct change folder path

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Hermetic Tests (Phase 2):

- All 6 partial-failure scenarios (H1-H6) plus validation (H7) and auth (H8)
- Stub boundaries: `@/lib/supabase`, `@/lib/services/boards`, `astro:env/server`, `@/lib/logger`
- Each test controls exactly which step fails via mock configuration
- Defect-documenting tests assert current (broken) behavior, not desired behavior

### Component Tests (Phase 3):

- All 9 wizard scenarios (W1-W9) covering step guards, data flow, and edge cases
- Mocked: `globalThis.fetch`, `window.location`
- Uses `@testing-library/react` with `happy-dom` environment
- No Supabase client mocking needed — the component talks to APIs via fetch

### No Integration Tests:

- I1-I3 are out of scope per test-plan Phase 2 definition
- Existing integration tests (access-boundary, PAT leak) continue to run unchanged

## Performance Considerations

- happy-dom is 2-3x faster than jsdom — chosen to keep the test suite fast
- Per-file environment override avoids loading a DOM for integration tests that don't need it
- Hermetic tests run in Node environment — no DOM overhead

## Migration Notes

N/A — no data or schema changes.

## References

- Research: `context/changes/board-creation-contract/research.md`
- Test plan: `context/foundation/test-plan.md` (§2 risks #3/#4, §3 Phase 2, §6 cookbook)
- API endpoint: `src/pages/api/boards/index.ts:33-112`
- Service functions: `src/lib/services/boards.ts:33-47` (createBoard), `src/lib/services/boards.ts:116-131` (addBoardContributors)
- Wizard component: `src/components/CreateBoardForm.tsx`
- Existing test setup: `vitest.config.ts`, `tests/helpers/`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Tooling & Infrastructure

#### Automated

- [x] 1.1 npm install succeeds with no peer dependency conflicts — 4a897ee
- [x] 1.2 Existing integration tests pass without regression — 4a897ee
- [x] 1.3 TypeScript compiles with updated tsconfig — 4a897ee

#### Manual

- [x] 1.4 package.json devDependencies include all 5 new packages — 4a897ee

### Phase 2: Hermetic API Tests (H1-H8)

#### Automated

- [x] 2.1 All 8 hermetic tests pass — de54c9e
- [x] 2.2 Lint passes — de54c9e
- [x] 2.3 TypeScript compiles — de54c9e

#### Manual

- [x] 2.4 Each test name identifies its scenario (H1-H8) — de54c9e
- [x] 2.5 Defect-documenting tests have inline comments — de54c9e

### Phase 3: Component Tests (W1-W9)

#### Automated

- [x] 3.1 All 9 component tests pass — 0cade11
- [x] 3.2 Full suite passes (npm test) — 0cade11
- [x] 3.3 Lint passes — 0cade11

#### Manual

- [x] 3.4 Tests use accessible queries only — 0cade11
- [x] 3.5 Stale-state bug test has inline comment — 0cade11

### Phase 4: Cookbook & Plan Sync

#### Automated

- [x] 4.1 Full test suite passes — d5dcd2b
- [x] 4.2 Format passes on updated markdown — d5dcd2b

#### Manual

- [x] 4.3 §6.2 contains actionable component test patterns — d5dcd2b
- [x] 4.4 §3 Phase 2 row shows shipped — d5dcd2b
