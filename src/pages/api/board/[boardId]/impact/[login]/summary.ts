import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { getBoardWithRole } from "@/lib/services/boards";
import { parsePeriodSlug, isValidPeriodSlug } from "@/lib/date-range";
import { getImpactSummary } from "@/lib/services/impact-metrics";
import { logger } from "@/lib/logger";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const paramsSchema = z.object({
  boardId: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Invalid board ID"),
  login: z.string().min(1).max(100),
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
  const { boardId, login } = parsedParams.data;

  const board = await getBoardWithRole(supabase, boardId, user.id);
  if (!board) return json({ error: "Board not found" }, 404);

  if (board.role !== "supervisor") {
    const { data: own, error: ownError } = await supabase
      .from("board_contributors")
      .select("github_login")
      .eq("board_id", boardId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (ownError) {
      logger.error("[impact/summary] own-contributor lookup failed", ownError);
      return json({ error: "Database error" }, 500);
    }
    if (own?.github_login !== login) return json({ error: "Forbidden" }, 403);
  }

  const periodSlug = context.url.searchParams.get("period") ?? "90d";
  if (!isValidPeriodSlug(periodSlug)) return json({ error: "Invalid period slug" }, 400);

  const { data: contributor, error: contribError } = await supabase
    .from("board_contributors")
    .select("github_id")
    .eq("board_id", boardId)
    .eq("github_login", login)
    .maybeSingle();

  if (contribError) {
    logger.error("[impact/summary] contributor lookup failed", contribError);
    return json({ error: "Database error" }, 500);
  }
  if (!contributor) return json({ error: "Contributor not found" }, 404);

  try {
    const result = await getImpactSummary(
      supabase,
      boardId,
      contributor.github_id as number,
      parsePeriodSlug(periodSlug),
    );
    return json(result);
  } catch (err) {
    logger.error("[impact/summary] service error", err);
    return json({ error: "Failed to compute metrics" }, 500);
  }
};
