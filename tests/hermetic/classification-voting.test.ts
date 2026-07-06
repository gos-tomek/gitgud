import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { createClient } from "@/lib/supabase";
import { classifyThreads, CLASSIFICATION_MODEL, type AiBinding } from "@/lib/services/classification";

type SupabaseClient = NonNullable<ReturnType<typeof createClient>>;

const mockLogger = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: mockLogger }));

interface FakeCommentRow {
  id: number;
  pull_request_id: number;
  in_reply_to_id: number | null;
  commenter_login: string;
  body: string;
  path: string | null;
  position_line: number | null;
  created_at: string;
}

interface FakePrRow {
  id: number;
  title: string;
  author_login: string;
}

function makeFakeSupabase(opts: { comments: FakeCommentRow[]; prs: FakePrRow[] }) {
  const commentsBuilder = {
    select: vi.fn(function (this: unknown) {
      return this;
    }),
    in: vi.fn((column: string, ids: number[]) => {
      if (column === "id") return { data: opts.comments.filter((c) => ids.includes(c.id)), error: null };
      if (column === "in_reply_to_id") {
        return {
          data: opts.comments.filter((c) => c.in_reply_to_id !== null && ids.includes(c.in_reply_to_id)),
          error: null,
        };
      }
      return { data: [], error: null };
    }),
  };
  const prsBuilder = {
    select: vi.fn(function (this: unknown) {
      return this;
    }),
    in: vi.fn((_column: string, ids: number[]) => ({ data: opts.prs.filter((p) => ids.includes(p.id)), error: null })),
  };
  const fake = {
    from: vi.fn((table: string) => {
      if (table === "github_review_comments") return commentsBuilder;
      if (table === "github_pull_requests") return prsBuilder;
      throw new Error(`unexpected table ${table}`);
    }),
  };
  return { supabase: fake as unknown as SupabaseClient, commentsBuilder, prsBuilder };
}

function makeFakeAi() {
  const run = vi.fn();
  return { ai: { run } as AiBinding, run };
}

function jsonResponse(items: unknown[]) {
  return { response: JSON.stringify(items) };
}

function makeRootComment(): FakeCommentRow {
  return {
    id: 1,
    pull_request_id: 100,
    in_reply_to_id: null,
    commenter_login: "reviewer-1",
    body: "why this approach?",
    path: null,
    position_line: null,
    created_at: "2025-01-01T00:00:00.000Z",
  };
}

function makePrRow(): FakePrRow {
  return { id: 100, title: "Add feature", author_login: "author-1" };
}

