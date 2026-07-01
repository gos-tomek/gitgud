import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("astro:env/server", () => ({ GITHUB_TOKEN_ENCRYPTION_KEY: "test-key" }));

const { syncPrBatch } = await import("@/lib/services/github-sync");
type PrRef = import("@/lib/services/github-sync").PrRef;

function makePrRefs(count: number, startNumber = 1): PrRef[] {
  return Array.from({ length: count }, (_, i) => ({ id: 1000 + i, number: startNumber + i }));
}

function makeGqlPrData(pr: PrRef) {
  return {
    additions: 10,
    deletions: 5,
    changedFiles: 2,
    reviews: {
      nodes: [
        {
          databaseId: pr.id * 10,
          state: "APPROVED",
          submittedAt: "2026-06-01T00:00:00Z",
          author: { login: "reviewer", databaseId: 999 },
        },
      ],
      pageInfo: { hasNextPage: false, endCursor: "" },
    },
  };
}

function buildGqlResponse(prs: PrRef[]) {
  const repository: Record<string, ReturnType<typeof makeGqlPrData>> = {};
  prs.forEach((pr, i) => {
    repository[`pr_${i}`] = makeGqlPrData(pr);
  });
  return { repository };
}

function makeSupabaseMock() {
  return {
    rpc: vi.fn().mockResolvedValue({ error: null }),
    from: vi.fn().mockReturnValue({
      upsert: vi.fn().mockResolvedValue({ error: null }),
    }),
  } as unknown as Parameters<typeof syncPrBatch>[0];
}

function makeOctokitMock(graphqlFn: ReturnType<typeof vi.fn>) {
  return { graphql: graphqlFn } as unknown as Parameters<typeof syncPrBatch>[1];
}

const TIMEOUT_ERR = new DOMException("The operation was aborted due to timeout", "TimeoutError");

