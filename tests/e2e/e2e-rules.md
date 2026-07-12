# E2E Testing Rules

Read this file before generating or modifying any spec in `tests/e2e/`.

## Locators

- Use `getByRole`, `getByLabel`, `getByText` as primary locators.
- Fall back to `getByTestId` only when accessibility attributes are ambiguous.
- Never use CSS selectors, XPath, or DOM structure for locating elements.

## Isolation

- Each test must be independently runnable — no shared state between tests.
- Use unique identifiers (e.g. `Date.now()` suffix) for test data to avoid collisions in parallel runs.
- Clean up created data in `afterAll` (UI-driven, same pattern as seed test).

## Waiting

- Never use `page.waitForTimeout()`. Wait for specific conditions:
  `toBeVisible()`, `waitForURL()`, `waitForResponse()`, `waitForLoadState()`.

## Authentication

- Use `storageState` injected by Playwright config — never log in through the UI in individual tests.
- Viewer (non-owner) context: `browser.newContext({ storageState: 'playwright/.auth/viewer.json' })`.

## Assertions

- Assert the business outcome, not implementation details.
- Test name must bind to a named risk from `context/foundation/test-plan.md`.
- Every assertion must fail if its risk materializes — confirm with a deliberate break.

## Mocking

- Real: auth session, routing, Supabase RPC + cascade, all internal boundaries.
- Mocked: `/api/github/repos` and `/api/github/collaborators` — external, non-deterministic.
- Use `mockGitHubApis(page)` from `./fixtures.ts`; register routes before navigation.
- `page.route()` intercepts browser-side requests only — server-side external calls need server-level mocking.

## Template

See `seed.spec.ts` for the canonical example. All generated specs must follow its patterns.
