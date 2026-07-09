-- flag-classification-inaccurate: add vote column to thread_classifications and
-- create a SECURITY DEFINER voting function accessible to any board member.

ALTER TABLE public.thread_classifications
  ADD COLUMN vote boolean DEFAULT NULL;

CREATE FUNCTION public.set_thread_classification_vote(
  p_thread_root_comment_id bigint,
  p_vote boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pull_request_id bigint;
  v_board_id uuid;
BEGIN
  SELECT pull_request_id
  INTO v_pull_request_id
  FROM public.thread_classifications
  WHERE thread_root_comment_id = p_thread_root_comment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'thread classification not found: %', p_thread_root_comment_id;
  END IF;

  v_board_id := public.get_board_id_for_pr(v_pull_request_id);

  IF NOT public.is_board_member(v_board_id) THEN
    RAISE EXCEPTION 'permission denied: not a board member';
  END IF;

  UPDATE public.thread_classifications
  SET vote = p_vote
  WHERE thread_root_comment_id = p_thread_root_comment_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_thread_classification_vote(bigint, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_thread_classification_vote(bigint, boolean) TO authenticated;
