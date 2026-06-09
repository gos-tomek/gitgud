import { SUPABASE_URL, adminClient } from "./supabase.js";

export async function checkSupabase(): Promise<boolean> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { error } = await adminClient.from("boards").select("id").limit(1);
    if (error) throw new Error(error.message);
    return true;
  } catch {
    console.log("Local Supabase not running — run `npx supabase start`");
    return false;
  }
}
