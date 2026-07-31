-- Same gap as the previous two grant migrations in this change: batch_update_pr_sizes's own
-- migration comment says "Only the service role (Workflow) calls this — revoke from all
-- lower-privilege roles" but only ever REVOKEs, never actually GRANTs EXECUTE to service_role.
-- src/lib/services/github-sync.ts calls it via the service-role client (worker.ts sync-repo
-- phase), so every sync run has been silently failing this update (caught and logged as a
-- warning, not fatal — PR size columns just never populate).
GRANT EXECUTE ON FUNCTION public.batch_update_pr_sizes(jsonb) TO service_role;
