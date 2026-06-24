-- profile-classified-comments: read path for thread_classifications. Joins on repo_id
-- server-side rather than passing a caller-supplied PR-id array, following the same
-- URL-length-safety rationale as get_board_reviews_for_reviewer /
-- get_board_root_comments_for_commenter (20260617120000).
--
-- SECURITY INVOKER (default): called by `authenticated`, RLS on thread_classifications /
-- github_review_comments / github_pull_requests still applies under the caller's identity.

CREATE FUNCTION public.get_board_classifications_for_commenter(
  p_repo_ids uuid[],
  p_commenter_github_id bigint,
  p_start timestamptz,
  p_end timestamptz
)
RETURNS TABLE (intent text, domain text)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT tc.intent, tc.domain
  FROM public.thread_classifications tc
  JOIN public.github_review_comments grc ON grc.id = tc.thread_root_comment_id
  JOIN public.github_pull_requests gpr ON gpr.id = grc.pull_request_id
  WHERE gpr.repo_id = ANY(p_repo_ids)
    AND grc.commenter_github_id = p_commenter_github_id
    AND grc.in_reply_to_id IS NULL
    AND (p_start IS NULL OR grc.created_at >= p_start)
    AND grc.created_at <= p_end;
$$;

REVOKE ALL ON FUNCTION public.get_board_classifications_for_commenter(uuid[], bigint, timestamptz, timestamptz) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_board_classifications_for_commenter(uuid[], bigint, timestamptz, timestamptz) TO authenticated;
