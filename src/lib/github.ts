import { Octokit } from "@octokit/rest";
import { retry } from "@octokit/plugin-retry";
import type { createClient } from "@/lib/supabase";
import { GITHUB_TOKEN_ENCRYPTION_KEY } from "astro:env/server";
import { logger } from "@/lib/logger";

const OctokitWithRetry = Octokit.plugin(retry);

type SupabaseClient = NonNullable<ReturnType<typeof createClient>>;

export class GitHubTokenMissingError extends Error {
  constructor() {
    super("No GitHub PAT configured for this board");
    this.name = "GitHubTokenMissingError";
  }
}

export class GitHubRateLimitError extends Error {
  resetAt: Date;
  constructor(resetAt: Date) {
    super(`GitHub rate limit exhausted, resets at ${resetAt.toISOString()}`);
    this.name = "GitHubRateLimitError";
    this.resetAt = resetAt;
  }
}

export class GitHubAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHubAuthError";
  }
}

// GitHub's "GitHub-Authentication-Token-Expiration" header is non-ISO and comes in two known
// shapes: "2026-06-03 19:52:44 UTC" (named zone) and "2025-09-05 17:55:53 +0500" (numeric offset).
// Rejecting past dates guards against a 2025 GitHub bug that returned server time instead of the
// token's real expiry (fixed 2025-09-12) — a token that just authenticated successfully cannot
// genuinely have expired already, so any header reporting a past date must be that bug.
const TOKEN_EXPIRY_RE = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) (UTC|[+-]\d{4})$/;

export function parseGitHubTokenExpiry(raw: string): Date | null {
  const match = TOKEN_EXPIRY_RE.exec(raw.trim());
  if (!match) return null;

  const [, datePart, timePart, zone] = match;
  const isoZone = zone === "UTC" ? "Z" : `${zone.slice(0, 3)}:${zone.slice(3)}`;
  const date = new Date(`${datePart}T${timePart}${isoZone}`);

  if (Number.isNaN(date.getTime())) return null;
  if (date.getTime() < Date.now()) return null;

  return date;
}

export function makeOctokit(token: string): Octokit {
  const octokit = new OctokitWithRetry({
    auth: token,
    userAgent: "gitgud/0.0.1",
    request: { fetch: globalThis.fetch },
  });

  octokit.hook.after("request", (response) => {
    const remaining = Number(response.headers["x-ratelimit-remaining"] ?? 9999);
    const reset = Number(response.headers["x-ratelimit-reset"] ?? 0);

    if (remaining === 0) {
      const resetAt = new Date(reset * 1000);
      throw new GitHubRateLimitError(resetAt);
    }

    if (remaining <= 10) {
      logger.warn(
        `[github] rate-limit warning: ${remaining} requests remaining, resets at ${new Date(reset * 1000).toISOString()}`,
      );
    }
  });

  octokit.hook.error("request", (error) => {
    const status = (error as { status?: number }).status ?? 0;
    if (status === 401 || status === 403) {
      throw new GitHubAuthError(`GitHub API auth error ${status}: ${error.message}`);
    }
    throw error;
  });

  return octokit;
}

export async function createGitHubClient(
  supabase: SupabaseClient,
  boardId: string,
  encryptionKey?: string,
): Promise<Octokit> {
  // Astro API routes omit `encryptionKey` and rely on `astro:env/server` (request context).
  // The Workflow runs outside that context and passes the key explicitly from `this.env`.
  const key = encryptionKey ?? GITHUB_TOKEN_ENCRYPTION_KEY;
  if (!key) {
    throw new GitHubTokenMissingError();
  }

  const result = await supabase.rpc("get_user_github_pat", {
    p_board_id: boardId,
    p_encryption_key: key,
  });

  if (result.error) {
    throw new GitHubTokenMissingError();
  }

  const token = result.data as string | null;
  if (!token) {
    throw new GitHubTokenMissingError();
  }

  return makeOctokit(token);
}
