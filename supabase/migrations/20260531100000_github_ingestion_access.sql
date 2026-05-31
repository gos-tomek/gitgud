-- F-02: GitHub ingestion access — schema, token infrastructure, and RLS

-- Encrypted PAT column on boards

ALTER TABLE public.boards
  ADD COLUMN github_pat_encrypted bytea;

-- github_repos: links specific repositories to a board

CREATE TABLE public.github_repos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id uuid NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  repo_owner text NOT NULL,
  repo_name text NOT NULL,
  connected_at timestamptz NOT NULL DEFAULT now(),
  connected_by uuid NOT NULL REFERENCES auth.users(id),
  UNIQUE (board_id, repo_owner, repo_name)
);

CREATE INDEX github_repos_board_id_idx ON public.github_repos (board_id);

-- github_pull_requests: fetched PR data

CREATE TABLE public.github_pull_requests (
  id bigint PRIMARY KEY,
  repo_id uuid NOT NULL REFERENCES public.github_repos(id) ON DELETE CASCADE,
  number int NOT NULL,
  title text NOT NULL,
  state text NOT NULL,
  author_login text NOT NULL,
  author_github_id bigint NOT NULL,
  is_draft boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  merged_at timestamptz,
  fetched_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX github_pull_requests_repo_id_idx ON public.github_pull_requests (repo_id);

-- github_reviews: fetched review data

CREATE TABLE public.github_reviews (
  id bigint PRIMARY KEY,
  pull_request_id bigint NOT NULL REFERENCES public.github_pull_requests(id) ON DELETE CASCADE,
  reviewer_login text NOT NULL,
  reviewer_github_id bigint NOT NULL,
  state text NOT NULL,
  submitted_at timestamptz NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX github_reviews_pull_request_id_idx ON public.github_reviews (pull_request_id);

-- github_review_comments: fetched review comment data

CREATE TABLE public.github_review_comments (
  id bigint PRIMARY KEY,
  pull_request_id bigint NOT NULL REFERENCES public.github_pull_requests(id) ON DELETE CASCADE,
  review_id bigint REFERENCES public.github_reviews(id) ON DELETE SET NULL,
  commenter_login text NOT NULL,
  commenter_github_id bigint NOT NULL,
  body text NOT NULL,
  path text,
  position_line int,
  position_side text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX github_review_comments_pull_request_id_idx ON public.github_review_comments (pull_request_id);
CREATE INDEX github_review_comments_review_id_idx ON public.github_review_comments (review_id);

-- Enable RLS on all new tables

ALTER TABLE public.github_repos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.github_pull_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.github_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.github_review_comments ENABLE ROW LEVEL SECURITY;

-- Revoke anon access

REVOKE ALL ON public.github_repos FROM anon;
REVOKE ALL ON public.github_pull_requests FROM anon;
REVOKE ALL ON public.github_reviews FROM anon;
REVOKE ALL ON public.github_review_comments FROM anon;

-- SECURITY DEFINER helper: resolves board_id from a PR id, bypassing RLS on intermediate tables.
-- Used by RLS policies on github_reviews and github_review_comments to avoid inline subqueries.

CREATE FUNCTION public.get_board_id_for_pr(p_pr_id bigint)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT gr.board_id
  FROM public.github_pull_requests gpr
  JOIN public.github_repos gr ON gr.id = gpr.repo_id
  WHERE gpr.id = p_pr_id;
$$;

REVOKE ALL ON FUNCTION public.get_board_id_for_pr(bigint) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_board_id_for_pr(bigint) TO authenticated;

-- SECURITY DEFINER functions for PAT encryption/decryption using pgcrypto.
-- The encryption key is passed from the application layer — never stored in the DB.

CREATE FUNCTION public.set_board_github_pat(p_board_id uuid, p_raw_token text, p_encryption_key text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT public.is_board_owner(p_board_id) THEN
    RAISE EXCEPTION 'permission denied: not the board owner';
  END IF;
  UPDATE public.boards
  SET github_pat_encrypted = pgp_sym_encrypt(p_raw_token, p_encryption_key)
  WHERE id = p_board_id;
END;
$$;

CREATE FUNCTION public.get_board_github_pat(p_board_id uuid, p_encryption_key text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_encrypted bytea;
BEGIN
  IF NOT public.is_board_owner(p_board_id) THEN
    RAISE EXCEPTION 'permission denied: not the board owner';
  END IF;
  SELECT github_pat_encrypted INTO v_encrypted FROM public.boards WHERE id = p_board_id;
  IF v_encrypted IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN pgp_sym_decrypt(v_encrypted, p_encryption_key);
END;
$$;

REVOKE ALL ON FUNCTION public.set_board_github_pat(uuid, text, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.get_board_github_pat(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_board_github_pat(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_board_github_pat(uuid, text) TO authenticated;

-- RLS Policies: github_repos

CREATE POLICY github_repos_select ON public.github_repos
  FOR SELECT TO authenticated
  USING (public.is_board_member(board_id));

CREATE POLICY github_repos_insert ON public.github_repos
  FOR INSERT TO authenticated
  WITH CHECK (public.is_board_owner(board_id));

CREATE POLICY github_repos_update ON public.github_repos
  FOR UPDATE TO authenticated
  USING (public.is_board_owner(board_id))
  WITH CHECK (public.is_board_owner(board_id));

CREATE POLICY github_repos_delete ON public.github_repos
  FOR DELETE TO authenticated
  USING (public.is_board_owner(board_id));

-- RLS Policies: github_pull_requests

CREATE POLICY github_pull_requests_select ON public.github_pull_requests
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.github_repos gr WHERE gr.id = repo_id AND public.is_board_member(gr.board_id)));

CREATE POLICY github_pull_requests_insert ON public.github_pull_requests
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.github_repos gr WHERE gr.id = repo_id AND public.is_board_owner(gr.board_id)));

CREATE POLICY github_pull_requests_update ON public.github_pull_requests
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.github_repos gr WHERE gr.id = repo_id AND public.is_board_owner(gr.board_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.github_repos gr WHERE gr.id = repo_id AND public.is_board_owner(gr.board_id)));

CREATE POLICY github_pull_requests_delete ON public.github_pull_requests
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.github_repos gr WHERE gr.id = repo_id AND public.is_board_owner(gr.board_id)));

-- RLS Policies: github_reviews

CREATE POLICY github_reviews_select ON public.github_reviews
  FOR SELECT TO authenticated
  USING (public.is_board_member(public.get_board_id_for_pr(pull_request_id)));

CREATE POLICY github_reviews_insert ON public.github_reviews
  FOR INSERT TO authenticated
  WITH CHECK (public.is_board_owner(public.get_board_id_for_pr(pull_request_id)));

CREATE POLICY github_reviews_update ON public.github_reviews
  FOR UPDATE TO authenticated
  USING (public.is_board_owner(public.get_board_id_for_pr(pull_request_id)))
  WITH CHECK (public.is_board_owner(public.get_board_id_for_pr(pull_request_id)));

CREATE POLICY github_reviews_delete ON public.github_reviews
  FOR DELETE TO authenticated
  USING (public.is_board_owner(public.get_board_id_for_pr(pull_request_id)));

-- RLS Policies: github_review_comments

CREATE POLICY github_review_comments_select ON public.github_review_comments
  FOR SELECT TO authenticated
  USING (public.is_board_member(public.get_board_id_for_pr(pull_request_id)));

CREATE POLICY github_review_comments_insert ON public.github_review_comments
  FOR INSERT TO authenticated
  WITH CHECK (public.is_board_owner(public.get_board_id_for_pr(pull_request_id)));

CREATE POLICY github_review_comments_update ON public.github_review_comments
  FOR UPDATE TO authenticated
  USING (public.is_board_owner(public.get_board_id_for_pr(pull_request_id)))
  WITH CHECK (public.is_board_owner(public.get_board_id_for_pr(pull_request_id)));

CREATE POLICY github_review_comments_delete ON public.github_review_comments
  FOR DELETE TO authenticated
  USING (public.is_board_owner(public.get_board_id_for_pr(pull_request_id)));
