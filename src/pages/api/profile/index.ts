import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { createServiceClient } from "@/lib/supabase-admin";
import { SUPABASE_URL, SUPABASE_SERVICE_KEY } from "astro:env/server";
import { logger } from "@/lib/logger";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const DELETE: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return json({ error: "Supabase is not configured" }, 503);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return json({ error: "Unauthorized" }, 401);
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return json({ error: "Supabase is not configured" }, 503);
  }

  const adminClient = createServiceClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const { error } = await adminClient.auth.admin.deleteUser(user.id);

  if (error) {
    logger.error("[profile] deleteUser failed", { userId: user.id, detail: error.message });
    return json({ error: "Failed to delete account. Please try again." }, 500);
  }

  return json({ ok: true });
};
