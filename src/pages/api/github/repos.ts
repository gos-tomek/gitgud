import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { makeOctokit, GitHubAuthError } from "@/lib/github";
import { GITHUB_TOKEN_ENCRYPTION_KEY } from "astro:env/server";
import { logger } from "@/lib/logger";

const reposSchema = z.object({
  pat: z.string().min(1, "PAT is required").optional(),
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

  const parsed = reposSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues.at(0)?.message ?? "Invalid input";
    return json({ error: message }, 400);
  }

  let token = parsed.data.pat;
  if (!token) {
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
    const repos: { owner: string; name: string; fullName: string; private: boolean; pushAccess: boolean }[] = [];

    const REPO_LIMIT = 200;
    outer: for await (const response of octokit.paginate.iterator(octokit.rest.repos.listForAuthenticatedUser, {
      per_page: 100,
    })) {
      for (const repo of response.data) {
        repos.push({
          owner: repo.owner.login,
          name: repo.name,
          fullName: repo.full_name,
          private: repo.private,
          pushAccess: repo.permissions?.push ?? false,
        });
        if (repos.length >= REPO_LIMIT) break outer;
      }
    }

    return json({ repos });
  } catch (err) {
    if (err instanceof GitHubAuthError) {
      return json({ error: "Token is invalid or expired" }, 401);
    }
    logger.error("[repos]", err);
    return json({ error: "Failed to fetch repositories" }, 500);
  }
};
