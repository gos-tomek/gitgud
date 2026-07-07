-- Contract phase: drop the dead get_board_github_pat RPC and boards.github_pat_encrypted column
-- (superseded by user_profiles.github_pat_encrypted in 20260625120000).
-- Also narrows board_contributors grants from SELECT/INSERT/UPDATE/DELETE to SELECT/INSERT only
-- (table is append-only; UPDATE/DELETE will be re-granted when contributor management ships).

-- 1. Drop the dead RPC (signature from 20260619100000_service_role_pat_access.sql)
DROP FUNCTION IF EXISTS public.get_board_github_pat(uuid, text);

-- 2. Drop the dead column (added in 20260531100000, zeroed out since 20260625120000)
ALTER TABLE public.boards DROP COLUMN IF EXISTS github_pat_encrypted;

-- 3. Narrow board_contributors grants to append-only (SELECT + INSERT)
REVOKE ALL ON public.board_contributors FROM authenticated;
GRANT SELECT, INSERT ON public.board_contributors TO authenticated;
