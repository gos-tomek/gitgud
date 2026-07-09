-- flag-classification-inaccurate: add vote column to thread_classifications and
-- create a SECURITY DEFINER voting function accessible to any board member.

ALTER TABLE public.thread_classifications
  ADD COLUMN vote boolean DEFAULT NULL;

CREATE FUNCTION public.set_thread_classification_vote(
  p_thread_root_comment_id bigint,
  p_vote boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pull_request_id bigint;
  v_board_id uuid;
BEGIN
  SELECT pull_request_id
  INTO v_pull_request_id
  FROM public.thread_classifications
  WHERE thread_root_comment_id = p_thread_root_comment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'thread classification not found: %', p_thread_root_comment_id;
  END IF;

  v_board_id := public.get_board_id_for_pr(v_pull_request_id);

  IF NOT public.is_board_member(v_board_id) THEN
    RAISE EXCEPTION 'permission denied: not a board member';
  END IF;

  UPDATE public.thread_classifications
  SET vote = p_vote
  WHERE thread_root_comment_id = p_thread_root_comment_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_thread_classification_vote(bigint, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_thread_classification_vote(bigint, boolean) TO authenticated;

-- Replace get_board_classified_threads to add p_vote filter param and vote column in return.
-- Must use DROP + CREATE (not CREATE OR REPLACE) because adding a parameter creates a new
-- overload and callers get "function is not unique" errors.
DROP FUNCTION IF EXISTS public.get_board_classified_threads(
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
  p_offset int,
  p_vote text DEFAULT NULL
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
  vote boolean
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
      grc.created_at,
      tc.vote
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
        p_vote IS NULL OR p_vote = 'all'
        OR (p_vote = 'confirmed' AND tc.vote = true)
        OR (p_vote = 'excluded' AND tc.vote = false)
        OR (p_vote = 'unconfirmed' AND tc.vote IS NULL)
      )
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
    ) AS message_count,
    page.vote
  FROM page
  ORDER BY page.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_board_classified_threads(
  uuid[], bigint, text, timestamptz, timestamptz, text, text, bigint, int, int, text
) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_board_classified_threads(
  uuid[], bigint, text, timestamptz, timestamptz, text, text, bigint, int, int, text
) TO authenticated;

-- Replace get_board_classified_threads_count to add p_vote filter param.
DROP FUNCTION IF EXISTS public.get_board_classified_threads_count(
  uuid[], bigint, text, timestamptz, timestamptz, text, text, bigint
);

CREATE FUNCTION public.get_board_classified_threads_count(
  p_repo_ids uuid[],
  p_github_id bigint,
  p_role text,
  p_start timestamptz,
  p_end timestamptz,
  p_intent text,
  p_domain text,
  p_pr_id bigint,
  p_vote text DEFAULT NULL
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
      p_vote IS NULL OR p_vote = 'all'
      OR (p_vote = 'confirmed' AND tc.vote = true)
      OR (p_vote = 'excluded' AND tc.vote = false)
      OR (p_vote = 'unconfirmed' AND tc.vote IS NULL)
    )
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

REVOKE ALL ON FUNCTION public.get_board_classified_threads_count(
  uuid[], bigint, text, timestamptz, timestamptz, text, text, bigint, text
) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_board_classified_threads_count(
  uuid[], bigint, text, timestamptz, timestamptz, text, text, bigint, text
) TO authenticated;
