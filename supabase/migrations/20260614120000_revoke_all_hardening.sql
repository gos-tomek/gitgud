-- test-fix-gaps (PR3): REVOKE ALL hardening
--
-- Brings all 7 RLS-protected tables into compliance with the project convention
-- (lessons.md: "Every new table migration must include REVOKE ALL ... FROM anon,
-- authenticated before the RLS policies"). Existing policies already define the
-- allowed operations; re-granting table-level privileges to authenticated is
-- required because REVOKE ALL removes the privilege to even attempt an operation
-- -- RLS can only filter within granted privileges.

REVOKE ALL ON public.boards FROM anon, authenticated;
REVOKE ALL ON public.github_repos FROM anon, authenticated;
REVOKE ALL ON public.github_pull_requests FROM anon, authenticated;
REVOKE ALL ON public.github_reviews FROM anon, authenticated;
REVOKE ALL ON public.github_review_comments FROM anon, authenticated;
REVOKE ALL ON public.board_contributors FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.boards TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.github_repos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.github_pull_requests TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.github_reviews TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.github_review_comments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.board_contributors TO authenticated;
