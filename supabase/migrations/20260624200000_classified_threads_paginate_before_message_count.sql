-- profile-classified-comments (impl review F6 follow-up): get_board_classified_threads computed
-- message_count and count(*) OVER() in the same target list as the rest of the row, with an
-- ORDER BY + LIMIT/OFFSET on top. EXPLAIN confirmed Postgres evaluates that target list (including
-- the per-row message_count subquery) for every row that matches the WHERE filter, *before*
-- LIMIT trims the result — the window function forces full materialization, and the planner
-- doesn't defer the subquery past the Sort node. At current data volumes (tens of threads) this
-- is invisible; at the thousands of threads a long-lived board accumulates, it turns every page
-- load into an O(total matching threads) scan instead of O(page size).
--
-- Fix: paginate in a CTE first (sort + limit/offset on cheap columns only), then compute
-- message_count only for the resulting page. total_count moves to its own RPC — the same split
-- already used for get_board_thread_coverage — so counting never pays the per-row cost either.

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
  message_count bigint
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH page AS (
    SELECT
      tc.thread_root_comment_id,
      tc.pull_request_id,
      gpr.number AS pr_number,
      gpr.title AS pr_title,
      gpr.author_login AS pr_author_login,
      gpr.repo_id,
      grc.body,
      tc.intent,
      tc.domain,
      grc.commenter_login,
      tc.classified_at,
      grc.created_at
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
            OR gpr.author_github_id = p_github_id
            OR EXISTS (
              SELECT 1
              FROM public.github_review_comments reply
              WHERE reply.in_reply_to_id = grc.id
                AND reply.commenter_github_id = p_github_id
            )
          )
        )
      )
    ORDER BY grc.created_at DESC
    LIMIT p_limit OFFSET p_offset
  )
  SELECT
    page.thread_root_comment_id,
    page.pull_request_id,
    page.pr_number,
    page.pr_title,
    page.pr_author_login,
    page.repo_id,
    substring(page.body for 200),
    page.intent,
    page.domain,
    page.commenter_login,
    page.classified_at,
    page.created_at,
    (
      SELECT count(*)
      FROM public.github_review_comments r2
      WHERE r2.id = page.thread_root_comment_id OR r2.in_reply_to_id = page.thread_root_comment_id
    ) AS message_count
  FROM page
  ORDER BY page.created_at DESC;
$$;

CREATE FUNCTION public.get_board_classified_threads_count(
  p_repo_ids uuid[],
  p_github_id bigint,
  p_role text,
  p_start timestamptz,
  p_end timestamptz,
  p_intent text,
  p_domain text,
  p_pr_id bigint
)
RETURNS bigint
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT count(*)
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
          OR gpr.author_github_id = p_github_id
          OR EXISTS (
            SELECT 1
            FROM public.github_review_comments reply
            WHERE reply.in_reply_to_id = grc.id
              AND reply.commenter_github_id = p_github_id
          )
        )
      )
    );
$$;

REVOKE ALL ON FUNCTION public.get_board_classified_threads(
  uuid[], bigint, text, timestamptz, timestamptz, text, text, bigint, int, int
) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_board_classified_threads(
  uuid[], bigint, text, timestamptz, timestamptz, text, text, bigint, int, int
) TO authenticated;

REVOKE ALL ON FUNCTION public.get_board_classified_threads_count(
  uuid[], bigint, text, timestamptz, timestamptz, text, text, bigint
) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_board_classified_threads_count(
  uuid[], bigint, text, timestamptz, timestamptz, text, text, bigint
) TO authenticated;
