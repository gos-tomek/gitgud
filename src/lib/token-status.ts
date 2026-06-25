import type { createClient } from "@/lib/supabase";

type SupabaseClient = NonNullable<ReturnType<typeof createClient>>;

const WARNING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export async function getTokenWarning(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ message: string; expiresAt: string } | null> {
  const { data, error } = await supabase
    .from("user_profiles")
    .select("token_expires_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data?.token_expires_at) return null;

  const expiresAt = new Date(data.token_expires_at as string);
  if (Number.isNaN(expiresAt.getTime())) return null;

  const msUntilExpiry = expiresAt.getTime() - Date.now();
  if (msUntilExpiry > WARNING_WINDOW_MS) return null;

  const message =
    msUntilExpiry <= 0
      ? "Your GitHub token has expired — update it in Profile Settings to resume syncing."
      : `Your GitHub token expires in ${Math.ceil(msUntilExpiry / (24 * 60 * 60 * 1000))} day${Math.ceil(msUntilExpiry / (24 * 60 * 60 * 1000)) === 1 ? "" : "s"} — update it in Profile Settings before it expires.`;

  return { message, expiresAt: expiresAt.toISOString() };
}
