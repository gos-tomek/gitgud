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

-- Exclude vote = false threads from the coverage denominator (total threads count).
-- Uses LEFT JOIN so unclassified threads (no tc row) are still counted as pending.
CREATE OR REPLACE FUNCTION public.get_board_started_root_comments_for_commenter(
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
  LEFT JOIN public.thread_classifications tc ON tc.thread_root_comment_id = grc.id
  WHERE gpr.repo_id = ANY(p_repo_ids)
    AND grc.commenter_github_id = p_commenter_github_id
    AND gpr.author_github_id != p_commenter_github_id
    AND grc.in_reply_to_id IS NULL
    AND (p_start IS NULL OR grc.created_at >= p_start)
    AND grc.created_at <= p_end
    AND (tc.vote IS DISTINCT FROM false);
$$;

-- Exclude vote = false threads from contributor-level metrics
-- (intent counts, domain counts, high-signal %).
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
    AND grc.created_at <= p_end
    AND (tc.vote IS DISTINCT FROM false);
$$;

-- Exclude vote = false threads from platform-wide homepage stats.
CREATE OR REPLACE FUNCTION get_homepage_stats()
RETURNS TABLE (
  boards          bigint,
  contributors    bigint,
  repos           bigint,
  prs_tracked     bigint,
  threads_classified bigint,
  deep_discussions   bigint,
  multi_person_threads bigint,
  high_impact_percent  integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH classified AS (
    SELECT thread_root_comment_id, intent
    FROM thread_classifications
    WHERE vote IS DISTINCT FROM false
  ),
  -- Root commenter + all reply commenters per classified thread (root must exist)
  thread_all_participants AS (
    SELECT c.thread_root_comment_id, rc.commenter_login
    FROM classified c
    JOIN github_review_comments rc ON rc.id = c.thread_root_comment_id
    UNION ALL
    SELECT c.thread_root_comment_id, rc.commenter_login
    FROM classified c
    JOIN github_review_comments rc ON rc.in_reply_to_id = c.thread_root_comment_id
  ),
  thread_stats AS (
    SELECT
      thread_root_comment_id,
      COUNT(DISTINCT commenter_login) AS unique_participants
    FROM thread_all_participants
    GROUP BY thread_root_comment_id
  ),
  reply_counts AS (
    SELECT in_reply_to_id AS root_id, COUNT(*) AS cnt
    FROM github_review_comments
    WHERE in_reply_to_id IN (SELECT thread_root_comment_id FROM classified)
    GROUP BY in_reply_to_id
  )
  SELECT
    (SELECT COUNT(*) FROM boards)::bigint                                   AS boards,
    (SELECT COUNT(DISTINCT github_login) FROM board_contributors)::bigint   AS contributors,
    (SELECT COUNT(*) FROM github_repos)::bigint                             AS repos,
    (SELECT COUNT(*) FROM github_pull_requests)::bigint                     AS prs_tracked,
    (SELECT COUNT(*) FROM classified)::bigint                               AS threads_classified,
    -- deep: root exists (enforced by thread_stats JOIN) and total comments >= 3
    (
      SELECT COUNT(*)::bigint
      FROM reply_counts rc
      WHERE 1 + rc.cnt >= 3
        AND rc.root_id IN (SELECT thread_root_comment_id FROM thread_stats)
    )                                                                       AS deep_discussions,
    (SELECT COUNT(*)::bigint FROM thread_stats WHERE unique_participants >= 2) AS multi_person_threads,
    (
      SELECT COALESCE(
        ROUND(
          COUNT(*) FILTER (WHERE intent IN ('architecture', 'bug-catch', 'mentoring', 'unblocking')) * 100.0
          / NULLIF(COUNT(*), 0)
        )::integer,
        0
      )
      FROM classified
    )                                                                       AS high_impact_percent;
$$;

GRANT EXECUTE ON FUNCTION get_homepage_stats() TO service_role;
