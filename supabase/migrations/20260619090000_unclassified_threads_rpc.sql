-- F-03: Classification batch Workflow — fetch unclassified root comment threads for a board.
--
-- Without lifting MAX_PRS_PER_REPO (F-03's whole point), an active board's PR/comment count
-- can grow large; passing PR ids back as a PostgREST `.in()` filter risks the same URL-length
-- problem that `get_board_reviews_for_reviewer` / `get_board_root_comments_for_commenter`
-- (20260617120000) were introduced to avoid. Joining from `board_id` server-side sidesteps it
-- entirely — no caller-supplied id array.
--
-- SECURITY INVOKER (default): called by `authenticated`, RLS on the joined tables filters
-- results to boards the caller can see (empty, not an error, for non-members). Called by
-- `service_role` (the Workflow), RLS is bypassed and the full board picture is returned.

CREATE FUNCTION public.get_unclassified_root_comments_for_board(p_board_id uuid)
RETURNS TABLE (id bigint, commenter_login text)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT grc.id, grc.commenter_login
  FROM public.github_review_comments grc
  JOIN public.github_pull_requests gpr ON gpr.id = grc.pull_request_id
  JOIN public.github_repos gr ON gr.id = gpr.repo_id
  WHERE gr.board_id = p_board_id
    AND grc.in_reply_to_id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.thread_classifications tc WHERE tc.thread_root_comment_id = grc.id
    );
$$;

REVOKE ALL ON FUNCTION public.get_unclassified_root_comments_for_board(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_unclassified_root_comments_for_board(uuid) TO authenticated;
