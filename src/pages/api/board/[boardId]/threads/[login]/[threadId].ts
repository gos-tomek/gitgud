import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { getBoardWithRole, getUserProfile } from "@/lib/services/boards";
import { getThreadMessages } from "@/lib/services/impact-metrics";
import { logger } from "@/lib/logger";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const paramsSchema = z.object({
  boardId: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Invalid board ID"),
  login: z.string().min(1).max(100),
  threadId: z.coerce.number().int().positive(),
});

export const GET: APIRoute = async (context) => {
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
  const { boardId, login, threadId } = parsedParams.data;

  const board = await getBoardWithRole(supabase, boardId, user.id);
  if (!board) return json({ error: "Board not found" }, 404);

  const { data: contributor, error: contribError } = await supabase
    .from("board_contributors")
    .select("github_id")
    .eq("board_id", boardId)
    .eq("github_login", login)
    .maybeSingle();

  if (contribError) {
    logger.error("[thread-messages] contributor lookup failed", contribError);
    return json({ error: "Database error" }, 500);
  }
  if (!contributor) return json({ error: "Contributor not found" }, 404);

  if (board.role !== "supervisor") {
    const ownProfile = await getUserProfile(supabase, user.id).catch((err: unknown) => {
      logger.error("[thread-messages] own-profile lookup failed", err);
      return null;
    });
    if (ownProfile?.githubId !== contributor.github_id) return json({ error: "Forbidden" }, 403);
  }

  try {
    const messages = await getThreadMessages(supabase, threadId);
    return json({ messages });
  } catch (err) {
    logger.error("[thread-messages] service error", err);
    return json({ error: "Failed to fetch thread messages" }, 500);
  }
};
