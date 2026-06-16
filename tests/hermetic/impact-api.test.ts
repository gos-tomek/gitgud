import { describe, it, expect, vi, beforeEach } from "vitest";
import type { APIContext } from "astro";

// Virtual module — must be mocked before any import that transitively loads it.
vi.mock("astro:env/server", () => ({
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_KEY: "test-key",
}));

const mockLogger = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: mockLogger }));

// Supabase mock — board_contributors query is the only DB call the guard layer makes.
const mockContributorResult = vi.hoisted(() => ({ data: { github_id: 42 }, error: null }));
const mockBuilder = vi.hoisted(() => {
  const b: Record<string, ReturnType<typeof vi.fn>> = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(),
  };
  b.select.mockReturnValue(b);
  b.eq.mockReturnValue(b);
  b.maybeSingle.mockResolvedValue(mockContributorResult);
  return b;
});
const mockSupabase = vi.hoisted(() => ({
  auth: { getUser: vi.fn() },
  from: vi.fn().mockReturnValue(mockBuilder),
}));
vi.mock("@/lib/supabase", () => ({ createClient: vi.fn(() => mockSupabase) }));

// Service layer — keep HTTP-layer tests independent of aggregation logic.
// Must be hoisted so vi.mock factories can reference these values.
const { mockSummaryData, mockAuthorData, mockReviewerData, mockActivityData } = vi.hoisted(() => ({
  mockSummaryData: { prsAuthored: { value: 3, delta: 50 }, reviewsGiven: { value: 1, delta: null } },
  mockAuthorData: { prsByState: { open: 1, merged: 2, closed: 0, draft: 0, total: 3 }, mergeRate: 67 },
  mockReviewerData: { reviewsByVerdict: { approved: 5, changesRequested: 1, commented: 0, dismissed: 0, total: 6 } },
  mockActivityData: { weeklyActivity: [], dailyHeatmap: [], topCollaborators: [] },
}));

vi.mock("@/lib/services/impact-metrics", () => ({
  getImpactSummary: vi.fn().mockResolvedValue(mockSummaryData),
  getAuthorMetrics: vi.fn().mockResolvedValue(mockAuthorData),
  getReviewerMetrics: vi.fn().mockResolvedValue(mockReviewerData),
  getActivityData: vi.fn().mockResolvedValue(mockActivityData),
}));

import { createClient } from "@/lib/supabase";
import { getImpactSummary } from "@/lib/services/impact-metrics";
const { GET: summaryGET } = await import("@/pages/api/board/[boardId]/impact/[login]/summary");
const { GET: authorGET } = await import("@/pages/api/board/[boardId]/impact/[login]/author");
const { GET: reviewerGET } = await import("@/pages/api/board/[boardId]/impact/[login]/reviewer");
const { GET: activityGET } = await import("@/pages/api/board/[boardId]/impact/[login]/activity");

const VALID_BOARD_ID = "00000000-0000-0000-0000-000000000001";
const VALID_LOGIN = "alice";

function makeContext(params: Record<string, string>, searchParams: Record<string, string> = {}): APIContext {
  const url = new URL(`http://localhost/api/board/${params.boardId}/impact/${params.login}/summary`);
  for (const [k, v] of Object.entries(searchParams)) url.searchParams.set(k, v);
  return {
    request: new Request(url),
    cookies: {},
    params,
    url,
  } as unknown as APIContext;
}

describe("Impact API guard layer (hermetic)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Restore defaults after clearAllMocks
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(mockSupabase);
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    mockSupabase.from.mockReturnValue(mockBuilder);
    mockBuilder.select.mockReturnValue(mockBuilder);
    mockBuilder.eq.mockReturnValue(mockBuilder);
    mockBuilder.maybeSingle.mockResolvedValue({ data: { github_id: 42 }, error: null });
    (getImpactSummary as ReturnType<typeof vi.fn>).mockResolvedValue(mockSummaryData);
  });

  // ── 503 ──────────────────────────────────────────────────────────────────────

  it("summary: 503 when Supabase is not configured", async () => {
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(null);
    const ctx = makeContext({ boardId: VALID_BOARD_ID, login: VALID_LOGIN });
    const res = await summaryGET(ctx);
    expect(res.status).toBe(503);
  });

  // ── 401 ──────────────────────────────────────────────────────────────────────

  it.each([
    ["summary", summaryGET],
    ["author", authorGET],
    ["reviewer", reviewerGET],
    ["activity", activityGET],
  ] as const)("%s: 401 when unauthenticated", async (_name, handler) => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } });
    const ctx = makeContext({ boardId: VALID_BOARD_ID, login: VALID_LOGIN });
    const res = await handler(ctx);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Unauthorized");
  });

  // ── 400 invalid params ────────────────────────────────────────────────────────

  it("summary: 400 when boardId is not a valid UUID", async () => {
    const ctx = makeContext({ boardId: "not-a-uuid", login: VALID_LOGIN });
    const res = await summaryGET(ctx);
    expect(res.status).toBe(400);
  });

  it("summary: 400 when login is empty", async () => {
    const ctx = makeContext({ boardId: VALID_BOARD_ID, login: "" });
    const res = await summaryGET(ctx);
    expect(res.status).toBe(400);
  });

  // ── 400 invalid period ────────────────────────────────────────────────────────

  it.each([
    ["summary", summaryGET],
    ["author", authorGET],
    ["reviewer", reviewerGET],
    ["activity", activityGET],
  ] as const)("%s: 400 when period slug is unknown", async (_name, handler) => {
    const ctx = makeContext({ boardId: VALID_BOARD_ID, login: VALID_LOGIN }, { period: "quarterly" });
    const res = await handler(ctx);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Invalid period slug");
  });

  // ── 404 ──────────────────────────────────────────────────────────────────────

  it.each([
    ["summary", summaryGET],
    ["author", authorGET],
    ["reviewer", reviewerGET],
    ["activity", activityGET],
  ] as const)("%s: 404 when contributor not found on board", async (_name, handler) => {
    mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: null });
    const ctx = makeContext({ boardId: VALID_BOARD_ID, login: "ghost" });
    const res = await handler(ctx);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Contributor not found");
  });

  // ── 500 DB error ──────────────────────────────────────────────────────────────

  it("summary: 500 when contributor lookup returns a DB error", async () => {
    mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: { message: "DB timeout" } });
    const ctx = makeContext({ boardId: VALID_BOARD_ID, login: VALID_LOGIN });
    const res = await summaryGET(ctx);
    expect(res.status).toBe(500);
    expect(mockLogger.error).toHaveBeenCalled();
  });

  // ── 200 happy path ────────────────────────────────────────────────────────────

  it("summary: 200 with service result on valid request", async () => {
    const ctx = makeContext({ boardId: VALID_BOARD_ID, login: VALID_LOGIN }, { period: "30d" });
    const res = await summaryGET(ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as typeof mockSummaryData;
    expect(body).toEqual(mockSummaryData);
  });

  it("summary: uses 90d as default period when not specified", async () => {
    const ctx = makeContext({ boardId: VALID_BOARD_ID, login: VALID_LOGIN });
    const res = await summaryGET(ctx);
    expect(res.status).toBe(200);
    // Service was called (regardless of period, it still returns 200)
    expect(getImpactSummary).toHaveBeenCalledOnce();
  });

  it("summary: 500 when service throws", async () => {
    (getImpactSummary as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("DB error"));
    const ctx = makeContext({ boardId: VALID_BOARD_ID, login: VALID_LOGIN });
    const res = await summaryGET(ctx);
    expect(res.status).toBe(500);
    expect(mockLogger.error).toHaveBeenCalled();
  });
});
