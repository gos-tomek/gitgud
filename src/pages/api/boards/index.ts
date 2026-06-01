import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { createBoard, BoardNameTakenError } from "@/lib/services/boards";
import { GITHUB_TOKEN_ENCRYPTION_KEY } from "astro:env/server";
import { logger } from "@/lib/logger";

const repoSchema = z.object({
  owner: z.string().min(1),
  name: z.string().min(1),
});

const createBoardSchema = z.object({
  name: z.string().trim().min(1, "Board name is required").max(80, "Keep it under 80 characters"),
  pat: z.string().min(1, "GitHub token is required"),
  repos: z.array(repoSchema).min(1, "At least one repository is required"),
});

export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return new Response(JSON.stringify({ error: "Supabase is not configured" }), { status: 500 });
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400 });
  }

  const parsed = createBoardSchema.safeParse(body);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues.at(0);
    return new Response(JSON.stringify({ error: firstIssue?.message ?? "Invalid input" }), { status: 400 });
  }

  try {
    const { id: boardId } = await createBoard(supabase, user.id, parsed.data.name);

    const { error: patError } = await supabase.rpc("set_board_github_pat", {
      p_board_id: boardId,
      p_raw_token: parsed.data.pat,
      p_encryption_key: GITHUB_TOKEN_ENCRYPTION_KEY,
    });
    if (patError) {
      logger.warn(`[boards] PAT storage failed for board ${boardId}: ${patError.message}`);
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

    return new Response(JSON.stringify({ id: boardId }), { status: 201 });
  } catch (err) {
    if (err instanceof BoardNameTakenError) {
      return new Response(JSON.stringify({ error: err.message }), { status: 409 });
    }
    return new Response(JSON.stringify({ error: "Something went wrong. Please try again." }), { status: 500 });
  }
};
