-- Batch-update PR size columns (additions, deletions, changed_files) from a single JSON array.
-- Used by the classification-batch Workflow to replace per-PR individual UPDATE calls with one
-- SQL UPDATE…FROM, reducing per-step Cloudflare Worker subrequests from O(N) to O(1).

CREATE OR REPLACE FUNCTION public.batch_update_pr_sizes(updates jsonb)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE public.github_pull_requests AS pr
  SET
    additions    = (u->>'additions')::bigint,
    deletions    = (u->>'deletions')::bigint,
    changed_files = (u->>'changed_files')::int
  FROM jsonb_array_elements(updates) AS u
  WHERE pr.id = (u->>'id')::bigint;
$$;

-- Only the service role (Workflow) calls this — revoke from all lower-privilege roles.
REVOKE ALL ON FUNCTION public.batch_update_pr_sizes(jsonb) FROM public, anon, authenticated;
