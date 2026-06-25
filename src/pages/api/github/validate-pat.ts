import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { makeOctokit, GitHubAuthError, parseGitHubTokenExpiry } from "@/lib/github";
import { logger } from "@/lib/logger";

const validatePatSchema = z.object({
  pat: z.string().min(1, "PAT is required"),
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

  const parsed = validatePatSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues.at(0)?.message ?? "Invalid input";
    return json({ error: message }, 400);
  }

  const { pat } = parsed.data;

  const warning = pat.startsWith("github_pat_")
    ? "Fine-grained PATs have limited org access. Classic PATs with repo + read:org scopes are recommended."
    : undefined;

  try {
    const octokit = makeOctokit(pat);
    const { data, headers } = await octokit.rest.users.getAuthenticated();
    const expiryHeader = headers["github-authentication-token-expiration"];
    const expiresAt = expiryHeader ? parseGitHubTokenExpiry(String(expiryHeader)) : null;
    return json({
      login: data.login,
      id: data.id,
      avatarUrl: data.avatar_url,
      expiresAt: expiresAt ? expiresAt.toISOString() : null,
      ...(warning ? { warning } : {}),
    });
  } catch (err) {
    if (err instanceof GitHubAuthError) {
      return json({ error: "Token is invalid or expired" }, 401);
    }
    logger.error("[validate-pat]", err);
    return json({ error: "Failed to validate token" }, 500);
  }
};
