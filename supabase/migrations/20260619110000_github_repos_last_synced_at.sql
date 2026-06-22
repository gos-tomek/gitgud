-- classification-batch (p4): track last successful GitHub sync per repo (not per board) so the
-- Workflow can pass `since` to syncBoardGitHubData instead of re-fetching full history on every
-- Cron run. Per-repo (not per-board) because `since` is a GitHub API parameter scoped to one
-- repo, and a board could in principle gain a repo later with its own independent sync history.

ALTER TABLE public.github_repos
  ADD COLUMN last_synced_at timestamptz;
