import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { createServiceClient } from "@/lib/supabase-admin";
import { getHomepageStats, type HomepageStats } from "@/lib/services/homepage-stats";
import { logger } from "@/lib/logger";

const CACHE_KEY = "homepage-stats";
const CACHE_TTL_SECONDS = 3600;

const FALLBACK: HomepageStats = {
  boards: 0,
  contributors: 0,
  repos: 0,
  prsTracked: 0,
  threadsClassified: 0,
  deepDiscussions: 0,
  multiPersonThreads: 0,
  highImpactPercent: 0,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const GET: APIRoute = async () => {
  const cached = await env.HOMEPAGE_CACHE.get(CACHE_KEY);
  if (cached !== null) {
    return json(JSON.parse(cached));
  }

  let stats: HomepageStats;
  try {
    const client = createServiceClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
    stats = await getHomepageStats(client);
  } catch (err) {
    logger.error("[stats] Failed to aggregate homepage stats", err);
    stats = FALLBACK;
  }

  try {
    await env.HOMEPAGE_CACHE.put(CACHE_KEY, JSON.stringify(stats), { expirationTtl: CACHE_TTL_SECONDS });
  } catch (err) {
    logger.warn("[stats] Failed to write stats to KV cache", err);
  }

  return json(stats);
};
