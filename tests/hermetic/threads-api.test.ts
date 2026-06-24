import { describe, it, expect, vi, beforeEach } from "vitest";
import type { APIContext } from "astro";

// Virtual module — must be mocked before any import that transitively loads it.
vi.mock("astro:env/server", () => ({
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_KEY: "test-key",
}));

const mockLogger = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: mockLogger }));

// Same guard-layer mock shape as tests/hermetic/impact-api.test.ts: "boards" (getBoardWithRole)
// and "board_contributors"/"user_profiles" (contributor + own-profile lookups) share a generic
// builder; call order drives the queued maybeSingle resolutions.
const mockBuilder = vi.hoisted(() => {
  const b: Record<string, ReturnType<typeof vi.fn>> = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() };
  b.select.mockReturnValue(b);
  b.eq.mockReturnValue(b);
  b.maybeSingle.mockResolvedValue({ data: { github_id: 42 }, error: null });
  return b;
});
const mockBoardRow = vi.hoisted(() => ({
  id: "00000000-0000-0000-0000-000000000001",
  name: "Board",
  owner_user_id: "user-1",
  created_at: "2025-01-01T00:00:00.000Z",
  updated_at: "2025-01-01T00:00:00.000Z",
}));
const mockBoardBuilder = vi.hoisted(() => {
  const b: Record<string, ReturnType<typeof vi.fn>> = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() };
  b.select.mockReturnValue(b);
  b.eq.mockReturnValue(b);
  b.maybeSingle.mockResolvedValue({ data: mockBoardRow, error: null });
  return b;
});
const mockSupabase = vi.hoisted(() => ({
  auth: { getUser: vi.fn() },
  from: vi.fn().mockImplementation((table: string) => (table === "boards" ? mockBoardBuilder : mockBuilder)),
}));
vi.mock("@/lib/supabase", () => ({ createClient: vi.fn(() => mockSupabase) }));

const mockThreadsPage = vi.hoisted(() => ({
  threads: [
    {
      threadRootCommentId: 1,
      pullRequestId: 2,
      prNumber: 7,
      prTitle: "Add feature",
      prRepo: "acme/widgets",
      prUrl: "https://github.com/acme/widgets/pull/7",
      commentSnippet: "Looks good",
      intent: "architecture",
      domain: "functional",
      commenterLogin: "alice",
      classifiedAt: "2025-09-17T00:00:00.000Z",
      createdAt: "2025-09-18T00:00:00.000Z",
    },
  ],
  total: 1,
  page: 1,
  pageSize: 25,
}));

vi.mock("@/lib/services/impact-metrics", () => ({
  getClassifiedThreads: vi.fn().mockResolvedValue(mockThreadsPage),
}));

import { createClient } from "@/lib/supabase";
import { getClassifiedThreads } from "@/lib/services/impact-metrics";
const { GET: threadsGET } = await import("@/pages/api/board/[boardId]/threads/[login]");

const VALID_BOARD_ID = "00000000-0000-0000-0000-000000000001";
const VALID_LOGIN = "alice";

function makeContext(params: Record<string, string>, searchParams: Record<string, string> = {}): APIContext {
  const url = new URL(`http://localhost/api/board/${params.boardId}/threads/${params.login}`);
  for (const [k, v] of Object.entries(searchParams)) url.searchParams.set(k, v);
  return { request: new Request(url), cookies: {}, params, url } as unknown as APIContext;
}

