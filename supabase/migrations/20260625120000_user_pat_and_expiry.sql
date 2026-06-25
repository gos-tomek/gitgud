-- edit-board-connection (p2): move PAT storage from boards to user_profiles.
--
-- A PAT belongs to the GitHub identity, not to any one board — a user with multiple
-- boards currently has to re-enter the same token per board. This migration adds
-- storage on user_profiles, new encrypt/decrypt RPCs scoped to the user, and backfills
-- existing per-board PATs so no one re-enters a token they already gave us.
--
-- boards.github_pat_encrypted is left in place (expand phase); read/write paths move
-- to user_profiles in a later phase, and the column drop is a separate future migration.

ALTER TABLE public.user_profiles
  ADD COLUMN github_pat_encrypted bytea,
  ADD COLUMN token_expires_at     timestamptz;

CREATE FUNCTION public.set_user_github_pat(
  p_user_id        uuid,
  p_raw_token      text,
  p_encryption_key text,
  p_expires_at     timestamptz
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'permission denied: user mismatch' USING ERRCODE = '42501';
  END IF;

  UPDATE public.user_profiles
  SET github_pat_encrypted = pgp_sym_encrypt(p_raw_token, p_encryption_key),
      token_expires_at = p_expires_at
  WHERE user_id = p_user_id;
END;
$$;

-- Mirrors the service_role bypass in get_board_github_pat (20260619100000): the
-- classification Workflow has no user JWT, so auth.uid() is NULL and is_board_owner()
-- always fails for it even with a valid PAT.
CREATE FUNCTION public.get_user_github_pat(p_board_id uuid, p_encryption_key text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_encrypted bytea;
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_board_owner(p_board_id) THEN
    RAISE EXCEPTION 'permission denied: not the board owner';
  END IF;

  SELECT up.github_pat_encrypted INTO v_encrypted
  FROM public.boards b
  JOIN public.user_profiles up ON up.user_id = b.owner_user_id
  WHERE b.id = p_board_id;

  IF v_encrypted IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN pgp_sym_decrypt(v_encrypted, p_encryption_key);
END;
$$;

REVOKE ALL ON FUNCTION public.set_user_github_pat(uuid, text, text, timestamptz) FROM public, anon;
REVOKE ALL ON FUNCTION public.get_user_github_pat(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_user_github_pat(uuid, text, text, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_github_pat(uuid, text) TO authenticated;

-- Backfill: copy each user's most recently created board's PAT onto their profile so
-- existing users don't have to re-enter a token they already gave us. Users with no
-- boards (or boards with no PAT) get no PAT — expected, they have nothing to sync yet.
UPDATE public.user_profiles up
SET github_pat_encrypted = b.github_pat_encrypted
FROM (
  SELECT DISTINCT ON (owner_user_id) owner_user_id, github_pat_encrypted
  FROM public.boards
  WHERE github_pat_encrypted IS NOT NULL
  ORDER BY owner_user_id, created_at DESC
) b
WHERE up.user_id = b.owner_user_id AND up.github_pat_encrypted IS NULL;

-- github_repos.connected_by is unused: no read path ever selects it, no RLS policy checks
-- it, and only the board owner can insert a repo (create_board_atomic, github_repos_insert
-- policy), so it always duplicated boards.owner_user_id. Its NOT NULL REFERENCES
-- auth.users(id) with no ON DELETE action would otherwise block full account deletion
-- (Phase 4) for any user who connected a repo. Drop it instead of loosening the FK —
-- stop writing it here, then drop the column in the same migration.
CREATE OR REPLACE FUNCTION public.create_board_atomic(
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

  UPDATE public.boards
  SET github_pat_encrypted = pgp_sym_encrypt(p_raw_token, p_encryption_key)
  WHERE id = v_board_id;

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

ALTER TABLE public.github_repos DROP COLUMN connected_by;
