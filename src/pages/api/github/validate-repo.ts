import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { makeOctokit, GitHubAuthError } from "@/lib/github";
import { GITHUB_TOKEN_ENCRYPTION_KEY } from "astro:env/server";
import { logger } from "@/lib/logger";

const validateRepoSchema = z.object({
  pat: z.string().min(1, "PAT is required").optional(),
  owner: z.string().min(1, "Owner is required"),
  name: z.string().min(1, "Repo name is required"),
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

  const parsed = validateRepoSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues.at(0)?.message ?? "Invalid input";
    return json({ error: message }, 400);
  }

  const { owner, name } = parsed.data;

  let token = parsed.data.pat;
  if (!token) {
    if (!GITHUB_TOKEN_ENCRYPTION_KEY) return json({ error: "Encryption is not configured" }, 503);
    const patResult = await supabase.rpc("get_user_github_pat_by_user_id", {
      p_user_id: user.id,
      p_encryption_key: GITHUB_TOKEN_ENCRYPTION_KEY,
    });
    if (patResult.error || !patResult.data) {
      return json({ error: "No GitHub token configured — save one in Profile Settings first" }, 400);
    }
    token = patResult.data as string;
  }

  try {
    const octokit = makeOctokit(token);
    const { data } = await octokit.rest.repos.get({ owner, repo: name });
    return json({
      owner: data.owner.login,
      name: data.name,
      fullName: data.full_name,
      private: data.private,
      pushAccess: data.permissions?.push ?? false,
    });
  } catch (err) {
    if (err instanceof GitHubAuthError) {
      return json({ error: "Token is invalid or expired" }, 401);
    }
    const status = (err as { status?: number }).status ?? 0;
    if (status === 404) {
      return json({ error: "Repository not found or not accessible with this token" }, 404);
    }
    logger.error("[validate-repo]", err);
    return json({ error: "Failed to validate repository" }, 500);
  }
};