describe("syncPrBatch — timeout handling and adaptive splitting", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  it("succeeds on first try with no splitting when GQL responds", async () => {
    const prs = makePrRefs(20);
    const graphql = vi.fn().mockResolvedValue(buildGqlResponse(prs));

    const result = await syncPrBatch(makeSupabaseMock(), makeOctokitMock(graphql), "supabase", "supabase", prs);

    expect(result.errors).toHaveLength(0);
    expect(result.reviews).toBe(20);
    expect(graphql).toHaveBeenCalledTimes(1);
  });

  it("timeout triggers immediate split — no retry on timeout", async () => {
    const prs = makePrRefs(20);
    const graphql = vi.fn().mockImplementation((_query: string) => {
      const aliasCount = (_query.match(/pr_\d+:/g) ?? []).length;
      if (aliasCount > 10) return Promise.reject(TIMEOUT_ERR);
      const matchingPrs = prs.filter((pr) => _query.includes(`pullRequest(number: ${pr.number})`));
      return Promise.resolve(buildGqlResponse(matchingPrs));
    });

    const result = await syncPrBatch(makeSupabaseMock(), makeOctokitMock(graphql), "supabase", "supabase", prs);

    expect(result.errors).toHaveLength(0);
    expect(result.reviews).toBe(20);
    // 1 call (full, timeout) → split → 2 calls (halves, succeed) = 3 total
    expect(graphql).toHaveBeenCalledTimes(3);
  });

  it("splits batch in half when full batch times out on large batch", async () => {
    const prs = makePrRefs(40);
    const graphql = vi.fn().mockImplementation((_query: string) => {
      const aliasCount = (_query.match(/pr_\d+:/g) ?? []).length;
      if (aliasCount > 20) return Promise.reject(TIMEOUT_ERR);
      const matchingPrs = prs.filter((pr) => _query.includes(`pullRequest(number: ${pr.number})`));
      return Promise.resolve(buildGqlResponse(matchingPrs));
    });

    const result = await syncPrBatch(makeSupabaseMock(), makeOctokitMock(graphql), "supabase", "supabase", prs);

    expect(result.errors).toHaveLength(0);
    expect(result.reviews).toBe(40);
    // 1 (full, timeout) → 2 (halves, succeed) = 3
    expect(graphql).toHaveBeenCalledTimes(3);
  });

  it("produces errors for each PR when batch is <= MIN_SPLIT_SIZE and times out", async () => {
    const prs = makePrRefs(8);
    const graphql = vi.fn().mockRejectedValue(TIMEOUT_ERR);

    const result = await syncPrBatch(makeSupabaseMock(), makeOctokitMock(graphql), "supabase", "supabase", prs);

    expect(result.errors).toHaveLength(8);
    expect(result.errors[0]).toContain("PR #1");
    expect(result.errors[0]).toContain("aborted");
    expect(result.reviews).toBe(0);
    // No retry on timeout — single call
    expect(graphql).toHaveBeenCalledTimes(1);
  });

  it("re-throws 'Too many subrequests' without retry or splitting", async () => {
    const prs = makePrRefs(20);
    const graphql = vi.fn().mockRejectedValue(new Error("Too many subrequests"));

    await expect(
      syncPrBatch(makeSupabaseMock(), makeOctokitMock(graphql), "supabase", "supabase", prs),
    ).rejects.toThrow("Too many subrequests");
    expect(graphql).toHaveBeenCalledTimes(1);
  });

  it("does not retry or split on non-transient errors", async () => {
    const prs = makePrRefs(20);
    const graphql = vi.fn().mockRejectedValue(new Error("Bad credentials"));

    const result = await syncPrBatch(makeSupabaseMock(), makeOctokitMock(graphql), "supabase", "supabase", prs);

    expect(result.errors).toHaveLength(20);
    expect(result.errors[0]).toContain("Bad credentials");
    expect(graphql).toHaveBeenCalledTimes(1);
  });

  it("retries on 502 Bad Gateway (fast failure, worth retrying)", async () => {
    const prs = makePrRefs(20);
    const graphql = vi
      .fn()
      .mockRejectedValueOnce(new Error("502 Bad Gateway"))
      .mockResolvedValue(buildGqlResponse(prs));

    const result = await syncPrBatch(makeSupabaseMock(), makeOctokitMock(graphql), "supabase", "supabase", prs);

    expect(result.errors).toHaveLength(0);
    expect(graphql).toHaveBeenCalledTimes(2);
  });

  it("handles recursive splitting — full→halves→quarters until small enough", async () => {
    const prs = makePrRefs(40);
    const graphql = vi.fn().mockImplementation((_query: string) => {
      const aliasCount = (_query.match(/pr_\d+:/g) ?? []).length;
      if (aliasCount > 10) return Promise.reject(TIMEOUT_ERR);
      const matchingPrs = prs.filter((pr) => _query.includes(`pullRequest(number: ${pr.number})`));
      return Promise.resolve(buildGqlResponse(matchingPrs));
    });

    const result = await syncPrBatch(makeSupabaseMock(), makeOctokitMock(graphql), "supabase", "supabase", prs);

    expect(result.errors).toHaveLength(0);
    expect(result.reviews).toBe(40);
    // 1 (40, timeout) → 2 (20, timeout each) → 4 (10, succeed each) = 7
    expect(graphql).toHaveBeenCalledTimes(7);
  });

  it("partial success: one half succeeds, the other fails at MIN_SPLIT_SIZE", async () => {
    const prs = makePrRefs(20);
    const leftPrs = prs.slice(0, 10);

    const graphql = vi.fn().mockImplementation((_query: string) => {
      const aliasCount = (_query.match(/pr_\d+:/g) ?? []).length;
      if (aliasCount > 10) return Promise.reject(TIMEOUT_ERR);
      const hasLeftPr = _query.includes(`pullRequest(number: ${leftPrs[0].number})`);
      if (hasLeftPr) {
        const matchingPrs = prs.filter((pr) => _query.includes(`pullRequest(number: ${pr.number})`));
        return Promise.resolve(buildGqlResponse(matchingPrs));
      }
      return Promise.reject(TIMEOUT_ERR);
    });

    const result = await syncPrBatch(makeSupabaseMock(), makeOctokitMock(graphql), "supabase", "supabase", prs);

    expect(result.reviews).toBe(10);
    expect(result.errors).toHaveLength(10);
    expect(result.errors.every((e) => e.includes("aborted"))).toBe(true);
    // 1 (full, timeout) → 1 (left, ok) + 1 (right, timeout, ≤MIN_SPLIT_SIZE, fail) = 3
    expect(graphql).toHaveBeenCalledTimes(3);
  });
});