describe("Threads API (hermetic)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(mockSupabase);
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    mockSupabase.from.mockImplementation((table: string) => (table === "boards" ? mockBoardBuilder : mockBuilder));
    mockBuilder.select.mockReturnValue(mockBuilder);
    mockBuilder.eq.mockReturnValue(mockBuilder);
    mockBuilder.maybeSingle.mockResolvedValue({ data: { github_id: 42 }, error: null });
    mockBoardBuilder.select.mockReturnValue(mockBoardBuilder);
    mockBoardBuilder.eq.mockReturnValue(mockBoardBuilder);
    mockBoardBuilder.maybeSingle.mockResolvedValue({ data: mockBoardRow, error: null });
    (getClassifiedThreads as ReturnType<typeof vi.fn>).mockResolvedValue(mockThreadsPage);
  });

  it("503 when Supabase is not configured", async () => {
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(null);
    const res = await threadsGET(makeContext({ boardId: VALID_BOARD_ID, login: VALID_LOGIN }));
    expect(res.status).toBe(503);
  });

  it("401 when unauthenticated", async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } });
    const res = await threadsGET(makeContext({ boardId: VALID_BOARD_ID, login: VALID_LOGIN }));
    expect(res.status).toBe(401);
  });

  it("400 when boardId is not a valid UUID", async () => {
    const res = await threadsGET(makeContext({ boardId: "not-a-uuid", login: VALID_LOGIN }));
    expect(res.status).toBe(400);
  });

  it("400 when login is empty", async () => {
    const res = await threadsGET(makeContext({ boardId: VALID_BOARD_ID, login: "" }));
    expect(res.status).toBe(400);
  });

  it("404 when board not found", async () => {
    mockBoardBuilder.maybeSingle.mockResolvedValue({ data: null, error: null });
    const res = await threadsGET(makeContext({ boardId: VALID_BOARD_ID, login: VALID_LOGIN }));
    expect(res.status).toBe(404);
  });

  it("400 when period slug is unknown", async () => {
    const res = await threadsGET(makeContext({ boardId: VALID_BOARD_ID, login: VALID_LOGIN }, { period: "quarterly" }));
    expect(res.status).toBe(400);
  });

  it.each([
    ["page", "0"],
    ["page", "abc"],
    ["pageSize", "5"],
    ["pageSize", "100"],
    ["intent", "not-a-category"],
    ["domain", "not-a-domain"],
    ["prId", "-1"],
    ["role", "everyone"],
  ])("400 when %s=%s is invalid", async (key, value) => {
    const res = await threadsGET(makeContext({ boardId: VALID_BOARD_ID, login: VALID_LOGIN }, { [key]: value }));
    expect(res.status).toBe(400);
  });

  it("404 when contributor not found on board", async () => {
    mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: null });
    const res = await threadsGET(makeContext({ boardId: VALID_BOARD_ID, login: "ghost" }));
    expect(res.status).toBe(404);
  });

  it("403 when a non-supervisor requests another contributor's threads", async () => {
    mockBoardBuilder.maybeSingle.mockResolvedValue({
      data: { ...mockBoardRow, owner_user_id: "owner-2" },
      error: null,
    });
    mockBuilder.maybeSingle
      .mockResolvedValueOnce({ data: { github_id: 42 }, error: null })
      .mockResolvedValueOnce({ data: { github_id: 99 }, error: null });
    const res = await threadsGET(makeContext({ boardId: VALID_BOARD_ID, login: VALID_LOGIN }));
    expect(res.status).toBe(403);
  });

  it("200 when a non-supervisor requests their own threads", async () => {
    mockBoardBuilder.maybeSingle.mockResolvedValue({
      data: { ...mockBoardRow, owner_user_id: "owner-2" },
      error: null,
    });
    mockBuilder.maybeSingle
      .mockResolvedValueOnce({ data: { github_id: 42 }, error: null })
      .mockResolvedValueOnce({ data: { github_id: 42 }, error: null });
    const res = await threadsGET(makeContext({ boardId: VALID_BOARD_ID, login: VALID_LOGIN }));
    expect(res.status).toBe(200);
  });

  it("500 when contributor lookup returns a DB error", async () => {
    mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: { message: "DB timeout" } });
    const res = await threadsGET(makeContext({ boardId: VALID_BOARD_ID, login: VALID_LOGIN }));
    expect(res.status).toBe(500);
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it("500 when service throws", async () => {
    (getClassifiedThreads as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("DB error"));
    const res = await threadsGET(makeContext({ boardId: VALID_BOARD_ID, login: VALID_LOGIN }));
    expect(res.status).toBe(500);
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it("200 with service result on a valid request, using defaults", async () => {
    const res = await threadsGET(makeContext({ boardId: VALID_BOARD_ID, login: VALID_LOGIN }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as typeof mockThreadsPage;
    expect(body).toEqual(mockThreadsPage);
    expect(getClassifiedThreads).toHaveBeenCalledWith(
      mockSupabase,
      VALID_BOARD_ID,
      42,
      expect.anything(),
      { intent: undefined, domain: undefined, pullRequestId: undefined, role: "all" },
      1,
      25,
    );
  });

  it("200 and forwards filters/pagination query params to the service", async () => {
    const res = await threadsGET(
      makeContext(
        { boardId: VALID_BOARD_ID, login: VALID_LOGIN },
        { page: "2", pageSize: "10", intent: "nitpick", domain: "discussion", prId: "5", role: "received" },
      ),
    );
    expect(res.status).toBe(200);
    expect(getClassifiedThreads).toHaveBeenCalledWith(
      mockSupabase,
      VALID_BOARD_ID,
      42,
      expect.anything(),
      { intent: "nitpick", domain: "discussion", pullRequestId: 5, role: "received" },
      2,
      10,
    );
  });
});
