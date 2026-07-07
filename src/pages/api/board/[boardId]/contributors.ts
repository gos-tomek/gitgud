import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { getBoardWithRole, addBoardContributors, removeBoardContributor } from "@/lib/services/boards";
import { logger } from "@/lib/logger";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const paramsSchema = z.object({
  boardId: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Invalid board ID"),
});

const contributorSchema = z.object({
  githubId: z.number().int().positive(),
  githubLogin: z.string().min(1),
  avatarUrl: z.string().optional(),
});

const postSchema = z.object({
  contributors: z.array(contributorSchema).min(1).max(200),
});

const deleteSchema = z.object({
  githubId: z.number().int().positive(),
});

export const POST: APIRoute = async (context) => {
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

  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: parsed.error.issues.at(0)?.message ?? "Invalid input" }, 400);
  }

  try {
    await addBoardContributors(supabase, boardId, parsed.data.contributors);
    return new Response(null, { status: 201 });
  } catch (err: unknown) {
    logger.error("[board-contributors] add failed", { boardId, userId: user.id }, err);
    return json({ error: "Failed to add contributors. Please try again." }, 500);
  }
};

export const DELETE: APIRoute = async (context) => {
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

  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: parsed.error.issues.at(0)?.message ?? "Invalid input" }, 400);
  }

  try {
    await removeBoardContributor(supabase, boardId, parsed.data.githubId);
    return new Response(null, { status: 204 });
  } catch (err: unknown) {
    logger.error("[board-contributors] remove failed", { boardId, userId: user.id }, err);
    return json({ error: "Failed to remove contributor. Please try again." }, 500);
  }
};
