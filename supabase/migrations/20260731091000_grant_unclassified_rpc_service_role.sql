-- Same gap as 20260731090000_grant_get_user_github_pat_service_role.sql: the classify phase
-- (src/worker.ts runClassify) calls get_unclassified_root_comments_for_board via the
-- service-role client, but the function has only ever been granted to `authenticated`
-- (20260619090000_unclassified_threads_rpc.sql, re-affirmed by 20260704200000's
-- DROP+CREATE). service_role is not a member of authenticated, so every classify dispatch
-- fails with a Postgres permission-denied error, silently stopping thread classification.
GRANT EXECUTE ON FUNCTION public.get_unclassified_root_comments_for_board(uuid) TO service_role;
