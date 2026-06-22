import { describe, it, expect, vi } from "vitest";
import type { DateRange } from "@/types";
import { getImpactSummary, getAuthorMetrics } from "@/lib/services/impact-metrics";

// Creates a chainable mock builder that resolves to `result` when awaited.
function makeBuilder(result: { data: unknown[] | null; error: null | { message: string } }) {
  const self: Record<string, unknown> = {
    then(resolve?: (v: typeof result) => unknown, reject?: (e: unknown) => unknown) {
      return Promise.resolve(result).then(resolve ?? undefined, reject ?? undefined);
    },
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
  for (const m of ["select", "eq", "neq", "in", "gte", "lte", "is", "order", "limit", "not"]) {
    self[m] = vi.fn().mockReturnValue(self);
  }
  return self;
}

// RPCs replace direct .in("pull_request_id", boardPrIds) queries on these tables —
// route them back to the same canned table data the tests already supply.
const RPC_TABLE: Record<string, string> = {
  get_board_reviews_for_reviewer: "github_reviews",
  get_board_root_comments_for_commenter: "github_review_comments",
};

function makeMockClient(tables: Record<string, { data: unknown[]; error: null }>) {
  return {
    from: vi.fn().mockImplementation((table: string) => makeBuilder(tables[table] ?? { data: [], error: null })),
    rpc: vi.fn().mockImplementation((fn: string) => {
      const table = RPC_TABLE[fn];
      return Promise.resolve(table ? (tables[table] ?? { data: [], error: null }) : { data: [], error: null });
    }),
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) },
  };
}

// Fixed reference values (not frozen — just constants)
const GITHUB_ID = 42;
const BOARD_ID = "00000000-0000-0000-0000-000000000001";
const NOW = new Date("2025-10-15T12:00:00.000Z");
const DAY = 86_400_000;

const dateRange: DateRange = {
  start: new Date(NOW.getTime() - 90 * DAY), // 2025-07-17
  end: NOW, // 2025-10-15
  previousStart: new Date(NOW.getTime() - 180 * DAY), // 2025-04-18
  previousEnd: new Date(NOW.getTime() - 90 * DAY), // 2025-07-17
};

const D30 = new Date(NOW.getTime() - 30 * DAY).toISOString(); // 2025-09-15 (current period)
const D28 = new Date(NOW.getTime() - 28 * DAY).toISOString(); // 2025-09-17
const D27 = new Date(NOW.getTime() - 27 * DAY).toISOString(); // 2025-09-18
const D25 = new Date(NOW.getTime() - 25 * DAY).toISOString(); // 2025-09-20
const D120 = new Date(NOW.getTime() - 120 * DAY).toISOString(); // 2025-06-17 (previous period)

const repos = [{ id: "repo-1", last_synced_at: NOW.toISOString() }];

const basePr = {
  id: 1,
  number: 1,
  title: "Fix bug",
  state: "merged",
  author_github_id: GITHUB_ID,
  author_login: "alice",
  is_draft: false,
  created_at: D30,
  updated_at: D25,
  merged_at: D25,
  additions: 100,
  deletions: 40,
  changed_files: 5,
  repo_id: "repo-1",
};

// ── getImpactSummary ──────────────────────────────────────────────────────────

