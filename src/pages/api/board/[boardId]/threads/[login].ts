import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { getBoardWithRole, getUserProfile } from "@/lib/services/boards";
import { parsePeriodSlug, isValidPeriodSlug } from "@/lib/date-range";
import { getClassifiedThreads } from "@/lib/services/impact-metrics";
import { logger } from "@/lib/logger";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const paramsSchema = z.object({
  boardId: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Invalid board ID"),
  login: z.string().min(1).max(100),
});

const queryParamsSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(10).max(50).default(25),
  intent: z
    .enum([
      "mentoring",
      "architecture",
      "bug-catch",
      "nitpick",
      "unblocking",
      "question",
      "praise",
      "joke",
      "self-review",
      "unknown",
    ])
    .optional(),
  domain: z.enum(["functional", "refactoring", "documentation", "discussion", "false-positive"]).optional(),
  prId: z.coerce.number().int().positive().optional(),
  role: z.enum(["started", "received", "self", "joined", "all"]).default("all"),
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

  const periodSlug = context.url.searchParams.get("period") ?? "90d";
  if (!isValidPeriodSlug(periodSlug)) return json({ error: "Invalid period slug" }, 400);

  const sp = context.url.searchParams;
  const parsedQuery = queryParamsSchema.safeParse({
    page: sp.get("page") ?? undefined,
    pageSize: sp.get("pageSize") ?? undefined,
    intent: sp.get("intent") ?? undefined,
    domain: sp.get("domain") ?? undefined,
    prId: sp.get("prId") ?? undefined,
    role: sp.get("role") ?? undefined,
  });
  if (!parsedQuery.success) {
    return json({ error: parsedQuery.error.issues.at(0)?.message ?? "Invalid query parameters" }, 400);
  }
  const { page, pageSize, intent, domain, prId, role } = parsedQuery.data;

  const { data: contributor, error: contribError } = await supabase
    .from("board_contributors")
    .select("github_id")
    .eq("board_id", boardId)
    .eq("github_login", login)
    .maybeSingle();

  if (contribError) {
    logger.error("[threads] contributor lookup failed", contribError);
    return json({ error: "Database error" }, 500);
  }
  if (!contributor) return json({ error: "Contributor not found" }, 404);

  if (board.role !== "supervisor") {
    const ownProfile = await getUserProfile(supabase, user.id).catch((err: unknown) => {
      logger.error("[threads] own-profile lookup failed", err);
      return null;
    });
    if (ownProfile?.githubId !== contributor.github_id) return json({ error: "Forbidden" }, 403);
  }

  try {
    const result = await getClassifiedThreads(
      supabase,
      boardId,
      contributor.github_id as number,
      parsePeriodSlug(periodSlug),
      { intent, domain, pullRequestId: prId, role },
      page,
      pageSize,
    );
    return json(result);
  } catch (err) {
    logger.error("[threads] service error", err);
    return json({ error: "Failed to fetch threads" }, 500);
  }
};
