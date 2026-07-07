import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { getBoardWithRole, renameBoard } from "@/lib/services/boards";
import { logger } from "@/lib/logger";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const paramsSchema = z.object({
  boardId: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Invalid board ID"),
});

const patchSchema = z.object({
  name: z.string().trim().min(1, "Board name is required").max(80, "Keep it under 80 characters"),
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
  const { boardId } = parsedParams.data;

  const board = await getBoardWithRole(supabase, boardId, user.id);
  if (!board) return json({ error: "Board not found" }, 404);
  if (board.role !== "supervisor") return json({ error: "Forbidden" }, 403);

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: parsed.error.issues.at(0)?.message ?? "Invalid input" }, 400);
  }

  const { data: existing } = await supabase
    .from("boards")
    .select("id")
    .eq("owner_user_id", user.id)
    .ilike("name", parsed.data.name)
    .neq("id", boardId)
    .maybeSingle();

  if (existing) {
    return json({ error: "You already have a board with that name" }, 409);
  }

  try {
    await renameBoard(supabase, boardId, parsed.data.name);
    return new Response(null, { status: 204 });
  } catch (err: unknown) {
    if (typeof err === "object" && err !== null && "code" in err && (err as { code: string }).code === "23505") {
      return json({ error: "You already have a board with that name" }, 409);
    }
    logger.error("[board-settings] rename failed", { boardId, userId: user.id }, err);
    return json({ error: "Failed to rename board. Please try again." }, 500);
  }
};
