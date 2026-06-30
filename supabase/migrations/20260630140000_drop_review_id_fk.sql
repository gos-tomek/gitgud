-- review_id FK was causing FK violations when sync-pr-details had 502 errors and
-- github_reviews rows were missing. review_id is not queried by any RPC, so removing
-- the constraint fixes the crash without losing useful data.
ALTER TABLE public.github_review_comments
  DROP CONSTRAINT IF EXISTS github_review_comments_review_id_fkey;
