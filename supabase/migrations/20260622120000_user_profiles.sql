-- F-04 (p1): user_profiles table — one GitHub identity per Supabase auth user.

CREATE TABLE public.user_profiles (
  user_id      uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  github_id    bigint NOT NULL,
  github_login text NOT NULL,
  avatar_url   text
);

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.user_profiles FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.user_profiles TO authenticated;

CREATE POLICY user_profiles_select ON public.user_profiles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY user_profiles_insert ON public.user_profiles
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY user_profiles_update ON public.user_profiles
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- No DELETE policy: profiles are permanent.
