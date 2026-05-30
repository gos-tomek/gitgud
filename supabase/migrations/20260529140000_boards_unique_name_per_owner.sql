-- S-01: unique board name per owner (case/whitespace-insensitive)
-- Additive index — expand/contract safe, no DROP or ALTER.

CREATE UNIQUE INDEX boards_owner_name_unique
  ON public.boards (owner_user_id, lower(trim(name)));

-- Owner-fallback SELECT policy so INSERT...RETURNING can read back the new row
-- before the AFTER INSERT trigger membership row is visible to the existing
-- boards_select policy (which requires is_board_member).
-- OR-combines with boards_select; does not loosen access for non-owners.
CREATE POLICY boards_select_owner ON public.boards
  FOR SELECT TO authenticated
  USING (owner_user_id = auth.uid());
