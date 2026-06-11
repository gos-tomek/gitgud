-- S-07 (test-fix-gaps PR1): create_board_atomic — single-transaction board creation
--
-- Replaces the 4-step POST /api/boards sequence (createBoard, set_board_github_pat,
-- github_repos insert, addBoardContributors) with one SECURITY DEFINER function.
-- Any failure — including a 23505 unique violation on boards_owner_name_unique —
-- rolls back the entire transaction, eliminating the orphaned-board (S3/S6) and
-- silently-dropped-repos (S4) defects.

CREATE FUNCTION public.create_board_atomic(
  p_user_id        uuid,
  p_name           text,
  p_raw_token      text,
  p_encryption_key text,
  p_repos          jsonb,
  p_contributors   jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_board_id uuid;
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'permission denied: user mismatch' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.boards (name, owner_user_id)
  VALUES (trim(p_name), p_user_id)
  RETURNING id INTO v_board_id;

  -- boards_insert_owner_as_member fires here (AFTER INSERT, same transaction),
  -- so is_board_owner(v_board_id) is already satisfied for the inserts below.

  UPDATE public.boards
  SET github_pat_encrypted = pgp_sym_encrypt(p_raw_token, p_encryption_key)
  WHERE id = v_board_id;

  IF jsonb_array_length(p_repos) > 0 THEN
    INSERT INTO public.github_repos (board_id, repo_owner, repo_name, connected_by)
    SELECT v_board_id, r.owner, r.name, p_user_id
    FROM jsonb_to_recordset(p_repos) AS r(owner text, name text);
  END IF;

  IF jsonb_array_length(p_contributors) > 0 THEN
    INSERT INTO public.board_contributors (board_id, github_id, github_login, avatar_url)
    SELECT v_board_id, c.github_id, c.github_login, c.avatar_url
    FROM jsonb_to_recordset(p_contributors) AS c(github_id bigint, github_login text, avatar_url text);
  END IF;

  RETURN v_board_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_board_atomic(uuid, text, text, text, jsonb, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_board_atomic(uuid, text, text, text, jsonb, jsonb) TO authenticated;

-- set_board_github_pat is superseded — PAT encryption now happens inline within
-- create_board_atomic's transaction. Its only callers (POST /api/boards and
-- pat-leak.test.ts setup) are updated in this PR. Dropping the function also
-- drops its GRANTs.
DROP FUNCTION IF EXISTS public.set_board_github_pat(uuid, text, text);
