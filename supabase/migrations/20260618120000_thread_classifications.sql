-- F-03: Classification batch — thread_classifications storage

CREATE TABLE public.thread_classifications (
  thread_root_comment_id bigint PRIMARY KEY REFERENCES public.github_review_comments(id) ON DELETE CASCADE,
  pull_request_id bigint NOT NULL REFERENCES public.github_pull_requests(id) ON DELETE CASCADE,
  intent text NOT NULL CHECK (intent IN ('mentoring', 'architecture', 'bug-catch', 'nitpick', 'unblocking', 'question')),
  domain text NOT NULL CHECK (domain IN ('functional', 'refactoring', 'documentation', 'discussion', 'false-positive')),
  constructive boolean NOT NULL,
  knowledge_direction text NOT NULL
    CHECK (knowledge_direction IN ('mentoring-down', 'peer-exchange', 'challenge-up', 'self-clarification')),
  confidence real NOT NULL CHECK (confidence BETWEEN 0.0 AND 1.0),
  model_id text NOT NULL,
  classified_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX thread_classifications_pull_request_id_idx ON public.thread_classifications (pull_request_id);

ALTER TABLE public.thread_classifications ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.thread_classifications FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.thread_classifications TO authenticated;

CREATE POLICY thread_classifications_select ON public.thread_classifications
  FOR SELECT TO authenticated
  USING (public.is_board_member(public.get_board_id_for_pr(pull_request_id)));

CREATE POLICY thread_classifications_insert ON public.thread_classifications
  FOR INSERT TO authenticated
  WITH CHECK (public.is_board_owner(public.get_board_id_for_pr(pull_request_id)));

CREATE POLICY thread_classifications_update ON public.thread_classifications
  FOR UPDATE TO authenticated
  USING (public.is_board_owner(public.get_board_id_for_pr(pull_request_id)))
  WITH CHECK (public.is_board_owner(public.get_board_id_for_pr(pull_request_id)));

CREATE POLICY thread_classifications_delete ON public.thread_classifications
  FOR DELETE TO authenticated
  USING (public.is_board_owner(public.get_board_id_for_pr(pull_request_id)));