describe("getImpactSummary (hermetic)", () => {
  it("returns zeroed summary when board has no repos", async () => {
    const client = makeMockClient({ github_repos: { data: [], error: null } });
    const result = await getImpactSummary(client as never, BOARD_ID, GITHUB_ID, dateRange);

    expect(result.prsAuthored.value).toBe(0);
    expect(result.reviewsGiven.value).toBe(0);
    expect(result.lastSyncedAt).toBeNull();
  });

  it("happy path: counts PRs/reviews/threads and computes KPI values correctly", async () => {
    const client = makeMockClient({
      github_repos: { data: repos, error: null },
      // basePr is authored by GITHUB_ID; reviews/threads must be on a *different* person's PR
      github_pull_requests: {
        data: [basePr, { ...basePr, id: 2, author_github_id: 99, author_login: "bob" }],
        error: null,
      },
      github_reviews: {
        data: [{ id: 10, pull_request_id: 2, reviewer_github_id: GITHUB_ID, state: "APPROVED", submitted_at: D28 }],
        error: null,
      },
      github_review_comments: {
        data: [
          {
            id: 100,
            pull_request_id: 2,
            commenter_github_id: GITHUB_ID,
            in_reply_to_id: null,
            path: "src/a.ts",
            created_at: D27,
          },
        ],
        error: null,
      },
    });

    const result = await getImpactSummary(client as never, BOARD_ID, GITHUB_ID, dateRange);

    expect(result.prsAuthored.value).toBe(1);
    expect(result.reviewsGiven.value).toBe(1);
    expect(result.threadsStarted.value).toBe(1);
    // D30 → D25 = 5 days = 120 h
    expect(result.medianTimeToMerge.value).toBe(120);
    // D28 review on PR created D30 = 2 days = 48 h
    expect(result.medianPickupTime.value).toBe(48);
    // reviewed 1 PR, started thread in same PR → 100%
    expect(result.discussionRatio.value).toBe(100);
    // previous period has 0 PRs → delta cannot be computed
    expect(result.prsAuthored.delta).toBeNull();
    expect(result.lastSyncedAt).toBe(NOW.toISOString());
  });

  it("lastSyncedAt is the oldest last_synced_at across the board's repos, not the freshest", async () => {
    const olderSync = new Date(NOW.getTime() - 2 * DAY).toISOString();
    const twoRepos = [
      { id: "repo-1", last_synced_at: NOW.toISOString() },
      { id: "repo-2", last_synced_at: olderSync },
    ];
    const client = makeMockClient({
      github_repos: { data: twoRepos, error: null },
      github_pull_requests: { data: [basePr], error: null },
      github_reviews: { data: [], error: null },
      github_review_comments: { data: [], error: null },
    });

    const result = await getImpactSummary(client as never, BOARD_ID, GITHUB_ID, dateRange);

    expect(result.lastSyncedAt).toBe(olderSync);
  });

  it("lastSyncedAt is null when any connected repo has never completed a sync", async () => {
    const neverSyncedRepos = [
      { id: "repo-1", last_synced_at: NOW.toISOString() },
      { id: "repo-2", last_synced_at: null },
    ];
    const client = makeMockClient({
      github_repos: { data: neverSyncedRepos, error: null },
      github_pull_requests: { data: [basePr], error: null },
      github_reviews: { data: [], error: null },
      github_review_comments: { data: [], error: null },
    });

    const result = await getImpactSummary(client as never, BOARD_ID, GITHUB_ID, dateRange);

    expect(result.lastSyncedAt).toBeNull();
  });

  it("delta is 0 when current and previous period counts are equal", async () => {
    // prev-period PR is 120d ago (within previousStart=180d … previousEnd=90d)
    const prevPr = { ...basePr, id: 2, created_at: D120, merged_at: null };
    const client = makeMockClient({
      github_repos: { data: repos, error: null },
      github_pull_requests: { data: [basePr, prevPr], error: null },
      github_reviews: { data: [], error: null },
      github_review_comments: { data: [], error: null },
    });

    const result = await getImpactSummary(client as never, BOARD_ID, GITHUB_ID, dateRange);

    expect(result.prsAuthored.value).toBe(1);
    expect(result.prsAuthored.delta).toBe(0); // (1-1)/1*100 = 0
  });

  it("delta is positive when current period outpaces previous", async () => {
    const prevPr = { ...basePr, id: 2, created_at: D120, merged_at: null };
    const extraCurrentPr = { ...basePr, id: 4, created_at: D27 };
    const client = makeMockClient({
      github_repos: { data: repos, error: null },
      github_pull_requests: { data: [basePr, extraCurrentPr, prevPr], error: null },
      github_reviews: { data: [], error: null },
      github_review_comments: { data: [], error: null },
    });

    const result = await getImpactSummary(client as never, BOARD_ID, GITHUB_ID, dateRange);

    // current=2, previous=1 → delta = (2-1)/1*100 = 100
    expect(result.prsAuthored.value).toBe(2);
    expect(result.prsAuthored.delta).toBe(100);
  });
});

