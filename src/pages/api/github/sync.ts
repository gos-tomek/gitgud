import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { getBoardWithRole } from "@/lib/services/boards";
import { syncBoardGitHubData } from "@/lib/services/github-sync";
import { logger } from "@/lib/logger";

const syncSchema = z.object({
  boardId: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Invalid board ID"),
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const POST: APIRoute = async (context) => {
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

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = syncSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues.at(0)?.message ?? "Invalid input";
    return json({ error: message }, 400);
  }

  const { boardId } = parsed.data;

  const board = await getBoardWithRole(supabase, boardId, user.id);
  if (!board) {
    return json({ error: "Board not found" }, 404);
  }
  if (board.role !== "supervisor") {
    return json({ error: "Only the board owner can trigger a sync" }, 403);
  }

  try {
    const result = await syncBoardGitHubData(supabase, boardId);
    return json(result);
  } catch (err) {
    logger.error("[github-sync]", err);
    const message = err instanceof Error ? err.message : "Sync failed";
    return json({ error: message }, 500);
  }
};
