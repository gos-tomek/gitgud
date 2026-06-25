-- edit-board-connection (p3): create_board_atomic reads the PAT from user_profiles instead of
-- accepting one. By this point the wizard always saves the PAT via set_user_github_pat (either
-- the user's previously stored token, or a freshly-entered one saved through POST
-- /api/profile/pat) before board creation begins — so the RPC only needs to verify one exists.
--
-- The new signature has a different arity than the old one, so CREATE OR REPLACE can't reuse
-- it (Postgres treats different argument lists as different overloads) — the old overload is
-- dropped explicitly first.
DROP FUNCTION IF EXISTS public.create_board_atomic(uuid, text, text, text, jsonb, jsonb);

CREATE FUNCTION public.create_board_atomic(
  p_user_id      uuid,
  p_name         text,
  p_repos        jsonb,
  p_contributors jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_board_id uuid;
  v_has_pat  boolean;
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'permission denied: user mismatch' USING ERRCODE = '42501';
  END IF;

  SELECT github_pat_encrypted IS NOT NULL INTO v_has_pat
  FROM public.user_profiles
  WHERE user_id = p_user_id;

  IF NOT COALESCE(v_has_pat, false) THEN
    RAISE EXCEPTION 'No GitHub token configured — save one in Profile Settings first';
  END IF;

  INSERT INTO public.boards (name, owner_user_id)
  VALUES (trim(p_name), p_user_id)
  RETURNING id INTO v_board_id;

  IF jsonb_array_length(p_repos) > 0 THEN
    INSERT INTO public.github_repos (board_id, repo_owner, repo_name)
    SELECT v_board_id, r.owner, r.name
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

REVOKE ALL ON FUNCTION public.create_board_atomic(uuid, text, jsonb, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_board_atomic(uuid, text, jsonb, jsonb) TO authenticated;

-- The board-creation wizard fetches repos/collaborators (and validates manually-entered repos)
-- before any board exists, so get_user_github_pat (which joins through boards.owner_user_id)
-- can't be used yet. This variant decrypts straight off the caller's own user_profiles row.
CREATE FUNCTION public.get_user_github_pat_by_user_id(p_user_id uuid, p_encryption_key text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_encrypted bytea;
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'permission denied: user mismatch' USING ERRCODE = '42501';
  END IF;

  SELECT github_pat_encrypted INTO v_encrypted FROM public.user_profiles WHERE user_id = p_user_id;

  IF v_encrypted IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN pgp_sym_decrypt(v_encrypted, p_encryption_key);
END;
$$;

REVOKE ALL ON FUNCTION public.get_user_github_pat_by_user_id(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_user_github_pat_by_user_id(uuid, text) TO authenticated;
