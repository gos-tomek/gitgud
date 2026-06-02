import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { createBoard, BoardNameTakenError, addBoardContributors } from "@/lib/services/boards";
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

  try {
    const { id: boardId } = await createBoard(supabase, user.id, parsed.data.name);

    const { error: patError } = await supabase.rpc("set_board_github_pat", {
      p_board_id: boardId,
      p_raw_token: parsed.data.pat,
      p_encryption_key: GITHUB_TOKEN_ENCRYPTION_KEY,
    });
    if (patError) {
      logger.error(`[boards] PAT storage failed for board ${boardId}: ${patError.message}`);
      return json({ error: "Failed to store GitHub token. Please try again." }, 500);
    }

    const { error: reposError } = await supabase.from("github_repos").insert(
      parsed.data.repos.map((r) => ({
        board_id: boardId,
        repo_owner: r.owner,
        repo_name: r.name,
        connected_by: user.id,
      })),
    );
    if (reposError) {
      logger.warn(`[boards] Repo linking failed for board ${boardId}: ${reposError.message}`);
    }

    try {
      await addBoardContributors(
        supabase,
        boardId,
        parsed.data.contributors.map((c) => ({
          githubId: c.githubId,
          githubLogin: c.githubLogin,
          avatarUrl: c.avatarUrl ?? null,
        })),
      );
    } catch (err) {
      // Contributor insert failed — delete the board so the user can retry cleanly.
      // ON DELETE CASCADE removes github_repos and the encrypted PAT automatically.
      const { error: deleteError } = await supabase.from("boards").delete().eq("id", boardId);
      if (deleteError) {
        logger.error(`[boards] Cleanup delete failed for orphaned board ${boardId}: ${deleteError.message}`);
      }
      throw err;
    }

    return json({ id: boardId }, 201);
  } catch (err) {
    if (err instanceof BoardNameTakenError) {
      return json({ error: err.message }, 409);
    }
    logger.error("[boards]", err);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
};
