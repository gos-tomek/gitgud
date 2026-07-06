import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Octokit } from "@octokit/rest";
import type { createClient } from "@/lib/supabase";
import { syncPrBatch, GQL_PRS_PER_QUERY, type PrRef } from "@/lib/services/github-sync";

type SupabaseClient = NonNullable<ReturnType<typeof createClient>>;

const mockLogger = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: mockLogger }));

function makeFakeSupabase() {
  const rpcCalls: { name: string; args: unknown }[] = [];
  const upsertCalls: { table: string; rows: unknown[] }[] = [];
  const fake = {
    rpc: vi.fn((name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      return { data: null, error: null };
    }),
    from: vi.fn((table: string) => ({
      upsert: vi.fn((rows: unknown[]) => {
        upsertCalls.push({ table, rows });
        return { data: null, error: null };
      }),
    })),
  };
  return { supabase: fake as unknown as SupabaseClient, rpcCalls, upsertCalls };
}

function makeFakeOctokit() {
  const graphqlMock = vi.fn();
  const octokit = { graphql: graphqlMock } as unknown as Octokit;
  return { octokit, graphqlMock };
}

// One review node per PR, no overflow — shape matches buildBatchPrDetailsQuery's response.
function makeBatchResponse(count: number, startId: number) {
  const repository: Record<string, unknown> = {};
  for (let i = 0; i < count; i++) {
    repository[`pr_${i}`] = {
      additions: 1,
      deletions: 1,
      changedFiles: 1,
      reviews: {
        nodes: [
          {
            databaseId: startId + i,
            state: "APPROVED",
            submittedAt: "2025-01-01T00:00:00.000Z",
            author: { login: "alice", databaseId: 1 },
          },
        ],
        pageInfo: { hasNextPage: false, endCursor: "" },
      },
    };
  }
  return { repository };
}

function makeRefs(count: number, startId = 1): PrRef[] {
  return Array.from({ length: count }, (_, i) => ({ id: startId + i, number: startId + i }));
}

// Every PR still has more reviews to page through — used to force the overflow loop to run
// the full MAX_OVERFLOW_ROUNDS rather than stopping early because a PR ran out of pages.
function makeOverflowRepository(count: number, round: number) {
  const repository: Record<string, unknown> = {};
  for (let i = 0; i < count; i++) {
    repository[`pr_${i}`] = {
      additions: 0,
      deletions: 0,
      changedFiles: 0,
      reviews: {
        nodes: [
          {
            databaseId: round * 10_000 + i,
            state: "APPROVED",
            submittedAt: "2025-01-01T00:00:00.000Z",
            author: { login: "a", databaseId: 1 },
          },
        ],
        pageInfo: { hasNextPage: true, endCursor: `c${round}` },
      },
    };
  }
  return { repository };
}

