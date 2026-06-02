-- S-03: board_contributors table
-- Stores GitHub identities selected by the EM during board creation.
-- Follows the github_id (bigint) + login (text) pattern used in github_pull_requests etc.
-- Nullable user_id reserved for future F-04 account linking.

CREATE TABLE public.board_contributors (
  board_id     uuid NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  github_id    bigint NOT NULL,
  github_login text NOT NULL,
  avatar_url   text,
  user_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  added_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (board_id, github_id)
);

CREATE INDEX board_contributors_user_id_idx ON public.board_contributors (user_id);

ALTER TABLE public.board_contributors ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.board_contributors FROM anon;

CREATE POLICY board_contributors_select ON public.board_contributors
  FOR SELECT TO authenticated
  USING (public.is_board_member(board_id));

CREATE POLICY board_contributors_insert ON public.board_contributors
  FOR INSERT TO authenticated
  WITH CHECK (public.is_board_owner(board_id));

CREATE POLICY board_contributors_delete ON public.board_contributors
  FOR DELETE TO authenticated
  USING (public.is_board_owner(board_id));
