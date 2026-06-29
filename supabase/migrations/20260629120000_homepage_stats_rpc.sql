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
