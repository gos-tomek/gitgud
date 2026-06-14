# Testing Access Boundary — Plan Brief

> Full plan: `context/changes/testing-access-boundary/plan.md`
> Research: `context/changes/testing-access-boundary/research.md`

## What & Why

Bootstrap the project's first test infrastructure (Vitest 4.x) and write integration tests that prove two critical security properties against a real local Supabase: (1) cross-board data isolation — a user on Board A cannot access Board B's data, and (2) PAT non-leakage — the raw GitHub PAT never appears in API responses or log output. This is Phase 1 of the test-plan rollout, covering Risks #1, #2, and #5.

## Starting Point

Zero test infrastructure exists — no runner, no test files, no scripts. The codebase has 7 board-scoped tables with RLS policies (consistent pattern: SELECT for members, writes for owner only). PAT is encrypted at rest via pgcrypto but decrypted on every sync request. Research mapped 4 PAT leak vectors and a `REVOKE ALL FROM authenticated` gap across all tables.

## Desired End State

`npm test` runs a Vitest integration suite that: creates two users with separate boards, proves neither can access the other's data across all 7 tables and service functions, stores an invalid PAT and proves sync error responses and server logs don't contain it. The test-plan cookbook (§6.1) documents these patterns for future tests.

## Key Decisions Made

| Decision                | Choice                                 | Why (1 sentence)                                                                                                              | Source          |
| ----------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------- |
| Test file location      | Top-level `tests/integration/`         | Clear separation of test infra from src/; test helpers (admin client, fixtures) don't belong in app code                      | Plan            |
| REVOKE ALL gap          | Test current behavior, fix separately  | Keeps this change focused on test infrastructure; tests document whether the gap is exploitable                               | Plan            |
| Test layer for RLS      | Direct Supabase client                 | Service functions are clean of `astro:env`; fastest setup with no Astro server needed; tests the actual access boundary (RLS) | Research + Plan |
| Test layer for PAT leak | HTTP requests to Astro dev server      | Response body leak vectors (#1/#2) can only be tested by calling the sync endpoint over HTTP                                  | Plan            |
| Supabase guard          | beforeAll skip with message            | Tests never fail mysteriously; developer knows exactly what to do                                                             | Plan            |
| Logger redaction        | Test current behavior, no prod changes | Tests act as a canary — if consola behavior changes and PAT leaks, the test catches it                                        | Plan            |

## Scope

**In scope:**

- Vitest 4.x installation + `getViteConfig()` configuration
- Test helpers: admin client, user factory, data seeding, Supabase guard
- Cross-board isolation tests for all 7 tables (SELECT/INSERT/UPDATE/DELETE)
- Service function isolation tests (getBoardWithRole, getBoardRepos, getBoardContributors)
- PAT leak tests via HTTP (sync endpoint error responses)
- PAT leak tests via server output capture (log output)
- Test-plan §6.1 cookbook update

**Out of scope:**

- Fixing `REVOKE ALL FROM authenticated` migration gap
- Adding logger redaction layer
- Board creation wizard tests (Phase 2)
- Zod validation tests (Phase 3)
- CI integration (Phase 4)
- e2e/Playwright tests

## Architecture / Approach

Two test suites with different layers:

```
access-boundary.test.ts          pat-leak.test.ts
        │                                │
   Direct Supabase client         Astro dev server (HTTP)
   (admin + user)                 + server output capture
        │                                │
   Local Supabase (RLS enforced)  Local Supabase + Astro runtime
```

Test helpers (`tests/helpers/`) provide: admin client (service-role, bypasses RLS), user factory, data seeding, Supabase guard, Astro server lifecycle, and authenticated fetch with SSR cookies.

## Phases at a Glance

| Phase                    | What it delivers                                  | Key risk                                                         |
| ------------------------ | ------------------------------------------------- | ---------------------------------------------------------------- |
| 1. Bootstrap             | Vitest + config + helpers + smoke test            | `getViteConfig()` may not resolve `astro:env` correctly          |
| 2. Cross-board isolation | RLS denial tests for 7 tables + service functions | Test data seeding complexity (full cascade chain)                |
| 3. PAT non-leakage       | HTTP + log capture tests for 4 leak vectors       | Supabase SSR cookie construction for authenticated HTTP requests |
| 4. Cookbook + cleanup    | §6.1 patterns + status updates                    | None                                                             |

**Prerequisites:** Local Supabase running (`npx supabase start`), Docker available, Node 22
**Estimated effort:** ~2-3 sessions across 4 phases

## Open Risks & Assumptions

- `getViteConfig()` is assumed to resolve `astro:env/server` in test context — if not, fallback to `vi.mock()` or `resolve.alias` shim
- Supabase SSR cookie format (`sb-127-auth-token`) may use chunking for large sessions — auth-fetch helper must handle this
- The invalid test PAT triggers a GitHub API 401 via Octokit, whose error message is assumed not to contain the token — this is what the test verifies

## Success Criteria (Summary)

- `npm test` passes with all cross-board denial assertions green and all PAT leak assertions green
- Stopping Supabase causes tests to skip with a clear message, not fail cryptically
- A developer reading §6.1 can write a new integration test without re-reading this plan
