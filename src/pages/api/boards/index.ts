import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { GITHUB_TOKEN_ENCRYPTION_KEY } from "astro:env/server";
import { logger } from "@/lib/logger";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const repoSchema = z.object({
  owner: z.string().min(1),
  name: z.string().min(1),
});

const contributorSchema = z.object({
  githubId: z.number().int().positive(),
  githubLogin: z.string().min(1),
  avatarUrl: z.string().optional(),
});

const createBoardSchema = z.object({
  name: z.string().trim().min(1, "Board name is required").max(80, "Keep it under 80 characters"),
  pat: z.string().min(1, "GitHub token is required"),
  repos: z.array(repoSchema).min(1, "At least one repository is required"),
  contributors: z.array(contributorSchema).min(1, "At least one contributor is required").max(200),
});

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

  const parsed = createBoardSchema.safeParse(body);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues.at(0);
    return json({ error: firstIssue?.message ?? "Invalid input" }, 400);
  }

  const result = await supabase.rpc("create_board_atomic", {
    p_user_id: user.id,
    p_name: parsed.data.name,
    p_raw_token: parsed.data.pat,
    p_encryption_key: GITHUB_TOKEN_ENCRYPTION_KEY,
    p_repos: parsed.data.repos.map((r) => ({ owner: r.owner, name: r.name })),
    p_contributors: parsed.data.contributors.map((c) => ({
      github_id: c.githubId,
      github_login: c.githubLogin,
      avatar_url: c.avatarUrl ?? null,
    })),
  });

  if (result.error) {
    if (result.error.code === "23505") {
      return json({ error: "You already have a board with that name" }, 409);
    }
    logger.error("[boards] create_board_atomic failed", {
      boardName: parsed.data.name,
      userId: user.id,
      pgCode: result.error.code,
      detail: result.error.message,
    });
    return json({ error: "Board creation failed. Please try again." }, 500);
  }

  return json({ id: result.data as string }, 201);
};
