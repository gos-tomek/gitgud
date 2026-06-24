-- profile-classified-comments: the "What kind of feedback" classification section on Impact was
-- counting self-review comments (root comments the contributor left on their own PR) as
-- "threads started", inflating the total (e.g. 52 instead of 24 for a contributor with 28
-- self-review threads — started(24) + self(28) = 52). Align with ThreadQualitySection's
-- threadsStarted KPI (which scopes to reviewedPrIds, excluding own PRs) and the Threads page's
-- "started" role bucket, both of which already exclude self-authored-PR comments.

CREATE OR REPLACE FUNCTION public.get_board_classifications_for_commenter(
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
    AND gpr.author_github_id != p_commenter_github_id
    AND grc.in_reply_to_id IS NULL
    AND (p_start IS NULL OR grc.created_at >= p_start)
    AND grc.created_at <= p_end;
$$;

-- Dedicated "started-only" root-comment count for the classification coverage denominator.
-- Not reusing get_board_root_comments_for_commenter: that RPC has two other callers (the impact
-- summary KPI and activity data) which intentionally count self-review comments too, so its
-- behaviour must not change here.
CREATE FUNCTION public.get_board_started_root_comments_for_commenter(
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
    AND gpr.author_github_id != p_commenter_github_id
    AND grc.in_reply_to_id IS NULL
    AND (p_start IS NULL OR grc.created_at >= p_start)
    AND grc.created_at <= p_end;
$$;

REVOKE ALL ON FUNCTION public.get_board_started_root_comments_for_commenter(uuid[], bigint, timestamptz, timestamptz) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_board_started_root_comments_for_commenter(uuid[], bigint, timestamptz, timestamptz) TO authenticated;
