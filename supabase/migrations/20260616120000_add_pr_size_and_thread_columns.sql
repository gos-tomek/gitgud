-- Add PR size columns and reply thread tracking to existing GitHub ingestion tables

ALTER TABLE public.github_pull_requests
  ADD COLUMN additions bigint,
  ADD COLUMN deletions bigint,
  ADD COLUMN changed_files int;

ALTER TABLE public.github_review_comments
  ADD COLUMN in_reply_to_id bigint;