describe("classifyThreads — majority voting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("2 of 3 repeats agreeing wins over the third's differing vote", async () => {
    const { supabase } = makeFakeSupabase({ comments: [makeRootComment()], prs: [makePrRow()] });
    const { ai, run } = makeFakeAi();
    run
      .mockResolvedValueOnce(jsonResponse([{ thread_id: 1, intent: "bug-catch", domain: "functional" }]))
      .mockResolvedValueOnce(jsonResponse([{ thread_id: 1, intent: "bug-catch", domain: "functional" }]))
      .mockResolvedValueOnce(jsonResponse([{ thread_id: 1, intent: "nitpick", domain: "refactoring" }]));

    const result = await classifyThreads(ai, supabase, [1]);

    expect(result).toEqual([
      {
        thread_root_comment_id: 1,
        pull_request_id: 100,
        intent: "bug-catch",
        domain: "functional",
        model_id: CLASSIFICATION_MODEL,
      },
    ]);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("3-way split falls back to 'unknown', which is invalid for domain, so the thread is dropped", async () => {
    const { supabase } = makeFakeSupabase({ comments: [makeRootComment()], prs: [makePrRow()] });
    const { ai, run } = makeFakeAi();
    run
      .mockResolvedValueOnce(jsonResponse([{ thread_id: 1, intent: "bug-catch", domain: "functional" }]))
      .mockResolvedValueOnce(jsonResponse([{ thread_id: 1, intent: "nitpick", domain: "refactoring" }]))
      .mockResolvedValueOnce(jsonResponse([{ thread_id: 1, intent: "question", domain: "discussion" }]));

    const result = await classifyThreads(ai, supabase, [1]);

    expect(result).toEqual([]);
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining("No valid domain majority for thread 1"));
  });

  it("AI returns an out-of-enum category for one repeat: that vote is dropped by schema validation, the other two still form a majority", async () => {
    const { supabase } = makeFakeSupabase({ comments: [makeRootComment()], prs: [makePrRow()] });
    const { ai, run } = makeFakeAi();
    run
      .mockResolvedValueOnce(jsonResponse([{ thread_id: 1, intent: "bug-catch", domain: "functional" }]))
      .mockResolvedValueOnce(jsonResponse([{ thread_id: 1, intent: "bug-catch", domain: "functional" }]))
      // "sarcasm" is not a valid intent — fails zod validation, contributes no vote for this repeat.
      .mockResolvedValueOnce(jsonResponse([{ thread_id: 1, intent: "sarcasm", domain: "functional" }]));

    const result = await classifyThreads(ai, supabase, [1]);

    expect(result).toEqual([
      {
        thread_root_comment_id: 1,
        pull_request_id: 100,
        intent: "bug-catch",
        domain: "functional",
        model_id: CLASSIFICATION_MODEL,
      },
    ]);
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining("item validation failed"));
  });

  describe("with frozen time", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("AI responds in an unexpected (non-JSON) format on every attempt: retries exhaust, thread is dropped without throwing", async () => {
      const { supabase } = makeFakeSupabase({ comments: [makeRootComment()], prs: [makePrRow()] });
      const { ai, run } = makeFakeAi();
      // No JSON array anywhere in the text — extractJsonArray returns it unchanged, JSON.parse throws.
      run.mockResolvedValue({ response: "Sorry, I can't help with that." });

      const resultPromise = classifyThreads(ai, supabase, [1]);
      await vi.advanceTimersByTimeAsync(60_000);
      const result = await resultPromise;

      expect(result).toEqual([]);
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining("Batch call failed after"));
      // Every one of the 3 repeats retried more than once before giving up.
      expect(run.mock.calls.length).toBeGreaterThan(3);
    });
  });
});

describe("classifyThreads — subrequest budget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("one classify-chunk (20 threads) makes only 3 Supabase reads, regardless of AI vote-repeat fan-out", async () => {
    // Workers AI (`ai.run`) is a Cloudflare binding call, not a `fetch()` — research.md 3.3 notes
    // bindings likely count against the separate 1,000-service-request cap, not the 50-external
    // cap this bugfix targets. So only Supabase reads count toward the budget here, even though
    // classifyBatch fans out to many ai.run() calls internally (sub-batches x vote repeats).
    const CLASSIFICATION_BATCH_SIZE = 20; // mirrors worker.ts's private constant of the same name
    const threadIds = Array.from({ length: CLASSIFICATION_BATCH_SIZE }, (_, i) => i + 1);
    const comments = threadIds.map((id) => ({ ...makeRootComment(), id, pull_request_id: 100 }));
    const { supabase, commentsBuilder, prsBuilder } = makeFakeSupabase({ comments, prs: [makePrRow()] });
    const { ai, run } = makeFakeAi();
    run.mockResolvedValue(
      jsonResponse(threadIds.map((id) => ({ thread_id: id, intent: "bug-catch", domain: "functional" }))),
    );

    await classifyThreads(ai, supabase, threadIds);

    const totalExternalRequests = commentsBuilder.in.mock.calls.length + prsBuilder.in.mock.calls.length;
    expect(totalExternalRequests).toBe(3); // roots + replies (Promise.all) + PR metadata
    expect(totalExternalRequests).toBeLessThan(50);
  });
});
