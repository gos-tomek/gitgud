import { Octokit } from "@octokit/rest";
import type { createClient } from "@/lib/supabase";
import { GITHUB_TOKEN_ENCRYPTION_KEY } from "astro:env/server";

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

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeOctokit(token: string): Octokit {
  const octokit = new Octokit({
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
      console.warn(
        `[github] rate-limit warning: ${remaining} requests remaining, resets at ${new Date(reset * 1000).toISOString()}`,
      );
    }
  });

  octokit.hook.error("request", async (error, options) => {
    const status = (error as { status?: number }).status ?? 0;

    if (status === 401 || status === 403) {
      throw new GitHubAuthError(`GitHub API auth error ${status}: ${error.message}`);
    }

    // Retry transient errors (5xx or network) up to 3 times with exponential backoff
    if (status >= 500 || status === 0) {
      const retries = ((options as Record<string, unknown>)._retries as number | undefined) ?? 0;
      if (retries < 3) {
        (options as Record<string, unknown>)._retries = retries + 1;
        await delay(1000 * Math.pow(2, retries));
        return octokit.request(options);
      }
    }

    throw error;
  });

  return octokit;
}

export async function createGitHubClient(supabase: SupabaseClient, boardId: string): Promise<Octokit | null> {
  if (!GITHUB_TOKEN_ENCRYPTION_KEY) {
    console.warn("[github] GITHUB_TOKEN_ENCRYPTION_KEY is not set");
    return null;
  }

  const result = await supabase.rpc("get_board_github_pat", {
    p_board_id: boardId,
    p_encryption_key: GITHUB_TOKEN_ENCRYPTION_KEY,
  });

  if (result.error) {
    console.error("[github] Failed to decrypt PAT:", result.error.message);
    return null;
  }

  const token = result.data as string | null;
  if (!token) {
    return null;
  }

  return makeOctokit(token);
}
