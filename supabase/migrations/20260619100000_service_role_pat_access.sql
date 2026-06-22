-- F-03: Classification batch Workflow — allow service_role to decrypt the board's GitHub PAT.
--
-- get_board_github_pat (20260531100000) raises 'permission denied: not the board owner' for any
-- caller where is_board_owner() is false. is_board_owner() checks owner_user_id = auth.uid(),
-- which is NULL for the Workflow's service_role client (no user JWT session) — so the check
-- always failed for the Workflow, even with a correct encryption key and a valid PAT.
--
-- service_role already bypasses RLS and has unrestricted SELECT on boards.github_pat_encrypted,
-- so this check never protected anything against it — only against `authenticated` callers
-- trying to read another board's PAT through this RPC. Recognize service_role explicitly by
-- name (not by excluding 'authenticated') so the bypass cannot silently widen if EXECUTE is
-- ever granted to another role later — anon and any other role still fall through to the
-- ownership check, which they can never satisfy (auth.uid() is NULL for them too).

CREATE OR REPLACE FUNCTION public.get_board_github_pat(p_board_id uuid, p_encryption_key text)
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
  SELECT github_pat_encrypted INTO v_encrypted FROM public.boards WHERE id = p_board_id;
  IF v_encrypted IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN pgp_sym_decrypt(v_encrypted, p_encryption_key);
END;
$$;