describe("syncPrBatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("happy path: N PRs batched into ceil(N/GQL_PRS_PER_QUERY) GQL queries, sizes updated via RPC, reviews upserted", async () => {
    const total = GQL_PRS_PER_QUERY + 20;
    const prs = makeRefs(total);
    const { supabase, rpcCalls, upsertCalls } = makeFakeSupabase();
    const { octokit, graphqlMock } = makeFakeOctokit();
    graphqlMock
      .mockResolvedValueOnce(makeBatchResponse(GQL_PRS_PER_QUERY, 1))
      .mockResolvedValueOnce(makeBatchResponse(20, GQL_PRS_PER_QUERY + 1));

    const result = await syncPrBatch(supabase, octokit, "acme", "widgets", prs);

    expect(result.errors).toEqual([]);
    expect(result.reviews).toBe(total);
    expect(graphqlMock).toHaveBeenCalledTimes(2);
    expect(rpcCalls).toHaveLength(2);
    const reviewUpserts = upsertCalls.filter((c) => c.table === "github_reviews");
    expect(reviewUpserts.reduce((sum, c) => sum + c.rows.length, 0)).toBe(total);
  });

  it("overflow pagination: PRs with >100 reviews trigger buildBatchReviewPageQuery, capped at MAX_OVERFLOW_ROUNDS", async () => {
    const prs = makeRefs(3);
    const { supabase } = makeFakeSupabase();
    const { octokit, graphqlMock } = makeFakeOctokit();
    const initial = {
      repository: {
        pr_0: {
          additions: 0,
          deletions: 0,
          changedFiles: 0,
          reviews: {
            nodes: [
              {
                databaseId: 1,
                state: "APPROVED",
                submittedAt: "2025-01-01T00:00:00.000Z",
                author: { login: "a", databaseId: 1 },
              },
            ],
            pageInfo: { hasNextPage: true, endCursor: "c0" },
          },
        },
        pr_1: {
          additions: 0,
          deletions: 0,
          changedFiles: 0,
          reviews: {
            nodes: [
              {
                databaseId: 2,
                state: "APPROVED",
                submittedAt: "2025-01-01T00:00:00.000Z",
                author: { login: "a", databaseId: 1 },
              },
            ],
            pageInfo: { hasNextPage: true, endCursor: "c0" },
          },
        },
        pr_2: {
          additions: 0,
          deletions: 0,
          changedFiles: 0,
          reviews: {
            nodes: [
              {
                databaseId: 3,
                state: "APPROVED",
                submittedAt: "2025-01-01T00:00:00.000Z",
                author: { login: "a", databaseId: 1 },
              },
            ],
            pageInfo: { hasNextPage: true, endCursor: "c0" },
          },
        },
      },
    };
    const overflowPage = (roundOffset: number) => ({
      repository: {
        pr_0: {
          reviews: {
            nodes: [
              {
                databaseId: 100 + roundOffset,
                state: "APPROVED",
                submittedAt: "2025-01-01T00:00:00.000Z",
                author: { login: "a", databaseId: 1 },
              },
            ],
            pageInfo: { hasNextPage: true, endCursor: `c${roundOffset}` },
          },
        },
        pr_1: {
          reviews: {
            nodes: [
              {
                databaseId: 200 + roundOffset,
                state: "APPROVED",
                submittedAt: "2025-01-01T00:00:00.000Z",
                author: { login: "a", databaseId: 1 },
              },
            ],
            pageInfo: { hasNextPage: true, endCursor: `c${roundOffset}` },
          },
        },
        pr_2: {
          reviews: {
            nodes: [
              {
                databaseId: 300 + roundOffset,
                state: "APPROVED",
                submittedAt: "2025-01-01T00:00:00.000Z",
                author: { login: "a", databaseId: 1 },
              },
            ],
            pageInfo: { hasNextPage: true, endCursor: `c${roundOffset}` },
          },
        },
      },
    });
    graphqlMock
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(overflowPage(1))
      .mockResolvedValueOnce(overflowPage(2));

    const result = await syncPrBatch(supabase, octokit, "acme", "widgets", prs);

    expect(graphqlMock).toHaveBeenCalledTimes(3);
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining("review overflow truncated"));
    expect(result.reviews).toBe(9); // 3 PRs x (1 initial + 2 overflow rounds)
  });

  it("GQL error handling: non-subrequest errors are caught gracefully, added to errors array, processing continues", async () => {
    const prs = makeRefs(1);
    const { supabase, rpcCalls, upsertCalls } = makeFakeSupabase();
    const { octokit, graphqlMock } = makeFakeOctokit();
    graphqlMock.mockRejectedValueOnce(new Error("boom - GraphQL execution error"));

    const result = await syncPrBatch(supabase, octokit, "acme", "widgets", prs);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("GraphQL batch failed");
    expect(result.reviews).toBe(0);
    expect(rpcCalls).toHaveLength(0);
    expect(upsertCalls).toHaveLength(0);
  });

  it("subrequest error re-throw: errors containing 'Too many subrequests' are re-thrown, not swallowed", async () => {
    const prs = makeRefs(1);
    const { supabase } = makeFakeSupabase();
    const { octokit, graphqlMock } = makeFakeOctokit();
    graphqlMock.mockRejectedValueOnce(new Error("Too many subrequests."));

    await expect(syncPrBatch(supabase, octokit, "acme", "widgets", prs)).rejects.toThrow(/Too many subrequests/);
    expect(graphqlMock).toHaveBeenCalledTimes(1);
  });

  it("empty input: 0 PRs returns { reviews: 0, errors: [] } with no external calls", async () => {
    const { supabase, rpcCalls, upsertCalls } = makeFakeSupabase();
    const { octokit, graphqlMock } = makeFakeOctokit();

    const result = await syncPrBatch(supabase, octokit, "acme", "widgets", []);

    expect(result).toEqual({ reviews: 0, errors: [] });
    expect(graphqlMock).not.toHaveBeenCalled();
    expect(rpcCalls).toHaveLength(0);
    expect(upsertCalls).toHaveLength(0);
  });

  it("subrequest budget: one full GQL_PRS_PER_QUERY chunk with max overflow rounds stays under the 50-subrequest free-plan limit", async () => {
    // Worst case for a single prdetails Workflow instance: a full chunk (one GQL batch, no
    // splitting) where every PR overflows its first 100 reviews, forcing MAX_OVERFLOW_ROUNDS.
    const prs = makeRefs(GQL_PRS_PER_QUERY);
    const { supabase, rpcCalls, upsertCalls } = makeFakeSupabase();
    const { octokit, graphqlMock } = makeFakeOctokit();
    graphqlMock
      .mockResolvedValueOnce(makeOverflowRepository(GQL_PRS_PER_QUERY, 0))
      .mockResolvedValueOnce(makeOverflowRepository(GQL_PRS_PER_QUERY, 1))
      .mockResolvedValueOnce(makeOverflowRepository(GQL_PRS_PER_QUERY, 2));

    await syncPrBatch(supabase, octokit, "acme", "widgets", prs);

    const totalExternalRequests = graphqlMock.mock.calls.length + rpcCalls.length + upsertCalls.length;
    expect(totalExternalRequests).toBeLessThan(50);
  });
});
