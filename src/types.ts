export type BoardRole = "supervisor" | "contributor";

export interface Board {
  id: string;
  name: string;
  ownerUserId: string;
  createdAt: string;
  updatedAt: string;
}

export type UserBoard = Board & { role: BoardRole };

export interface GitHubRepo {
  id: string;
  boardId: string;
  repoOwner: string;
  repoName: string;
  connectedAt: string;
  connectedBy: string;
}

export interface GitHubPullRequest {
  id: number;
  repoId: string;
  number: number;
  title: string;
  state: string;
  authorLogin: string;
  authorGithubId: number;
  isDraft: boolean;
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  fetchedAt: string;
  additions: number | null;
  deletions: number | null;
  changedFiles: number | null;
}

export interface GitHubReview {
  id: number;
  pullRequestId: number;
  reviewerLogin: string;
  reviewerGithubId: number;
  state: string;
  submittedAt: string;
  fetchedAt: string;
}

export interface BoardContributor {
  boardId: string;
  githubId: number;
  githubLogin: string;
  avatarUrl: string | null;
  userId: string | null;
  addedAt: string;
}

export interface GitHubReviewComment {
  id: number;
  pullRequestId: number;
  reviewId: number | null;
  commenterLogin: string;
  commenterGithubId: number;
  body: string;
  path: string | null;
  positionLine: number | null;
  positionSide: string | null;
  createdAt: string;
  updatedAt: string;
  fetchedAt: string;
  inReplyToId: number | null;
}

export type IntentCategory =
  | "mentoring"
  | "architecture"
  | "bug-catch"
  | "nitpick"
  | "unblocking"
  | "question"
  | "praise"
  | "joke"
  | "self-review"
  | "unknown";

export type TechnicalDomain = "functional" | "refactoring" | "documentation" | "discussion" | "false-positive";

export interface ThreadClassification {
  threadRootCommentId: number;
  pullRequestId: number;
  intent: IntentCategory;
  domain: TechnicalDomain;
  modelId: string;
  classifiedAt: string;
}

export type PeriodSlug = "7d" | "30d" | "90d" | "6m" | "ytd" | "all";

export interface DateRange {
  start: Date | null;
  end: Date;
  previousStart: Date | null;
  previousEnd: Date;
}

export interface KpiMetric {
  value: number | null;
  delta: number | null;
}

export interface ImpactSummary {
  prsAuthored: KpiMetric;
  reviewsGiven: KpiMetric;
  threadsStarted: KpiMetric;
  medianTimeToMerge: KpiMetric;
  medianPickupTime: KpiMetric;
  discussionRatio: KpiMetric;
  lastSyncedAt: string | null;
}

export interface AuthorMetrics {
  prsByState: {
    open: number;
    merged: number;
    closed: number;
    draft: number;
    total: number;
  };
  mergeRate: number | null;
  prSize: {
    totalAdditions: number | null;
    totalDeletions: number | null;
    totalChangedFiles: number | null;
    medianAdditions: number | null;
    medianDeletions: number | null;
    medianChangedLines: number | null;
    sizeBuckets: { xs: number; s: number; m: number; l: number; xl: number } | null;
  };
  timeToMerge: {
    p50: number | null;
    p75: number | null;
    p90: number | null;
  };
}

export interface ReviewerMetrics {
  reviewsByVerdict: {
    approved: number;
    changesRequested: number;
    commented: number;
    dismissed: number;
    total: number;
  };
  pickupTime: {
    p50: number | null;
    p75: number | null;
    p90: number | null;
    histogram: {
      under1h: number;
      h1to4: number;
      h4to24: number;
      d1to3: number;
      over3d: number;
    };
  };
  involvementPercent: number | null;
  uniquePrsReviewed: number;
  uniqueCollaborators: number;
  threadsStarted: number;
  avgThreadDepth: number | null;
  discussionSparkingRatio: number | null;
  deepDiscussionsCount: number;
  multiPersonThreadsCount: number;
  inlineThreadRatio: number | null;
  authorEngagementPercent: number | null;
  avgFirstReplyTimeHours: number | null;
  threadsPerReviewedPr: number | null;
}

export interface WeeklyActivity {
  week: string;
  prs: number;
  reviews: number;
  threads: number;
}

export interface DailyActivity {
  date: string;
  count: number;
}

export interface Collaborator {
  login: string;
  avatarUrl: string | null;
  prCount: number;
}

export interface RepoActivity {
  repoName: string;
  prCount: number;
  reviewCount: number;
  threadCount: number;
}

export interface PrRow {
  id: number;
  number: number;
  title: string;
  repo: string;
  state: string;
  additions: number | null;
  deletions: number | null;
  threadCount: number;
  timeToMergeHours: number | null;
  updatedAt: string;
  url: string;
}

export interface ActivityData {
  weeklyActivity: WeeklyActivity[];
  dailyHeatmap: DailyActivity[];
  topCollaborators: Collaborator[];
  repoActivity: RepoActivity[];
  recentAuthoredPrs: PrRow[];
  recentReviewedPrs: PrRow[];
}
