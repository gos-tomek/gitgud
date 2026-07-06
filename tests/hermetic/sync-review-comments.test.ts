import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Octokit } from "@octokit/rest";
import type { createClient } from "@/lib/supabase";
import { syncReviewCommentsForRepo } from "@/lib/services/github-sync";

type SupabaseClient = NonNullable<ReturnType<typeof createClient>>;

const mockLogger = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: mockLogger }));

function makeFakeSupabase(prRows: { id: number; number: number }[]) {
  const upsertedRows: Record<string, unknown>[] = [];
  const prBuilder = {
    select: vi.fn(function (this: unknown) {
      return this;
    }),
    eq: vi.fn(function (this: unknown) {
      return this;
    }),
    range: vi.fn(() => ({ data: prRows, error: null })),
  };
  const reviewsBuilder = {
    select: vi.fn(function (this: unknown) {
      return this;
    }),
    in: vi.fn(() => ({ data: [], error: null })),
  };
  const commentsBuilder = {
    upsert: vi.fn((rows: Record<string, unknown>[]) => {
      upsertedRows.push(...rows);
      return { data: null, error: null };
    }),
  };
  const fake = {
    from: vi.fn((table: string) => {
      if (table === "github_pull_requests") return prBuilder;
      if (table === "github_reviews") return reviewsBuilder;
      if (table === "github_review_comments") return commentsBuilder;
      throw new Error(`unexpected table ${table}`);
    }),
  };
  return { supabase: fake as unknown as SupabaseClient, upsertedRows, prBuilder, reviewsBuilder, commentsBuilder };
}

function makeComment(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    pull_request_url: "https://api.github.com/repos/acme/widgets/pulls/1",
    pull_request_review_id: null,
    user: { login: "alice", id: 10 },
    body: "nice",
    path: "src/index.ts",
    line: 5,
    side: "RIGHT",
    in_reply_to_id: null,
    created_at: "2025-01-01T00:00:00.000Z",
    updated_at: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeFakeOctokit(pages: Record<string, unknown>[][]) {
  let call = 0;
  const listReviewCommentsForRepo = vi.fn(() => {
    const data = pages[call] ?? [];
    call++;
    return { data };
  });
  const octokit = { rest: { pulls: { listReviewCommentsForRepo } } } as unknown as Octokit;
  return { octokit, listReviewCommentsForRepo };
}

describe("syncReviewCommentsForRepo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("happy path: comments fetched, PR numbers resolved to IDs, rows upserted", async () => {
    const { supabase, upsertedRows } = makeFakeSupabase([{ id: 42, number: 1 }]);
    const { octokit } = makeFakeOctokit([[makeComment({ id: 1 })]]);

    const result = await syncReviewCommentsForRepo(supabase, octokit, "repo-1", "acme", "widgets");

    expect(result.comments).toBe(1);
    expect(upsertedRows).toEqual([expect.objectContaining({ id: 1, pull_request_id: 42 })]);
  });

  it("pagination: multiple pages fetched until response.data.length < 100", async () => {
    const { supabase } = makeFakeSupabase([{ id: 42, number: 1 }]);
    const page1 = Array.from({ length: 100 }, (_, i) => makeComment({ id: i + 1 }));
    const page2 = [makeComment({ id: 200 })];
    const { octokit, listReviewCommentsForRepo } = makeFakeOctokit([page1, page2]);

    const result = await syncReviewCommentsForRepo(supabase, octokit, "repo-1", "acme", "widgets");

    expect(listReviewCommentsForRepo).toHaveBeenCalledTimes(2);
    expect(result.comments).toBe(101);
  });

  it("truncation at maxPages: returns nextSince (last comment's updated_at) for resumption", async () => {
    const { supabase } = makeFakeSupabase([{ id: 42, number: 1 }]);
    const fullPage = (offset: number) =>
      Array.from({ length: 100 }, (_, i) =>
        makeComment({ id: offset + i, updated_at: `2025-01-0${offset === 0 ? 1 : 2}T00:00:00.000Z` }),
      );
    const { octokit, listReviewCommentsForRepo } = makeFakeOctokit([fullPage(0), fullPage(100)]);

    const result = await syncReviewCommentsForRepo(supabase, octokit, "repo-1", "acme", "widgets", undefined, 2);

    expect(listReviewCommentsForRepo).toHaveBeenCalledTimes(2);
    expect(result.nextSince).toEqual(new Date("2025-01-02T00:00:00.000Z"));
  });

  it("unmapped PRs: comments referencing PRs not in the database are filtered out", async () => {
    const { supabase, upsertedRows } = makeFakeSupabase([{ id: 42, number: 1 }]);
    const { octokit } = makeFakeOctokit([
      [
        makeComment({ id: 1, pull_request_url: "https://api.github.com/repos/acme/widgets/pulls/1" }),
        makeComment({ id: 2, pull_request_url: "https://api.github.com/repos/acme/widgets/pulls/999" }),
      ],
    ]);

    const result = await syncReviewCommentsForRepo(supabase, octokit, "repo-1", "acme", "widgets");

    expect(result.comments).toBe(1);
    expect(upsertedRows).toEqual([expect.objectContaining({ id: 1 })]);
  });

  it("empty result: no comments returns { comments: 0 } with no nextSince, and no upsert call", async () => {
    const { supabase, commentsBuilder } = makeFakeSupabase([{ id: 42, number: 1 }]);
    const { octokit } = makeFakeOctokit([[]]);

    const result = await syncReviewCommentsForRepo(supabase, octokit, "repo-1", "acme", "widgets");

    expect(result).toEqual({ comments: 0, nextSince: undefined });
    expect(commentsBuilder.upsert).not.toHaveBeenCalled();
  });

  it("deduplication: duplicate comment IDs (boundary overlap) are deduped before upsert", async () => {
    const { supabase, upsertedRows } = makeFakeSupabase([{ id: 42, number: 1 }]);
    const page1 = Array.from({ length: 100 }, (_, i) => makeComment({ id: i + 1 }));
    // Same comment id=1 reappears on the next page (GitHub's since-boundary overlap).
    const page2 = [makeComment({ id: 1, body: "updated body" })];
    const { octokit } = makeFakeOctokit([page1, page2]);

    const result = await syncReviewCommentsForRepo(supabase, octokit, "repo-1", "acme", "widgets");

    expect(result.comments).toBe(100);
    const dupeRows = upsertedRows.filter((r) => r.id === 1);
    expect(dupeRows).toHaveLength(1);
    expect(dupeRows[0]).toEqual(expect.objectContaining({ body: "updated body" }));
  });

  it("subrequest budget: one full 25-page reviews instance stays under the 50-subrequest free-plan limit", async () => {
    // Worst case for a single "reviews" Workflow instance: maxPages full (100-comment) pages,
    // matching the maxPages=25 the orchestrator actually passes per instance.
    const MAX_PAGES = 25;
    const { supabase, prBuilder, commentsBuilder } = makeFakeSupabase([{ id: 42, number: 1 }]);
    const pages = Array.from({ length: MAX_PAGES }, (_, page) =>
      Array.from({ length: 100 }, (_, i) => makeComment({ id: page * 100 + i })),
    );
    const { octokit, listReviewCommentsForRepo } = makeFakeOctokit(pages);

    await syncReviewCommentsForRepo(supabase, octokit, "repo-1", "acme", "widgets", undefined, MAX_PAGES);

    const totalExternalRequests =
      prBuilder.range.mock.calls.length +
      listReviewCommentsForRepo.mock.calls.length +
      commentsBuilder.upsert.mock.calls.length;
    expect(totalExternalRequests).toBeLessThan(50);
  });
});
