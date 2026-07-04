-- Filter bot comments server-side so the PostgREST row limit isn't consumed by
-- bot rows that the caller would discard anyway.  Return only `id` (sorted, so
-- offset-based pagination via .range() is deterministic) — the caller no longer
-- needs `commenter_login` since bots are excluded here.
--
-- DROP first because CREATE OR REPLACE cannot change the return type.
DROP FUNCTION IF EXISTS public.get_unclassified_root_comments_for_board(uuid);

CREATE FUNCTION public.get_unclassified_root_comments_for_board(p_board_id uuid)
RETURNS TABLE (id bigint)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT grc.id
  FROM public.github_review_comments grc
  JOIN public.github_pull_requests gpr ON gpr.id = grc.pull_request_id
  JOIN public.github_repos gr ON gr.id = gpr.repo_id
  WHERE gr.board_id = p_board_id
    AND grc.in_reply_to_id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.thread_classifications tc WHERE tc.thread_root_comment_id = grc.id
    )
    AND grc.commenter_login NOT LIKE '%[bot]'
    AND grc.commenter_login NOT LIKE '%-bot'
    AND grc.commenter_login NOT IN (
      'dependabot', 'renovate', 'codecov', 'codecov-bot', 'codecov-commenter',
      'github-actions'
    )
  ORDER BY grc.id;
$$;

REVOKE ALL ON FUNCTION public.get_unclassified_root_comments_for_board(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_unclassified_root_comments_for_board(uuid) TO authenticated;
