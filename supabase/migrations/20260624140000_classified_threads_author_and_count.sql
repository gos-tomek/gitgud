-- profile-classified-comments: surface PR author and thread message count on the Threads page,
-- so a contributor can see who owns the PR and how big the discussion is without expanding it.

CREATE INDEX IF NOT EXISTS github_review_comments_in_reply_to_id_idx
  ON public.github_review_comments (in_reply_to_id);

DROP FUNCTION public.get_board_classified_threads(
  uuid[], bigint, text, timestamptz, timestamptz, text, text, bigint, int, int
);

CREATE FUNCTION public.get_board_classified_threads(
  p_repo_ids uuid[],
  p_github_id bigint,
  p_role text,
  p_start timestamptz,
  p_end timestamptz,
  p_intent text,
  p_domain text,
  p_pr_id bigint,
  p_limit int,
  p_offset int
)
RETURNS TABLE (
  thread_root_comment_id bigint,
  pull_request_id bigint,
  pr_number int,
  pr_title text,
  pr_author_login text,
  repo_id uuid,
  comment_snippet text,
  intent text,
  domain text,
  commenter_login text,
  classified_at timestamptz,
  created_at timestamptz,
  message_count bigint,
  total_count bigint
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    tc.thread_root_comment_id,
    tc.pull_request_id,
    gpr.number,
    gpr.title,
    gpr.author_login,
    gpr.repo_id,
    substring(grc.body for 200),
    tc.intent,
    tc.domain,
    grc.commenter_login,
    tc.classified_at,
    grc.created_at,
    (
      SELECT count(*)
      FROM public.github_review_comments r2
      WHERE r2.id = tc.thread_root_comment_id OR r2.in_reply_to_id = tc.thread_root_comment_id
    ) AS message_count,
    count(*) OVER() AS total_count
  FROM public.thread_classifications tc
  JOIN public.github_review_comments grc ON grc.id = tc.thread_root_comment_id
  JOIN public.github_pull_requests gpr ON gpr.id = tc.pull_request_id
  WHERE gpr.repo_id = ANY(p_repo_ids)
    AND (p_start IS NULL OR grc.created_at >= p_start)
    AND grc.created_at <= p_end
    AND (p_intent IS NULL OR tc.intent = p_intent)
    AND (p_domain IS NULL OR tc.domain = p_domain)
    AND (p_pr_id IS NULL OR tc.pull_request_id = p_pr_id)
    AND (
      (p_role = 'started' AND grc.commenter_github_id = p_github_id)
      OR (p_role = 'received' AND gpr.author_github_id = p_github_id AND grc.commenter_github_id != p_github_id)
      OR (
        p_role = 'all'
        AND (
          grc.commenter_github_id = p_github_id
          OR (gpr.author_github_id = p_github_id AND grc.commenter_github_id != p_github_id)
        )
      )
    )
  ORDER BY grc.created_at DESC
  LIMIT p_limit OFFSET p_offset;
$$;

REVOKE ALL ON FUNCTION public.get_board_classified_threads(
  uuid[], bigint, text, timestamptz, timestamptz, text, text, bigint, int, int
) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_board_classified_threads(
  uuid[], bigint, text, timestamptz, timestamptz, text, text, bigint, int, int
) TO authenticated;
