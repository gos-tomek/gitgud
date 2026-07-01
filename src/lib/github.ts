import { Octokit } from "@octokit/rest";
import { retry } from "@octokit/plugin-retry";
import { throttling } from "@octokit/plugin-throttling";
import type { createClient } from "@/lib/supabase";
import { GITHUB_TOKEN_ENCRYPTION_KEY } from "astro:env/server";
import { logger } from "@/lib/logger";

const OctokitWithPlugins = Octokit.plugin(retry, throttling);

// Per-request timeout guards against GitHub keeping a connection open indefinitely
// (observed: 16-min hangs on large GQL queries before Cloudflare killed the step).
const GH_REQUEST_TIMEOUT_MS = 60_000;

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

function isSecondaryRateLimit(error: unknown): boolean {
  const msg = (error as { message?: string }).message ?? "";
  return msg.includes("secondary rate limit") || msg.includes("abuse detection");
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

const MAX_RETRIES = 3;

export function makeOctokit(token: string): Octokit {
  const octokit = new OctokitWithPlugins({
    auth: token,
    userAgent: "gitgud/0.0.1",
    request: { fetch: globalThis.fetch },
    retry: { doNotRetry: [400, 401, 403, 404, 422, 500] },
    throttle: {
      onRateLimit: (
        retryAfter: number,
        options: { method: string; url: string },
        _octokit: unknown,
        retryCount: number,
      ) => {
        logger.warn(
          `[github] rate limit hit for ${options.method} ${options.url}, retry-after ${retryAfter}s (attempt ${retryCount + 1}/${MAX_RETRIES})`,
        );
        return retryCount < MAX_RETRIES;
      },
      onSecondaryRateLimit: (
        retryAfter: number,
        options: { method: string; url: string },
        _octokit: unknown,
        retryCount: number,
      ) => {
        logger.warn(
          `[github] secondary rate limit for ${options.method} ${options.url}, retry-after ${retryAfter}s (attempt ${retryCount + 1}/${MAX_RETRIES})`,
        );
        return retryCount < MAX_RETRIES;
      },
    },
  });

  // Inject a fresh AbortSignal per request so hanging GitHub responses
  // (e.g. large GQL queries that never return) time out after 60 s
  // instead of blocking the Cloudflare Worker step for 15+ minutes.
  octokit.hook.before("request", (options) => {
    const req = options.request as Record<string, unknown>;
    req.signal ??= AbortSignal.timeout(GH_REQUEST_TIMEOUT_MS);
    logger.info(`[github] → ${options.method} ${options.url}`);
  });

  octokit.hook.after("request", (response) => {
    const remaining = Number(response.headers["x-ratelimit-remaining"] ?? -1);
    const reset = Number(response.headers["x-ratelimit-reset"] ?? 0);
    const resetStr = reset ? new Date(reset * 1000).toISOString() : "?";

    if (remaining === 0) {
      throw new GitHubRateLimitError(new Date(reset * 1000));
    }

    if (remaining >= 0) {
      const level = remaining <= 100 ? "warn" : "info";
      logger[level](`[github] ← ${response.status} | rate-limit: ${remaining} remaining, resets ${resetStr}`);
    } else {
      logger.info(`[github] ← ${response.status}`);
    }
  });

  octokit.hook.error("request", (error) => {
    const status = (error as { status?: number }).status ?? 0;
    logger.warn(`[github] ✗ status=${status} ${error.message}`);
    if (status === 401) {
      throw new GitHubAuthError(`GitHub API auth error ${status}: ${error.message}`);
    }
    if (status === 403 && !isSecondaryRateLimit(error)) {
      throw new GitHubAuthError(`GitHub API auth error ${status}: ${error.message}`);
    }
    throw error;
  });

  return octokit;
}

export async function getGitHubToken(
  supabase: SupabaseClient,
  boardId: string,
  encryptionKey?: string,
): Promise<string> {
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

  return token;
}

export async function createGitHubClient(
  supabase: SupabaseClient,
  boardId: string,
  encryptionKey?: string,
): Promise<Octokit> {
  const token = await getGitHubToken(supabase, boardId, encryptionKey);
  return makeOctokit(token);
}
