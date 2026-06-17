-- F1 (impl-review): replace unbounded .in("pull_request_id", boardPrIds) filters in
-- impact-metrics.ts with RPCs that join on repo_id server-side. The previous pattern
-- fetched every PR id for a board and passed it back as a PostgREST .in() filter —
-- PostgREST encodes .in() as URL query params, so boards with ~200+ PRs risk exceeding
-- proxy/Cloudflare URL length limits (414s or silent failures).
--
-- These are plain SQL functions (SECURITY INVOKER, the default) so RLS on
-- github_reviews / github_review_comments / github_pull_requests still applies under
-- the caller's identity — board membership enforcement is unchanged.

CREATE FUNCTION public.get_board_reviews_for_reviewer(
  p_repo_ids uuid[],
  p_reviewer_github_id bigint,
  p_start timestamptz,
  p_end timestamptz
)
RETURNS TABLE (id bigint, pull_request_id bigint, state text, submitted_at timestamptz)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT gr.id, gr.pull_request_id, gr.state, gr.submitted_at
  FROM public.github_reviews gr
  JOIN public.github_pull_requests gpr ON gpr.id = gr.pull_request_id
  WHERE gpr.repo_id = ANY(p_repo_ids)
    AND gr.reviewer_github_id = p_reviewer_github_id
    AND (p_start IS NULL OR gr.submitted_at >= p_start)
    AND gr.submitted_at <= p_end;
$$;

CREATE FUNCTION public.get_board_root_comments_for_commenter(
  p_repo_ids uuid[],
  p_commenter_github_id bigint,
  p_start timestamptz,
  p_end timestamptz
)
RETURNS TABLE (id bigint, pull_request_id bigint, created_at timestamptz)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT grc.id, grc.pull_request_id, grc.created_at
  FROM public.github_review_comments grc
  JOIN public.github_pull_requests gpr ON gpr.id = grc.pull_request_id
  WHERE gpr.repo_id = ANY(p_repo_ids)
    AND grc.commenter_github_id = p_commenter_github_id
    AND grc.in_reply_to_id IS NULL
    AND (p_start IS NULL OR grc.created_at >= p_start)
    AND grc.created_at <= p_end;
$$;

REVOKE ALL ON FUNCTION public.get_board_reviews_for_reviewer(uuid[], bigint, timestamptz, timestamptz) FROM public, anon;
REVOKE ALL ON FUNCTION public.get_board_root_comments_for_commenter(uuid[], bigint, timestamptz, timestamptz) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_board_reviews_for_reviewer(uuid[], bigint, timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_board_root_comments_for_commenter(uuid[], bigint, timestamptz, timestamptz) TO authenticated;
