import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { makeOctokit, GitHubAuthError, parseGitHubTokenExpiry } from "@/lib/github";
import { GITHUB_TOKEN_ENCRYPTION_KEY } from "astro:env/server";
import { logger } from "@/lib/logger";

const savePatSchema = z.object({
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

  const parsed = savePatSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues.at(0)?.message ?? "Invalid input";
    return json({ error: message }, 400);
  }

  const { pat } = parsed.data;

  try {
    const octokit = makeOctokit(pat);
    const { data, headers } = await octokit.rest.users.getAuthenticated();
    const expiryHeader = headers["github-authentication-token-expiration"];
    const expiresAt = expiryHeader ? parseGitHubTokenExpiry(String(expiryHeader)) : null;

    const result = await supabase.rpc("set_user_github_pat", {
      p_user_id: user.id,
      p_raw_token: pat,
      p_encryption_key: GITHUB_TOKEN_ENCRYPTION_KEY,
      p_expires_at: expiresAt ? expiresAt.toISOString() : null,
    });

    if (result.error) {
      logger.error("[profile/pat] set_user_github_pat failed", { userId: user.id, detail: result.error.message });
      return json({ error: "Failed to save token. Please try again." }, 500);
    }

    return json({ login: data.login, expiresAt: expiresAt ? expiresAt.toISOString() : null });
  } catch (err) {
    if (err instanceof GitHubAuthError) {
      return json({ error: "Token is invalid or expired" }, 401);
    }
    logger.error("[profile/pat]", err);
    return json({ error: "Failed to validate token" }, 500);
  }
};
