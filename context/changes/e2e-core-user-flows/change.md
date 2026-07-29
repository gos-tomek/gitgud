---
change_id: e2e-core-user-flows
title: E2E core user flows — board lifecycle, contributor CRUD, non-owner denial
status: implementing
created: 2026-07-11
updated: 2026-07-29
archived_at: null
---

## Notes

### E2E CI Secrets

Five GitHub repository secrets must be added before the `test-e2e` CI job can pass:

| Secret                | Description                                                   |
| --------------------- | ------------------------------------------------------------- |
| `E2E_EMAIL`           | Email address of the owner test account                       |
| `E2E_PASSWORD`        | Password of the owner test account                            |
| `E2E_GITHUB_PAT`      | GitHub Personal Access Token for the owner (scoped to `repo`) |
| `E2E_VIEWER_EMAIL`    | Email address of the viewer (non-owner) test account          |
| `E2E_VIEWER_PASSWORD` | Password of the viewer test account                           |

### Creating E2E Test Accounts

The auth setup files (`auth.setup.ts`, `auth-viewer.setup.ts`) log in to **existing** accounts — they do not create accounts. Both accounts must be pre-seeded in whichever Supabase instance the CI job uses.

**Local Supabase (for local dev and CI):**

1. Start local Supabase: `npx supabase start`
2. Open the Supabase Studio URL printed by the command (typically `http://127.0.0.1:54323`)
3. Navigate to Authentication → Users → Add user
4. Create the owner account with `E2E_EMAIL` / `E2E_PASSWORD`
5. Create the viewer account with `E2E_VIEWER_EMAIL` / `E2E_VIEWER_PASSWORD`; set the viewer's `github_login` in `user_profiles` to `bob-viewer` (must match the mock collaborator login in `tests/e2e/fixtures.ts`)

**CI note:** The `test-e2e` job starts a fresh local Supabase instance on each run via `npx supabase start`. The migrations run automatically (`supabase/migrations/`), but the test accounts must be seeded. Either add a seeding step to the job (e.g., `npx supabase db execute` with a SQL INSERT), or use a persistent Supabase project whose URL/key are supplied as CI secrets instead of the local defaults.
