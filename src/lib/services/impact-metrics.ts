import type { createClient } from "@/lib/supabase";
import type {
  ImpactSummary,
  AuthorMetrics,
  ReviewerMetrics,
  ActivityData,
  DateRange,
  KpiMetric,
  WeeklyActivity,
  DailyActivity,
  Collaborator,
  RepoActivity,
  PrRow,
} from "@/types";

type SupabaseClient = NonNullable<ReturnType<typeof createClient>>;

// Raw DB row shapes — only fields we actually select

interface PrDb {
  id: number;
  number: number;
  title: string;
  state: string;
  author_github_id: number;
  author_login: string;
  is_draft: boolean;
  created_at: string;
  updated_at: string;
  merged_at: string | null;
  additions: number | null;
  deletions: number | null;
  changed_files: number | null;
  repo_id: string;
}

interface ReviewDb {
  id: number;
  pull_request_id: number;
  reviewer_github_id: number;
  state: string;
  submitted_at: string;
}

interface CommentDb {
  id: number;
  pull_request_id: number;
  commenter_github_id: number;
  in_reply_to_id: number | null;
  path: string | null;
  created_at: string;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (1 - (idx - lo)) + sorted[hi] * (idx - lo);
}

function computeDelta(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

function kpi(current: number | null, previous: number | null): KpiMetric {
  return { value: current, delta: computeDelta(current, previous) };
}

function isoWeekStart(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day; // shift to Monday
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function isoDate(dateStr: string): string {
  return new Date(dateStr).toISOString().slice(0, 10);
}

async function getBoardRepoIds(supabase: SupabaseClient, boardId: string): Promise<string[]> {
  const { data, error } = await supabase.from("github_repos").select("id").eq("board_id", boardId);
  if (error) throw error;
  return data.map((r) => r.id as string);
}

// The oldest `last_synced_at` across the board's repos — not the freshest `github_pull_requests
// .fetched_at`, which only moves when a sync actually finds upstream changes. An incremental sync
// (the classification-batch Workflow's `since` cursor) can legitimately complete with nothing new
// to fetch, leaving `fetched_at` stale even though the sync itself ran moments ago. Any repo that
// has never completed a sync (`last_synced_at IS NULL`) makes the whole board read as un-synced,
// since the board isn't fully fresh until every connected repo has synced at least once.
async function getBoardLastSyncedAt(supabase: SupabaseClient, repoIds: string[]): Promise<string | null> {
  if (repoIds.length === 0) return null;
  const { data, error } = await supabase.from("github_repos").select("last_synced_at").in("id", repoIds);
  if (error) throw error;
  const timestamps = (data as { last_synced_at: string | null }[]).map((r) => r.last_synced_at);
  const synced = timestamps.filter((t): t is string => t !== null);
  if (synced.length !== timestamps.length) return null;
  return synced.reduce<string | null>((oldest, t) => (oldest === null || t < oldest ? t : oldest), null);
}

async function getAllBoardPrs(supabase: SupabaseClient, repoIds: string[]): Promise<PrDb[]> {
  if (repoIds.length === 0) return [];
  const { data, error } = await supabase
    .from("github_pull_requests")
    .select(
      "id,number,title,state,author_github_id,author_login,is_draft,created_at,updated_at,merged_at,additions,deletions,changed_files,repo_id",
    )
    .in("repo_id", repoIds);
  if (error) throw error;
  return data;
}

// ── getImpactSummary ─────────────────────────────────────────────────────────

export async function getImpactSummary(
  supabase: SupabaseClient,
  boardId: string,
  githubId: number,
  dateRange: DateRange,
): Promise<ImpactSummary> {
  const repoIds = await getBoardRepoIds(supabase, boardId);
  if (repoIds.length === 0) return emptyImpactSummary();

  const [allPrs, lastSyncedAt] = await Promise.all([
    getAllBoardPrs(supabase, repoIds),
    getBoardLastSyncedAt(supabase, repoIds),
  ]);
  const boardPrIds = allPrs.map((p) => p.id);

  if (boardPrIds.length === 0) return { ...emptyImpactSummary(), lastSyncedAt };

  const prMap = new Map(
    allPrs.map((p) => [p.id, { createdAt: p.created_at, mergedAt: p.merged_at, authorGithubId: p.author_github_id }]),
  );

  // Fetch reviews and root comments covering both periods in one trip
  const earliestStart = dateRange.previousStart ?? dateRange.start;
  const earliestIso = earliestStart?.toISOString() ?? "1970-01-01T00:00:00.000Z";
  const endIso = dateRange.end.toISOString();

  const reviewsQ = supabase.rpc("get_board_reviews_for_reviewer", {
    p_repo_ids: repoIds,
    p_reviewer_github_id: githubId,
    p_start: earliestStart ? earliestIso : null,
    p_end: endIso,
  });

  const commentsQ = supabase.rpc("get_board_root_comments_for_commenter", {
    p_repo_ids: repoIds,
    p_commenter_github_id: githubId,
    p_start: earliestStart ? earliestIso : null,
    p_end: endIso,
  });

  const [reviewsResult, commentsResult] = await Promise.all([reviewsQ, commentsQ]);
  if (reviewsResult.error) throw reviewsResult.error;
  if (commentsResult.error) throw commentsResult.error;

  const allReviews = reviewsResult.data as {
    id: number;
    pull_request_id: number;
    submitted_at: string;
  }[];
  const allRootComments = commentsResult.data as {
    id: number;
    pull_request_id: number;
    created_at: string;
  }[];

  function computePeriod(start: Date | null, end: Date) {
    const startIso = start?.toISOString() ?? "1970-01-01T00:00:00.000Z";
    const endIso = end.toISOString();

    // Authored PRs in period
    let prCount = 0;
    const mergeTimesHours: number[] = [];
    for (const pr of prMap.values()) {
      if (pr.authorGithubId !== githubId) continue;
      if (start && pr.createdAt < startIso) continue;
      if (pr.createdAt > endIso) continue;
      prCount++;
      if (pr.mergedAt) {
        const h = (new Date(pr.mergedAt).getTime() - new Date(pr.createdAt).getTime()) / 3_600_000;
        if (h >= 0) mergeTimesHours.push(h);
      }
    }

    // Reviews in period — exclude reviews on own PRs (same guard as getReviewerMetrics)
    let reviewCount = 0;
    const reviewedPrIds = new Set<number>();
    const firstReviewByPr = new Map<number, string>();
    for (const r of allReviews) {
      if (start && r.submitted_at < startIso) continue;
      if (r.submitted_at > endIso) continue;
      if (prMap.get(r.pull_request_id)?.authorGithubId === githubId) continue;
      reviewCount++;
      const prId = r.pull_request_id;
      reviewedPrIds.add(prId);
      const prev = firstReviewByPr.get(prId);
      if (!prev || r.submitted_at < prev) firstReviewByPr.set(prId, r.submitted_at);
    }

    // Pickup times
    const pickupTimesHours: number[] = [];
    for (const [prId, firstReview] of firstReviewByPr) {
      const pr = prMap.get(prId);
      if (!pr) continue;
      const h = (new Date(firstReview).getTime() - new Date(pr.createdAt).getTime()) / 3_600_000;
      if (h >= 0) pickupTimesHours.push(h);
    }

    // Root comments (threads started) in period — exclude comments on own PRs
    let threadCount = 0;
    const threadPrIds = new Set<number>();
    for (const c of allRootComments) {
      if (start && c.created_at < startIso) continue;
      if (c.created_at > endIso) continue;
      if (prMap.get(c.pull_request_id)?.authorGithubId === githubId) continue;
      threadCount++;
      threadPrIds.add(c.pull_request_id);
    }

    // Discussion ratio: % of reviewed PRs where contributor also started a thread
    const sparkCount = [...reviewedPrIds].filter((id) => threadPrIds.has(id)).length;
    const discussionRatio = reviewedPrIds.size > 0 ? Math.round((sparkCount / reviewedPrIds.size) * 100) : null;

    const sortedMerge = [...mergeTimesHours].sort((a, b) => a - b);
    const sortedPickup = [...pickupTimesHours].sort((a, b) => a - b);

    return {
      prCount,
      reviewCount,
      threadCount,
      discussionRatio,
      medianMerge: percentile(sortedMerge, 50),
      medianPickup: percentile(sortedPickup, 50),
    };
  }

  const cur = computePeriod(dateRange.start, dateRange.end);
  const prev = dateRange.previousStart !== null ? computePeriod(dateRange.previousStart, dateRange.previousEnd) : null;

  return {
    prsAuthored: kpi(cur.prCount, prev?.prCount ?? null),
    reviewsGiven: kpi(cur.reviewCount, prev?.reviewCount ?? null),
    threadsStarted: kpi(cur.threadCount, prev?.threadCount ?? null),
    medianTimeToMerge: kpi(cur.medianMerge, prev?.medianMerge ?? null),
    medianPickupTime: kpi(cur.medianPickup, prev?.medianPickup ?? null),
    discussionRatio: kpi(cur.discussionRatio, prev?.discussionRatio ?? null),
    lastSyncedAt,
  };
}

function emptyImpactSummary(): ImpactSummary {
  const z: KpiMetric = { value: 0, delta: null };
  return {
    prsAuthored: z,
    reviewsGiven: z,
    threadsStarted: z,
    medianTimeToMerge: { value: null, delta: null },
    medianPickupTime: { value: null, delta: null },
    discussionRatio: z,
    lastSyncedAt: null,
  };
}

// ── getAuthorMetrics ─────────────────────────────────────────────────────────

export async function getAuthorMetrics(
  supabase: SupabaseClient,
  boardId: string,
  githubId: number,
  dateRange: DateRange,
): Promise<AuthorMetrics> {
  const repoIds = await getBoardRepoIds(supabase, boardId);
  if (repoIds.length === 0) return emptyAuthorMetrics();

  let q = supabase
    .from("github_pull_requests")
    .select("id,state,is_draft,created_at,merged_at,additions,deletions,changed_files")
    .in("repo_id", repoIds)
    .eq("author_github_id", githubId)
    .lte("created_at", dateRange.end.toISOString());
  if (dateRange.start) q = q.gte("created_at", dateRange.start.toISOString());

  const { data, error } = await q;
  if (error) throw error;

  const prs = data as {
    id: number;
    state: string;
    is_draft: boolean;
    created_at: string;
    merged_at: string | null;
    additions: number | null;
    deletions: number | null;
    changed_files: number | null;
  }[];

  const counts = { open: 0, merged: 0, closed: 0, draft: 0 };
  for (const pr of prs) {
    if (pr.is_draft) {
      counts.draft++;
      continue;
    }
    if (pr.state === "merged") counts.merged++;
    else if (pr.state === "open") counts.open++;
    else counts.closed++;
  }

  const nonDraft = prs.filter((p) => !p.is_draft);
  const mergeRate = nonDraft.length > 0 ? Math.round((counts.merged / nonDraft.length) * 100) : null;

  const additions = prs.map((p) => p.additions).filter((n): n is number => n !== null);
  const deletions = prs.map((p) => p.deletions).filter((n): n is number => n !== null);
  const changedFiles = prs.map((p) => p.changed_files).filter((n): n is number => n !== null);

  const linesChanged = prs
    .filter((p) => p.additions !== null || p.deletions !== null)
    .map((p) => (p.additions ?? 0) + (p.deletions ?? 0))
    .sort((a, b) => a - b);

  const sizeBuckets =
    linesChanged.length > 0
      ? linesChanged.reduce(
          (acc, n) => {
            if (n <= 10) acc.xs++;
            else if (n <= 50) acc.s++;
            else if (n <= 200) acc.m++;
            else if (n <= 500) acc.l++;
            else acc.xl++;
            return acc;
          },
          { xs: 0, s: 0, m: 0, l: 0, xl: 0 },
        )
      : null;

  const mergeTimesHours = prs
    .filter((p): p is typeof p & { merged_at: string } => p.merged_at !== null)
    .map((p) => (new Date(p.merged_at).getTime() - new Date(p.created_at).getTime()) / 3_600_000)
    .filter((h) => h >= 0)
    .sort((a, b) => a - b);

  return {
    prsByState: { ...counts, total: prs.length },
    mergeRate,
    prSize: {
      totalAdditions: additions.length > 0 ? additions.reduce((s, n) => s + n, 0) : null,
      totalDeletions: deletions.length > 0 ? deletions.reduce((s, n) => s + n, 0) : null,
      totalChangedFiles: changedFiles.length > 0 ? changedFiles.reduce((s, n) => s + n, 0) : null,
      medianAdditions: percentile(
        [...additions].sort((a, b) => a - b),
        50,
      ),
      medianDeletions: percentile(
        [...deletions].sort((a, b) => a - b),
        50,
      ),
      medianChangedLines: percentile(linesChanged, 50),
      sizeBuckets,
    },
    timeToMerge: {
      p50: percentile(mergeTimesHours, 50),
      p75: percentile(mergeTimesHours, 75),
      p90: percentile(mergeTimesHours, 90),
    },
  };
}

function emptyAuthorMetrics(): AuthorMetrics {
  return {
    prsByState: { open: 0, merged: 0, closed: 0, draft: 0, total: 0 },
    mergeRate: null,
    prSize: {
      totalAdditions: null,
      totalDeletions: null,
      totalChangedFiles: null,
      medianAdditions: null,
      medianDeletions: null,
      medianChangedLines: null,
      sizeBuckets: null,
    },
    timeToMerge: { p50: null, p75: null, p90: null },
  };
}

// ── getReviewerMetrics ───────────────────────────────────────────────────────

export async function getReviewerMetrics(
  supabase: SupabaseClient,
  boardId: string,
  githubId: number,
  dateRange: DateRange,
): Promise<ReviewerMetrics> {
  const repoIds = await getBoardRepoIds(supabase, boardId);
  if (repoIds.length === 0) return emptyReviewerMetrics();

  const allPrs = await getAllBoardPrs(supabase, repoIds);
  const boardPrIds = allPrs.map((p) => p.id);
  if (boardPrIds.length === 0) return emptyReviewerMetrics();

  const prAuthorMap = new Map(allPrs.map((p) => [p.id, p.author_github_id]));
  const prCreatedAtMap = new Map(allPrs.map((p) => [p.id, p.created_at]));

  const startIso = dateRange.start?.toISOString() ?? "1970-01-01T00:00:00.000Z";
  const endIso = dateRange.end.toISOString();

  const reviewsResult = await supabase.rpc("get_board_reviews_for_reviewer", {
    p_repo_ids: repoIds,
    p_reviewer_github_id: githubId,
    p_start: dateRange.start ? startIso : null,
    p_end: endIso,
  });
  if (reviewsResult.error) throw reviewsResult.error;

  const reviews = reviewsResult.data as ReviewDb[];

  const verdicts = { approved: 0, changesRequested: 0, commented: 0, dismissed: 0 };
  const reviewedPrIds = new Set<number>();
  const firstReviewByPr = new Map<number, string>();

  for (const r of reviews) {
    if (prAuthorMap.get(r.pull_request_id) === githubId) continue; // skip own PRs
    switch (r.state.toUpperCase()) {
      case "APPROVED":
        verdicts.approved++;
        break;
      case "CHANGES_REQUESTED":
        verdicts.changesRequested++;
        break;
      case "COMMENTED":
        verdicts.commented++;
        break;
      case "DISMISSED":
        verdicts.dismissed++;
        break;
    }
    const prId = r.pull_request_id;
    reviewedPrIds.add(prId);
    const prev = firstReviewByPr.get(prId);
    if (!prev || r.submitted_at < prev) firstReviewByPr.set(prId, r.submitted_at);
  }

  const pickupTimesHours = Array.from(firstReviewByPr.entries())
    .map(([prId, first]) => {
      const createdAt = prCreatedAtMap.get(prId);
      if (!createdAt) return null;
      const h = (new Date(first).getTime() - new Date(createdAt).getTime()) / 3_600_000;
      return h >= 0 ? h : null;
    })
    .filter((h): h is number => h !== null)
    .sort((a, b) => a - b);

  const histogram = { under1h: 0, h1to4: 0, h4to24: 0, d1to3: 0, over3d: 0 };
  for (const h of pickupTimesHours) {
    if (h < 1) histogram.under1h++;
    else if (h < 4) histogram.h1to4++;
    else if (h < 24) histogram.h4to24++;
    else if (h < 72) histogram.d1to3++;
    else histogram.over3d++;
  }

  const boardPrsExcludingOwn = allPrs.filter((p) => p.author_github_id !== githubId);
  const involvementPercent =
    boardPrsExcludingOwn.length > 0 ? Math.round((reviewedPrIds.size / boardPrsExcludingOwn.length) * 100) : null;

  const collaboratorIds = new Set(
    Array.from(reviewedPrIds)
      .map((id) => prAuthorMap.get(id))
      .filter((id): id is number => id !== undefined && id !== githubId),
  );

  // Thread metrics — fetch all comments for reviewed PRs
  const reviewedPrIdsList = Array.from(reviewedPrIds);
  let threadMetrics = emptyThreadMetrics();
  if (reviewedPrIdsList.length > 0) {
    const { data: commentData, error: commentsError } = await supabase
      .from("github_review_comments")
      .select("id,pull_request_id,commenter_github_id,in_reply_to_id,path,created_at")
      .in("pull_request_id", reviewedPrIdsList);
    if (commentsError) throw commentsError;
    threadMetrics = computeThreadMetrics(commentData, reviewedPrIds, githubId, prAuthorMap, dateRange);
  }

  return {
    reviewsByVerdict: {
      ...verdicts,
      total: reviews.filter((r) => prAuthorMap.get(r.pull_request_id) !== githubId).length,
    },
    pickupTime: {
      p50: percentile(pickupTimesHours, 50),
      p75: percentile(pickupTimesHours, 75),
      p90: percentile(pickupTimesHours, 90),
      histogram,
    },
    involvementPercent,
    uniquePrsReviewed: reviewedPrIds.size,
    uniqueCollaborators: collaboratorIds.size,
    ...threadMetrics,
  };
}

function computeThreadMetrics(
  allComments: CommentDb[],
  reviewedPrIds: Set<number>,
  githubId: number,
  prAuthorMap: Map<number, number>,
  dateRange: DateRange,
) {
  if (allComments.length === 0) return emptyThreadMetrics();

  const startIso = dateRange.start?.toISOString() ?? "1970-01-01T00:00:00.000Z";
  const endIso = dateRange.end.toISOString();

  const commentMap = new Map(allComments.map((c) => [c.id, c]));

  // Group all comments by COALESCE(in_reply_to_id, id) → thread root id
  const threads = new Map<number, CommentDb[]>();
  for (const c of allComments) {
    const key = c.in_reply_to_id ?? c.id;
    const bucket = threads.get(key);
    if (bucket) bucket.push(c);
    else threads.set(key, [c]);
  }

  let threadsStarted = 0;
  let totalDepth = 0;
  let deepCount = 0;
  let multiPersonCount = 0;
  let inlineCount = 0;
  let authorEngagedCount = 0;
  let totalFirstReplyHours = 0;
  let firstReplyCount = 0;
  const sparkPrs = new Set<number>();

  for (const [rootId, members] of threads) {
    const root = commentMap.get(rootId);
    if (root?.in_reply_to_id !== null) continue; // not a true root
    if (root.commenter_github_id !== githubId) continue; // only threads started by contributor
    if (dateRange.start && root.created_at < startIso) continue;
    if (root.created_at > endIso) continue;

    threadsStarted++;
    sparkPrs.add(root.pull_request_id);

    const depth = members.length;
    totalDepth += depth;
    if (depth >= 3) deepCount++;

    const participants = new Set(members.map((m) => m.commenter_github_id));
    if (participants.size >= 2) multiPersonCount++;
    if (root.path !== null) inlineCount++;

    const prAuthorId = prAuthorMap.get(root.pull_request_id);
    if (prAuthorId !== undefined) {
      const authorReplied = members.some((m) => m.commenter_github_id === prAuthorId && m.id !== rootId);
      if (authorReplied) authorEngagedCount++;
    }

    if (depth > 1) {
      const replies = members.filter((m) => m.id !== rootId).sort((a, b) => a.created_at.localeCompare(b.created_at));
      const h = (new Date(replies[0].created_at).getTime() - new Date(root.created_at).getTime()) / 3_600_000;
      if (h >= 0) {
        totalFirstReplyHours += h;
        firstReplyCount++;
      }
    }
  }

  return {
    threadsStarted,
    avgThreadDepth: threadsStarted > 0 ? totalDepth / threadsStarted : null,
    discussionSparkingRatio: reviewedPrIds.size > 0 ? Math.round((sparkPrs.size / reviewedPrIds.size) * 100) : null,
    deepDiscussionsCount: deepCount,
    multiPersonThreadsCount: multiPersonCount,
    inlineThreadRatio: threadsStarted > 0 ? Math.round((inlineCount / threadsStarted) * 100) : null,
    authorEngagementPercent: threadsStarted > 0 ? Math.round((authorEngagedCount / threadsStarted) * 100) : null,
    avgFirstReplyTimeHours: firstReplyCount > 0 ? totalFirstReplyHours / firstReplyCount : null,
    threadsPerReviewedPr: reviewedPrIds.size > 0 ? threadsStarted / reviewedPrIds.size : null,
  };
}

function emptyThreadMetrics() {
  return {
    threadsStarted: 0,
    avgThreadDepth: null as number | null,
    discussionSparkingRatio: null as number | null,
    deepDiscussionsCount: 0,
    multiPersonThreadsCount: 0,
    inlineThreadRatio: null as number | null,
    authorEngagementPercent: null as number | null,
    avgFirstReplyTimeHours: null as number | null,
    threadsPerReviewedPr: null as number | null,
  };
}

function emptyReviewerMetrics(): ReviewerMetrics {
  return {
    reviewsByVerdict: { approved: 0, changesRequested: 0, commented: 0, dismissed: 0, total: 0 },
    pickupTime: {
      p50: null,
      p75: null,
      p90: null,
      histogram: { under1h: 0, h1to4: 0, h4to24: 0, d1to3: 0, over3d: 0 },
    },
    involvementPercent: null,
    uniquePrsReviewed: 0,
    uniqueCollaborators: 0,
    ...emptyThreadMetrics(),
  };
}

// ── getActivityData ──────────────────────────────────────────────────────────

export async function getActivityData(
  supabase: SupabaseClient,
  boardId: string,
  githubId: number,
  dateRange: DateRange,
): Promise<ActivityData> {
  // Fetch repos (with names for URL construction and display)
  const { data: reposData, error: reposError } = await supabase
    .from("github_repos")
    .select("id,repo_owner,repo_name")
    .eq("board_id", boardId);
  if (reposError) throw reposError;

  const repos = reposData as { id: string; repo_owner: string; repo_name: string }[];
  if (repos.length === 0) return emptyActivityData();

  const repoIds = repos.map((r) => r.id);
  const repoNameMap = new Map(repos.map((r) => [r.id, `${r.repo_owner}/${r.repo_name}`]));
  const repoOwnerRepoMap = new Map(repos.map((r) => [r.id, { owner: r.repo_owner, name: r.repo_name }]));

  // Heatmap always covers last 52 weeks; use the earlier of dateRange.start and 52-week mark
  const heatmapStart = new Date(Date.now() - 364 * 24 * 60 * 60 * 1000);
  const effectiveStart =
    dateRange.start === null ? null : dateRange.start < heatmapStart ? dateRange.start : heatmapStart;
  const effectiveStartIso = effectiveStart?.toISOString() ?? "1970-01-01T00:00:00.000Z";
  const endIso = dateRange.end.toISOString();
  const periodStartIso = dateRange.start?.toISOString() ?? "1970-01-01T00:00:00.000Z";

  // Fetch all board PRs (for lookups — no date filter so we can look up PR details for reviewed PRs)
  const allPrs = await getAllBoardPrs(supabase, repoIds);
  const prMap = new Map(allPrs.map((p) => [p.id, p]));
  const boardPrIds = allPrs.map((p) => p.id);

  if (boardPrIds.length === 0) return emptyActivityData();

  // Reviews and root comments for the contributor (covering heatmap range)
  const reviewsQ = supabase.rpc("get_board_reviews_for_reviewer", {
    p_repo_ids: repoIds,
    p_reviewer_github_id: githubId,
    p_start: effectiveStart ? effectiveStartIso : null,
    p_end: endIso,
  });

  const commentsQ = supabase.rpc("get_board_root_comments_for_commenter", {
    p_repo_ids: repoIds,
    p_commenter_github_id: githubId,
    p_start: effectiveStart ? effectiveStartIso : null,
    p_end: endIso,
  });

  // Board contributors for avatar lookup
  const contributorsQ = supabase.from("board_contributors").select("github_login,avatar_url").eq("board_id", boardId);

  const [reviewsResult, commentsResult, contributorsResult] = await Promise.all([reviewsQ, commentsQ, contributorsQ]);
  if (reviewsResult.error) throw reviewsResult.error;
  if (commentsResult.error) throw commentsResult.error;
  if (contributorsResult.error) throw contributorsResult.error;

  const reviews = reviewsResult.data as { id: number; pull_request_id: number; submitted_at: string }[];
  const rootComments = commentsResult.data as { id: number; pull_request_id: number; created_at: string }[];
  const avatarMap = new Map(
    contributorsResult.data.map((c) => [c.github_login as string, c.avatar_url as string | null]),
  );

  // ── weekly activity (period-filtered) ────────────────────────────────────
  const weeklyMap = new Map<string, { prs: number; reviews: number; threads: number }>();

  function addWeek(dateStr: string, field: "prs" | "reviews" | "threads") {
    if (dateStr < periodStartIso || dateStr > endIso) return;
    const w = isoWeekStart(new Date(dateStr));
    const entry = weeklyMap.get(w) ?? { prs: 0, reviews: 0, threads: 0 };
    entry[field]++;
    weeklyMap.set(w, entry);
  }

  // Authored PRs in period (from prMap)
  for (const pr of allPrs) {
    if (pr.author_github_id !== githubId) continue;
    if (pr.created_at < periodStartIso || pr.created_at > endIso) continue;
    addWeek(pr.created_at, "prs");
  }
  for (const r of reviews) addWeek(r.submitted_at, "reviews");
  for (const c of rootComments) addWeek(c.created_at, "threads");

  const weeklyActivity: WeeklyActivity[] = Array.from(weeklyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, v]) => ({ week, ...v }));

  // ── daily heatmap (last 52 weeks) ────────────────────────────────────────
  const heatmapStartIso = heatmapStart.toISOString();
  const dailyMap = new Map<string, number>();

  function addDay(dateStr: string) {
    if (dateStr < heatmapStartIso || dateStr > endIso) return;
    const d = isoDate(dateStr);
    dailyMap.set(d, (dailyMap.get(d) ?? 0) + 1);
  }

  for (const pr of allPrs) {
    if (pr.author_github_id !== githubId) continue;
    addDay(pr.created_at);
  }
  for (const r of reviews) addDay(r.submitted_at);
  for (const c of rootComments) addDay(c.created_at);

  const dailyHeatmap: DailyActivity[] = Array.from(dailyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));

  // ── top collaborators (period-filtered reviews) ───────────────────────────
  const collaboratorPrCount = new Map<string, number>();
  for (const r of reviews) {
    if (r.submitted_at < periodStartIso || r.submitted_at > endIso) continue;
    const pr = prMap.get(r.pull_request_id);
    if (!pr || pr.author_github_id === githubId) continue;
    const login = pr.author_login;
    collaboratorPrCount.set(login, (collaboratorPrCount.get(login) ?? 0) + 1);
  }
  const topCollaborators: Collaborator[] = Array.from(collaboratorPrCount.entries())
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([login, prCount]) => ({ login, avatarUrl: avatarMap.get(login) ?? null, prCount }));

  // ── per-repo activity (period-filtered) ──────────────────────────────────
  const repoStats = new Map<string, { prCount: number; reviewCount: number; threadCount: number }>();

  for (const pr of allPrs) {
    if (pr.author_github_id !== githubId) continue;
    if (pr.created_at < periodStartIso || pr.created_at > endIso) continue;
    const name = repoNameMap.get(pr.repo_id) ?? pr.repo_id;
    const s = repoStats.get(name) ?? { prCount: 0, reviewCount: 0, threadCount: 0 };
    s.prCount++;
    repoStats.set(name, s);
  }
  for (const r of reviews) {
    if (r.submitted_at < periodStartIso || r.submitted_at > endIso) continue;
    const pr = prMap.get(r.pull_request_id);
    if (!pr) continue;
    const name = repoNameMap.get(pr.repo_id) ?? pr.repo_id;
    const s = repoStats.get(name) ?? { prCount: 0, reviewCount: 0, threadCount: 0 };
    s.reviewCount++;
    repoStats.set(name, s);
  }
  for (const c of rootComments) {
    if (c.created_at < periodStartIso || c.created_at > endIso) continue;
    const pr = prMap.get(c.pull_request_id);
    if (!pr) continue;
    const name = repoNameMap.get(pr.repo_id) ?? pr.repo_id;
    const s = repoStats.get(name) ?? { prCount: 0, reviewCount: 0, threadCount: 0 };
    s.threadCount++;
    repoStats.set(name, s);
  }
  const repoActivity: RepoActivity[] = Array.from(repoStats.entries())
    .sort(([, a], [, b]) => b.prCount + b.reviewCount - (a.prCount + a.reviewCount))
    .map(([repoName, v]) => ({ repoName, ...v }));

  // ── thread counts by PR (from root comments) ─────────────────────────────
  const threadsByPr = new Map<number, number>();
  for (const c of rootComments) {
    if (c.created_at < periodStartIso || c.created_at > endIso) continue;
    threadsByPr.set(c.pull_request_id, (threadsByPr.get(c.pull_request_id) ?? 0) + 1);
  }

  // ── recent authored PRs ───────────────────────────────────────────────────
  const authoredInPeriod = allPrs
    .filter((p) => p.author_github_id === githubId && p.created_at >= periodStartIso && p.created_at <= endIso)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, 10);

  // Fetch root comments by ALL commenters on authored PRs (for thread count)
  const authoredIds = authoredInPeriod.map((p) => p.id);
  const authoredThreadCounts = new Map<number, number>();
  if (authoredIds.length > 0) {
    const { data: authoredComments } = await supabase
      .from("github_review_comments")
      .select("pull_request_id")
      .in("pull_request_id", authoredIds)
      .is("in_reply_to_id", null);
    for (const c of authoredComments ?? []) {
      const prId = c.pull_request_id as number;
      authoredThreadCounts.set(prId, (authoredThreadCounts.get(prId) ?? 0) + 1);
    }
  }

  const recentAuthoredPrs: PrRow[] = authoredInPeriod.map((p) => {
    const repoInfo = repoOwnerRepoMap.get(p.repo_id);
    const timeToMergeHours = p.merged_at
      ? (new Date(p.merged_at).getTime() - new Date(p.created_at).getTime()) / 3_600_000
      : null;
    return {
      id: p.id,
      number: p.number,
      title: p.title,
      repo: repoNameMap.get(p.repo_id) ?? p.repo_id,
      state: p.state,
      additions: p.additions,
      deletions: p.deletions,
      threadCount: authoredThreadCounts.get(p.id) ?? 0,
      timeToMergeHours,
      updatedAt: p.updated_at,
      url: repoInfo ? `https://github.com/${repoInfo.owner}/${repoInfo.name}/pull/${p.number}` : "",
    };
  });

  // ── recent reviewed PRs ───────────────────────────────────────────────────
  const reviewedPrIdsInPeriod = new Set(
    reviews.filter((r) => r.submitted_at >= periodStartIso && r.submitted_at <= endIso).map((r) => r.pull_request_id),
  );

  const recentReviewedPrs: PrRow[] = Array.from(reviewedPrIdsInPeriod)
    .map((prId) => prMap.get(prId))
    .filter((p): p is PrDb => p !== undefined && p.author_github_id !== githubId)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, 10)
    .map((p) => {
      const repoInfo = repoOwnerRepoMap.get(p.repo_id);
      const timeToMergeHours = p.merged_at
        ? (new Date(p.merged_at).getTime() - new Date(p.created_at).getTime()) / 3_600_000
        : null;
      return {
        id: p.id,
        number: p.number,
        title: p.title,
        repo: repoNameMap.get(p.repo_id) ?? p.repo_id,
        state: p.state,
        additions: p.additions,
        deletions: p.deletions,
        threadCount: threadsByPr.get(p.id) ?? 0,
        timeToMergeHours,
        updatedAt: p.updated_at,
        url: repoInfo ? `https://github.com/${repoInfo.owner}/${repoInfo.name}/pull/${p.number}` : "",
      };
    });

  return { weeklyActivity, dailyHeatmap, topCollaborators, repoActivity, recentAuthoredPrs, recentReviewedPrs };
}

function emptyActivityData(): ActivityData {
  return {
    weeklyActivity: [],
    dailyHeatmap: [],
    topCollaborators: [],
    repoActivity: [],
    recentAuthoredPrs: [],
    recentReviewedPrs: [],
  };
}
