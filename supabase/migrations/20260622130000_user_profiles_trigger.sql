-- F-04 (p2): populate user_profiles atomically with auth.users INSERT.
-- Trigger reads the GitHub identity passed as signUp() metadata so account
-- creation and profile creation share one transaction — no orphan auth users
-- if the insert fails.

CREATE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_profiles (user_id, github_id, github_login, avatar_url)
  VALUES (
    NEW.id,
    (NEW.raw_user_meta_data->>'github_id')::bigint,
    NEW.raw_user_meta_data->>'github_login',
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM public, anon;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