// ── getAuthorMetrics ──────────────────────────────────────────────────────────

describe("getAuthorMetrics (hermetic)", () => {
  it("returns empty metrics when board has no repos", async () => {
    const client = makeMockClient({ github_repos: { data: [], error: null } });
    const result = await getAuthorMetrics(client as never, BOARD_ID, GITHUB_ID, dateRange);

    expect(result.prsByState.total).toBe(0);
    expect(result.mergeRate).toBeNull();
    expect(result.timeToMerge.p50).toBeNull();
  });

  it("classifies PR states correctly: draft is separate, closed ≠ merged", async () => {
    const mixedPrs = [
      { ...basePr, id: 1, state: "merged", is_draft: false, created_at: D30, merged_at: D25 },
      { ...basePr, id: 2, state: "open", is_draft: false, created_at: D28, merged_at: null },
      { ...basePr, id: 3, state: "closed", is_draft: false, created_at: D27, merged_at: null },
      { ...basePr, id: 4, state: "open", is_draft: true, created_at: D27, merged_at: null },
    ];
    const client = makeMockClient({
      github_repos: { data: repos, error: null },
      github_pull_requests: { data: mixedPrs, error: null },
    });

    const result = await getAuthorMetrics(client as never, BOARD_ID, GITHUB_ID, dateRange);

    expect(result.prsByState).toEqual({ open: 1, merged: 1, closed: 1, draft: 1, total: 4 });
    // 1 merged / 3 non-draft = 33%
    expect(result.mergeRate).toBe(33);
  });

  it("computes PR size totals and medians from additions/deletions", async () => {
    const sizePrs = [
      { ...basePr, id: 1, additions: 100, deletions: 40, merged_at: D25, created_at: D30 },
      { ...basePr, id: 2, additions: 30, deletions: 10, merged_at: null, created_at: D28 },
      { ...basePr, id: 3, additions: 5, deletions: 2, merged_at: null, created_at: D27 },
    ];
    const client = makeMockClient({
      github_repos: { data: repos, error: null },
      github_pull_requests: { data: sizePrs, error: null },
    });

    const result = await getAuthorMetrics(client as never, BOARD_ID, GITHUB_ID, dateRange);

    expect(result.prSize.totalAdditions).toBe(135); // 100+30+5
    expect(result.prSize.totalDeletions).toBe(52); // 40+10+2
    // sorted additions: [5, 30, 100], p50 idx=1.0 → 30
    expect(result.prSize.medianAdditions).toBe(30);
    // sorted deletions: [2, 10, 40], p50 idx=1.0 → 10
    expect(result.prSize.medianDeletions).toBe(10);
  });

  it("computes time-to-merge percentiles from merged PRs only", async () => {
    // 2 merged PRs: 5d (120h) and 10d (240h)
    const D10 = new Date(NOW.getTime() - 10 * DAY).toISOString();
    const D20 = new Date(NOW.getTime() - 20 * DAY).toISOString();
    const mergedPrs = [
      { ...basePr, id: 1, created_at: D30, merged_at: D25 }, // 5d = 120h
      { ...basePr, id: 2, created_at: D20, merged_at: D10 }, // 10d = 240h
    ];
    const client = makeMockClient({
      github_repos: { data: repos, error: null },
      github_pull_requests: { data: mergedPrs, error: null },
    });

    const result = await getAuthorMetrics(client as never, BOARD_ID, GITHUB_ID, dateRange);

    // sorted: [120, 240]
    // p50: idx = 0.5, lo=0, hi=1 → 120*0.5 + 240*0.5 = 180
    expect(result.timeToMerge.p50).toBe(180);
    // p75: idx = 0.75, lo=0, hi=1 → 120*0.25 + 240*0.75 = 30+180 = 210
    expect(result.timeToMerge.p75).toBe(210);
  });
});
