-- get_user_github_pat (20260625120000_user_pat_and_expiry.sql) is called by the sync Workflow
-- via the service-role client and its body explicitly branches on auth.role() = 'service_role'
-- to bypass the board-owner check for that caller — but the function was only ever granted to
-- `authenticated`, never to `service_role`. service_role is not a member of authenticated
-- (confirmed via pg_auth_members), so every call from the Workflow fails with a Postgres
-- permission-denied error, which getGitHubToken (src/lib/github.ts) collapses into the generic
-- GitHubTokenMissingError — the sync-repo phase has been failing silently on every run.
-- Production already carries this grant, applied out-of-band and never captured in a migration;
-- this brings every other environment (local, CI, staging) in line with it.
GRANT EXECUTE ON FUNCTION public.get_user_github_pat(uuid, text) TO service_role;
