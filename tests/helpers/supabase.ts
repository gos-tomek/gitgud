import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Local Supabase dev defaults — stable across `supabase start` for this project.
// Override via SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY env vars.
const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz";

export { SUPABASE_URL, SUPABASE_ANON_KEY };

export const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

export async function createTestUser(
  email: string,
  password = "test-password-123",
  github?: { id: number; login: string },
): Promise<{ client: SupabaseClient; userId: string }> {
  // handle_new_user (supabase/migrations/20260622130000_user_profiles_trigger.sql) requires
  // github_id/github_login metadata on every auth.users insert — supply defaults here so any
  // caller that doesn't care about the GitHub identity still gets a valid user_profiles row.
  const defaultGithub = { id: Date.now() + Math.floor(Math.random() * 100_000), login: `test-user-${Date.now()}` };
  const { id: githubId, login: githubLogin } = github ?? defaultGithub;

  const { data, error } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { github_id: githubId, github_login: githubLogin },
  });
  if (error ?? !data.user) throw new Error(`Failed to create ${email}: ${error?.message ?? "no user"}`);

  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`Failed to sign in ${email}: ${signInError.message}`);

  return { client, userId: data.user.id };
}

export async function cleanupUser(userId: string): Promise<void> {
  await adminClient.auth.admin.deleteUser(userId);
}

export async function cleanupBoard(boardId: string): Promise<void> {
  await adminClient.from("boards").delete().eq("id", boardId);
}
