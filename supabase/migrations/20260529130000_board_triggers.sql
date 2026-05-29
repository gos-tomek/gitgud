-- Post-F-01 triggers: updated_at maintenance + owner auto-membership enforcement

-- Keep boards.updated_at accurate whenever a row is updated.

CREATE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_updated_at() FROM public, anon;

CREATE TRIGGER boards_set_updated_at
  BEFORE UPDATE ON public.boards
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- Guarantee the owner is always in board_members so boards_select (which uses
-- is_board_member) can see the owner's own board. Without this, any createBoard
-- call that forgets the manual board_members INSERT silently breaks visibility.
-- SECURITY DEFINER is required because auth.uid() has no JWT context inside a trigger.

CREATE FUNCTION public.add_owner_as_board_member()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.board_members (board_id, user_id)
  VALUES (NEW.id, NEW.owner_user_id)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.add_owner_as_board_member() FROM public, anon;

CREATE TRIGGER boards_insert_owner_as_member
  AFTER INSERT ON public.boards
  FOR EACH ROW
  EXECUTE FUNCTION public.add_owner_as_board_member();
