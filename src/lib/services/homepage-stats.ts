import type { createServiceClient } from "@/lib/supabase-admin";
import { logger } from "@/lib/logger";

type ServiceClient = ReturnType<typeof createServiceClient>;

export interface HomepageStats {
  boards: number;
  contributors: number;
  repos: number;
  prsTracked: number;
  threadsClassified: number;
  deepDiscussions: number;
  multiPersonThreads: number;
  highImpactPercent: number;
}

interface StatsRpcRow {
  boards: number | string;
  contributors: number | string;
  repos: number | string;
  prs_tracked: number | string;
  threads_classified: number | string;
  deep_discussions: number | string;
  multi_person_threads: number | string;
  high_impact_percent: number | string;
}

export async function getHomepageStats(client: ServiceClient): Promise<HomepageStats> {
  const { data, error } = await client.rpc("get_homepage_stats").single();

  if (error || !data) {
    logger.error("[homepage-stats] RPC get_homepage_stats failed", error);
    throw error ?? new Error("get_homepage_stats returned no data");
  }

  const row = data as StatsRpcRow;
  return {
    boards: Number(row.boards),
    contributors: Number(row.contributors),
    repos: Number(row.repos),
    prsTracked: Number(row.prs_tracked),
    threadsClassified: Number(row.threads_classified),
    deepDiscussions: Number(row.deep_discussions),
    multiPersonThreads: Number(row.multi_person_threads),
    highImpactPercent: Number(row.high_impact_percent),
  };
}
