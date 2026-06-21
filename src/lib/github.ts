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

  const result = await supabase.rpc("get_board_github_pat", {
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
