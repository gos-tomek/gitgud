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

const HIGH_IMPACT_INTENTS: readonly string[] = ["architecture", "bug-catch", "mentoring", "unblocking"];

export async function getHomepageStats(client: ServiceClient): Promise<HomepageStats> {
  const [boardsResult, contributorsResult, reposResult, prsResult, classifiedResult] = await Promise.all([
    client.from("boards").select("*", { count: "exact", head: true }),
    client.from("board_contributors").select("github_login"),
    client.from("github_repos").select("*", { count: "exact", head: true }),
    client.from("github_pull_requests").select("*", { count: "exact", head: true }),
    client.from("thread_classifications").select("thread_root_comment_id, intent"),
  ]);

  if (boardsResult.error) logger.warn("[homepage-stats] boards query failed", boardsResult.error);
  if (contributorsResult.error) logger.warn("[homepage-stats] contributors query failed", contributorsResult.error);
  if (reposResult.error) logger.warn("[homepage-stats] repos query failed", reposResult.error);
  if (prsResult.error) logger.warn("[homepage-stats] pull requests query failed", prsResult.error);
  if (classifiedResult.error) logger.warn("[homepage-stats] classifications query failed", classifiedResult.error);

  const boards = boardsResult.count ?? 0;
  const repos = reposResult.count ?? 0;
  const prsTracked = prsResult.count ?? 0;

  // Distinct contributor count — Supabase doesn't expose DISTINCT COUNT via select(), so we
  // fetch all logins and deduplicate in JS. The table is bounded by board membership, not global.
  const allLogins = (contributorsResult.data ?? []) as { github_login: string }[];
  const contributors = new Set(allLogins.map((r) => r.github_login)).size;

  const classifications = (classifiedResult.data ?? []) as { thread_root_comment_id: number; intent: string }[];
  const threadsClassified = classifications.length;
  const highImpact = classifications.filter((c) => HIGH_IMPACT_INTENTS.includes(c.intent)).length;
  const highImpactPercent = threadsClassified > 0 ? Math.round((highImpact / threadsClassified) * 100) : 0;

  let deepDiscussions = 0;
  let multiPersonThreads = 0;

  const rootIds = classifications.map((c) => c.thread_root_comment_id);
  if (rootIds.length > 0) {
    const [rootsResult, repliesResult] = await Promise.all([
      client.from("github_review_comments").select("id, commenter_login").in("id", rootIds),
      client.from("github_review_comments").select("in_reply_to_id, commenter_login").in("in_reply_to_id", rootIds),
    ]);

    if (rootsResult.error) logger.warn("[homepage-stats] roots query failed", rootsResult.error);
    if (repliesResult.error) logger.warn("[homepage-stats] replies query failed", repliesResult.error);

    const roots = (rootsResult.data ?? []) as { id: number; commenter_login: string }[];
    const replies = (repliesResult.data ?? []) as { in_reply_to_id: number; commenter_login: string }[];

    const rootLoginById = new Map(roots.map((r) => [r.id, r.commenter_login]));

    const repliesByRoot = new Map<number, { commenter_login: string }[]>();
    for (const reply of replies) {
      const bucket = repliesByRoot.get(reply.in_reply_to_id) ?? [];
      bucket.push(reply);
      repliesByRoot.set(reply.in_reply_to_id, bucket);
    }

    for (const rootId of rootIds) {
      const rootLogin = rootLoginById.get(rootId);
      if (!rootLogin) continue;
      const threadReplies = repliesByRoot.get(rootId) ?? [];

      if (1 + threadReplies.length >= 3) deepDiscussions++;

      const participants = new Set([rootLogin, ...threadReplies.map((r) => r.commenter_login)]);
      if (participants.size >= 2) multiPersonThreads++;
    }
  }

  return {
    boards,
    contributors,
    repos,
    prsTracked,
    threadsClassified,
    deepDiscussions,
    multiPersonThreads,
    highImpactPercent,
  };
}
