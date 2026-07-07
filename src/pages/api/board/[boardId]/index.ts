import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
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

  const { boardId } = context.params;
  if (!boardId) {
    return json({ error: "Board ID is required" }, 400);
  }

  const { error } = await supabase.from("boards").delete().eq("id", boardId);

  if (error) {
    logger.error("[board] delete failed", { boardId, userId: user.id, detail: error.message });
    return json({ error: "Failed to delete board. Please try again." }, 500);
  }

  return json({ ok: true });
};
