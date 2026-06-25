-- edit-board-connection (p4 follow-up): persist the validated PAT owner's GitHub login
-- separately from user_profiles.github_login (the OAuth identity captured at signup).
--
-- A saved PAT can belong to a different GitHub account than the one a user signed up
-- with (e.g. a bot/service token) — the profile page and CreateBoardForm were both
-- reading github_login to render "Connected as @X" for the *token*, misattributing
-- whichever account happened to be the OAuth identity. Store the PAT's own login at
-- save time and read that instead.
ALTER TABLE public.user_profiles
  ADD COLUMN github_pat_login text;

-- The new signature has a different arity than the old one, so CREATE OR REPLACE can't
-- reuse it — the old overload is dropped explicitly first.
DROP FUNCTION IF EXISTS public.set_user_github_pat(uuid, text, text, timestamptz);

CREATE FUNCTION public.set_user_github_pat(
  p_user_id        uuid,
  p_raw_token      text,
  p_encryption_key text,
  p_expires_at     timestamptz,
  p_github_login   text
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
      token_expires_at = p_expires_at,
      github_pat_login = p_github_login
  WHERE user_id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_user_github_pat(uuid, text, text, timestamptz, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_user_github_pat(uuid, text, text, timestamptz, text) TO authenticated;

-- Existing PATs backfilled in Phase 2 (copied from boards.github_pat_encrypted) have no
-- known owner login — left NULL rather than guessed from user_profiles.github_login,
-- since that's exactly the misattribution this migration fixes. The UI treats a NULL
-- github_pat_login as "token configured, identity unconfirmed" instead of asserting one.
