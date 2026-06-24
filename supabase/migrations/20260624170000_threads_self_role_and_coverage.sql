-- profile-classified-comments: add a "self" role bucket so the Threads page can filter to
-- threads the contributor opened on their own PR (previously only visible lumped into "all"),
-- and a coverage RPC so the Threads page can show "N of M threads classified" the same way
-- the Impact page's classification section does, scoped to the active role filter.
--
-- Also add a "joined" role bucket: threads on someone else's PR, started by someone else, where
-- the contributor left a reply (not the root comment) — a third reviewer jumping into another
-- reviewer's thread. Deliberately excludes the contributor's own PRs: a PR author replying to
-- comments on their own PR is just normal "received" engagement, not joining a stranger's
-- thread, so "joined" and "received" stay disjoint instead of one swamping the other.

CREATE OR REPLACE FUNCTION public.get_board_classified_threads(
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
      (p_role = 'started' AND grc.commenter_github_id = p_github_id AND gpr.author_github_id != p_github_id)
      OR (p_role = 'received' AND gpr.author_github_id = p_github_id AND grc.commenter_github_id != p_github_id)
      OR (p_role = 'self' AND grc.commenter_github_id = p_github_id AND gpr.author_github_id = p_github_id)
      OR (
        p_role = 'joined'
        AND grc.commenter_github_id != p_github_id
        AND gpr.author_github_id != p_github_id
        AND EXISTS (
          SELECT 1
          FROM public.github_review_comments reply
          WHERE reply.in_reply_to_id = grc.id
            AND reply.commenter_github_id = p_github_id
        )
      )
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

CREATE FUNCTION public.get_board_thread_coverage(
  p_repo_ids uuid[],
  p_github_id bigint,
  p_role text,
  p_start timestamptz,
  p_end timestamptz
)
RETURNS TABLE (total_root_comments bigint)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT count(*)
  FROM public.github_review_comments grc
  JOIN public.github_pull_requests gpr ON gpr.id = grc.pull_request_id
  WHERE gpr.repo_id = ANY(p_repo_ids)
    AND grc.in_reply_to_id IS NULL
    AND (p_start IS NULL OR grc.created_at >= p_start)
    AND grc.created_at <= p_end
    AND (
      (p_role = 'started' AND grc.commenter_github_id = p_github_id AND gpr.author_github_id != p_github_id)
      OR (p_role = 'received' AND gpr.author_github_id = p_github_id AND grc.commenter_github_id != p_github_id)
      OR (p_role = 'self' AND grc.commenter_github_id = p_github_id AND gpr.author_github_id = p_github_id)
      OR (
        p_role = 'joined'
        AND grc.commenter_github_id != p_github_id
        AND gpr.author_github_id != p_github_id
        AND EXISTS (
          SELECT 1
          FROM public.github_review_comments reply
          WHERE reply.in_reply_to_id = grc.id
            AND reply.commenter_github_id = p_github_id
        )
      )
      OR (
        p_role = 'all'
        AND (
          grc.commenter_github_id = p_github_id
          OR (gpr.author_github_id = p_github_id AND grc.commenter_github_id != p_github_id)
        )
      )
    );
$$;

REVOKE ALL ON FUNCTION public.get_board_thread_coverage(uuid[], bigint, text, timestamptz, timestamptz) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_board_thread_coverage(uuid[], bigint, text, timestamptz, timestamptz) TO authenticated;
