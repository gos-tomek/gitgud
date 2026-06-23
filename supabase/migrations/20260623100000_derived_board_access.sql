-- F-04 (p3): derive board access from boards.owner_user_id and
-- board_contributors.github_id ⟕ user_profiles.github_id, replacing the
-- board_members lookup. All 7 downstream RLS policies call is_board_member()
-- and keep working unchanged.
--
-- Must remain SECURITY DEFINER to bypass RLS on boards, board_contributors,
-- and user_profiles — otherwise the boards<->board_members recursion problem
-- (see access_control_and_membership.sql) reappears through these tables.

CREATE OR REPLACE FUNCTION public.is_board_member(p_board_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.boards
    WHERE id = p_board_id AND owner_user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1
    FROM public.board_contributors bc
    JOIN public.user_profiles up ON bc.github_id = up.github_id
    WHERE bc.board_id = p_board_id AND up.user_id = auth.uid()
  );
$$;
