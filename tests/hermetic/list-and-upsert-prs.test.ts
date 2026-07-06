import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Octokit } from "@octokit/rest";
import type { createClient } from "@/lib/supabase";
import { listAndUpsertPrsForRepo, type RepoRow } from "@/lib/services/github-sync";

type SupabaseClient = NonNullable<ReturnType<typeof createClient>>;

const mockLogger = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: mockLogger }));

function makeFakeSupabase() {
  const upsertCalls: unknown[][] = [];
  const fake = {
    from: vi.fn(() => ({
      upsert: vi.fn((rows: unknown[]) => {
        upsertCalls.push(rows);
        return { data: null, error: null };
      }),
    })),
  };
  return { supabase: fake as unknown as SupabaseClient, upsertCalls };
}

function makePr(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    number: 1,
    title: "Add feature",
    state: "open",
    merged_at: null,
    draft: false,
    user: { login: "alice", id: 10 },
    created_at: "2025-01-01T00:00:00.000Z",
    updated_at: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// Mirrors octokit.paginate's contract: call mapFn once per page with {data: page} and flatten the
// mapped results — same shape listPrsForRepo relies on. None of these tests pass `since`, so the
// real mapFn's `done()` early-stop branch is never exercised here — the callback is a no-op.
function makeFakeOctokit(pages: Record<string, unknown>[][]) {
  const paginate = vi.fn(
    (_route: unknown, _params: unknown, mapFn: (response: { data: unknown[] }, done: () => void) => unknown[]) => {
      const results = pages.flatMap((page) => mapFn({ data: page }, () => undefined));
      return Promise.resolve(results);
    },
  );
  const octokit = { paginate, rest: { pulls: { list: vi.fn() } } } as unknown as Octokit;
  return { octokit, paginate };
}

const repo: RepoRow = { id: "repo-1", repo_owner: "acme", repo_name: "widgets", last_synced_at: null };

describe("listAndUpsertPrsForRepo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("happy path: lists + upserts PRs, returns PrRef[] (id + number only)", async () => {
    const { supabase, upsertCalls } = makeFakeSupabase();
    const { octokit } = makeFakeOctokit([[makePr({ id: 1, number: 1 }), makePr({ id: 2, number: 2 })]]);

    const refs = await listAndUpsertPrsForRepo(supabase, octokit, repo);

    expect(refs).toEqual([
      { id: 1, number: 1 },
      { id: 2, number: 2 },
    ]);
    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0]).toHaveLength(2);
  });

  it("caps at maxPrsPerRepo when the repo has more PRs than the cap", async () => {
    const prs = Array.from({ length: 5 }, (_, i) => makePr({ id: i + 1, number: i + 1 }));
    const { supabase, upsertCalls } = makeFakeSupabase();
    const { octokit } = makeFakeOctokit([prs]);

    const refs = await listAndUpsertPrsForRepo(supabase, octokit, repo, undefined, 3);

    expect(refs).toHaveLength(3);
    expect(upsertCalls[0]).toHaveLength(3);
  });

  it("subrequest budget: ~2,500 active PRs (the plan's assumed sync ceiling) stays under the 50-subrequest free-plan limit", async () => {
    // Matches the plan's own "Sync-repo <=27, 46% headroom" line: ~25 REST pages + 1 upsert.
    // 4,900 PRs was considered and rejected — it lands exactly at 50 with zero headroom.
    const PAGE_SIZE = 100;
    const totalPrs = 2500;
    const pages = Array.from({ length: totalPrs / PAGE_SIZE }, (_, page) =>
      Array.from({ length: PAGE_SIZE }, (_, i) =>
        makePr({ id: page * PAGE_SIZE + i + 1, number: page * PAGE_SIZE + i + 1 }),
      ),
    );
    const { supabase, upsertCalls } = makeFakeSupabase();
    const { octokit } = makeFakeOctokit(pages);

    await listAndUpsertPrsForRepo(supabase, octokit, repo, undefined, Number.POSITIVE_INFINITY);

    // The fake paginate() collapses all pages into one JS call — count real REST pages via the
    // pages array (what actual Octokit.paginate would issue as separate HTTP requests), not
    // paginate.mock.calls.length.
    const totalExternalRequests = pages.length + upsertCalls.length;
    expect(totalExternalRequests).toBeLessThan(50);
  });
});
