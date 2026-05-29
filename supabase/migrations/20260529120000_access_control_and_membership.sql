-- F-01: boards + board_members schema with RLS

-- Tables

CREATE TABLE public.boards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.board_members (
  board_id uuid NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (board_id, user_id)
);

CREATE INDEX board_members_user_id_idx ON public.board_members (user_id);

-- Enable RLS

ALTER TABLE public.boards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.board_members ENABLE ROW LEVEL SECURITY;

-- Revoke anon access

REVOKE ALL ON public.boards FROM anon;
REVOKE ALL ON public.board_members FROM anon;

-- SECURITY DEFINER helpers to break the boards<->board_members RLS recursion cycle.
-- Without these, a SELECT on boards would subquery board_members (to check membership),
-- whose policy would subquery boards (to check ownership), causing infinite recursion.
-- By running as their owner they bypass RLS on the tables they read.

CREATE FUNCTION public.is_board_member(p_board_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.board_members
    WHERE board_id = p_board_id AND user_id = auth.uid()
  );
$$;

CREATE FUNCTION public.is_board_owner(p_board_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.boards
    WHERE id = p_board_id AND owner_user_id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public.is_board_member(uuid), public.is_board_owner(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.is_board_member(uuid), public.is_board_owner(uuid) TO authenticated;

-- RLS Policies: boards

CREATE POLICY boards_select ON public.boards
  FOR SELECT TO authenticated
  USING (public.is_board_member(id));

CREATE POLICY boards_insert ON public.boards
  FOR INSERT TO authenticated
  WITH CHECK (owner_user_id = auth.uid());

CREATE POLICY boards_update ON public.boards
  FOR UPDATE TO authenticated
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

CREATE POLICY boards_delete ON public.boards
  FOR DELETE TO authenticated
  USING (owner_user_id = auth.uid());

-- RLS Policies: board_members

CREATE POLICY board_members_select ON public.board_members
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_board_owner(board_id));

CREATE POLICY board_members_insert ON public.board_members
  FOR INSERT TO authenticated
  WITH CHECK (public.is_board_owner(board_id));

-- No UPDATE policy: membership rows are immutable after insert.

CREATE POLICY board_members_delete ON public.board_members
  FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.is_board_owner(board_id));
