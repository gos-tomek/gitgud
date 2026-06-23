-- Phase 5 (link-github-account): drop board_members — cleanup
--
-- board_members is superseded by derived access (is_board_member() now checks
-- boards.owner_user_id and board_contributors.github_id ⟕ user_profiles.github_id,
-- see 20260623100000_derived_board_access.sql). Nothing reads or writes this
-- table anymore — drop it, its auto-enrollment trigger, and its policies.

-- Drop trigger first (depends on function and table)
DROP TRIGGER IF EXISTS boards_insert_owner_as_member ON public.boards;
DROP FUNCTION IF EXISTS public.add_owner_as_board_member();

-- Drop policies (depend on table)
DROP POLICY IF EXISTS board_members_select ON public.board_members;
DROP POLICY IF EXISTS board_members_insert ON public.board_members;
DROP POLICY IF EXISTS board_members_delete ON public.board_members;

-- Drop the table
DROP TABLE IF EXISTS public.board_members;

-- board_contributors.user_id is unused — linking is now via
-- github_id ⟕ user_profiles, not a direct FK to auth.users.
ALTER TABLE public.board_contributors DROP COLUMN IF EXISTS user_id;
