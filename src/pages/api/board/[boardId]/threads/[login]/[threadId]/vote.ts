import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { getBoardWithRole } from "@/lib/services/boards";
import { logger } from "@/lib/logger";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const paramsSchema = z.object({
  boardId: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Invalid board ID"),
  login: z.string().min(1).max(100),
  threadId: z.coerce.number().int().positive(),
});

const bodySchema = z.object({
  vote: z.boolean().nullable(),
});

export const PATCH: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) return json({ error: "Supabase is not configured" }, 503);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json({ error: "Unauthorized" }, 401);

  const parsedParams = paramsSchema.safeParse(context.params);
  if (!parsedParams.success) {
    return json({ error: parsedParams.error.issues.at(0)?.message ?? "Invalid parameters" }, 400);
  }
  const { boardId, threadId } = parsedParams.data;

  const board = await getBoardWithRole(supabase, boardId, user.id);
  if (!board) return json({ error: "Board not found" }, 404);

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: parsed.error.issues.at(0)?.message ?? "Invalid input" }, 400);
  }

  try {
    const { error } = await supabase.rpc("set_thread_classification_vote", {
      p_thread_root_comment_id: threadId,
      p_vote: parsed.data.vote,
    });
    if (error) {
      if (error.message.includes("permission denied")) return json({ error: "Forbidden" }, 403);
      if (error.message.includes("not found")) return json({ error: "Thread not found" }, 404);
      throw error;
    }
    return new Response(null, { status: 204 });
  } catch (err) {
    logger.error("[thread-vote] rpc error", err);
    return json({ error: "Failed to set vote" }, 500);
  }
};
