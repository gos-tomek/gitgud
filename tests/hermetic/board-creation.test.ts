import { describe, it, expect, vi, beforeEach } from "vitest";
import type { APIContext } from "astro";

// astro:env/server is a virtual module — Vitest cannot resolve it without a factory mock.
vi.mock("astro:env/server", () => ({
  GITHUB_TOKEN_ENCRYPTION_KEY: "test-encryption-key",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_KEY: "test-supabase-key",
}));

const mockLogger = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({ logger: mockLogger }));

// BoardNameTakenError must be re-declared here because index.ts uses `instanceof`
// checks against the class exported from this mocked module.
const mockBoardServices = vi.hoisted(() => ({
  createBoard: vi.fn(),
  addBoardContributors: vi.fn(),
  BoardNameTakenError: class BoardNameTakenError extends Error {
    constructor() {
      super("You already have a board with that name");
      this.name = "BoardNameTakenError";
    }
  },
}));
vi.mock("@/lib/services/boards", () => mockBoardServices);

const mockSupabase = vi.hoisted(() => ({
  auth: { getUser: vi.fn() },
  rpc: vi.fn(),
  from: vi.fn(),
}));
const mockRepoInsert = vi.hoisted(() => vi.fn());
const mockDeleteEq = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase", () => ({ createClient: vi.fn(() => mockSupabase) }));

const { POST } = await import("@/pages/api/boards/index");

interface CreateBoardBody {
  name: string;
  pat: string;
  repos: { owner: string; name: string }[];
  contributors: { githubId: number; githubLogin: string; avatarUrl?: string }[];
}

const validBody: CreateBoardBody = {
  name: "Test Board",
  pat: "ghp_testtoken123",
  repos: [{ owner: "octocat", name: "hello-world" }],
  contributors: [{ githubId: 1, githubLogin: "octocat", avatarUrl: "https://avatars.example/octocat.png" }],
};

function makeContext(body: unknown): APIContext {
  const request = new Request("http://localhost/api/boards", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { request, cookies: {} } as unknown as APIContext;
}

describe("POST /api/boards (hermetic)", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    mockSupabase.rpc.mockResolvedValue({ error: null });
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === "github_repos") return { insert: mockRepoInsert };
      if (table === "boards") return { delete: vi.fn(() => ({ eq: mockDeleteEq })) };
      throw new Error(`Unexpected table: ${table}`);
    });
    mockRepoInsert.mockResolvedValue({ error: null });
    mockDeleteEq.mockResolvedValue({ error: null });

    mockBoardServices.createBoard.mockResolvedValue({ id: "board-1" });
    mockBoardServices.addBoardContributors.mockResolvedValue(undefined);
  });

  it("H1: happy path - all 4 steps succeed returns 201 with board id", async () => {
    const res = await POST(makeContext(validBody));

    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string };
    expect(body).toEqual({ id: "board-1" });
  });

  it("H2: step 1 fails (unique name, 23505) returns 409, no further calls", async () => {
    mockBoardServices.createBoard.mockRejectedValueOnce(new mockBoardServices.BoardNameTakenError());

    const res = await POST(makeContext(validBody));

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("You already have a board with that name");
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
    expect(mockBoardServices.addBoardContributors).not.toHaveBeenCalled();
  });

  it("H3: step 2 fails (PAT storage) returns 500, board not deleted", async () => {
    mockSupabase.rpc.mockResolvedValueOnce({ error: { message: "permission denied" } });

    const res = await POST(makeContext(validBody));

    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Failed to store GitHub token. Please try again.");
    // Known defect S3: PAT storage failure returns 500 without deleting the board
    // created in step 1, orphaning it (blocks retry via the unique-name constraint).
    expect(mockSupabase.from).not.toHaveBeenCalledWith("boards");
  });

  it("H4: step 3 fails (repo linking) returns 201, addBoardContributors still called", async () => {
    mockRepoInsert.mockResolvedValueOnce({ error: { message: "constraint violation" } });

    const res = await POST(makeContext(validBody));

    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string };
    expect(body).toEqual({ id: "board-1" });
    // Known defect S4: repo linking failure is logged as a warning and swallowed —
    // the endpoint returns 201 even though the board has zero repos.
    expect(mockBoardServices.addBoardContributors).toHaveBeenCalled();
  });

  it("H5: step 4 fails, cleanup succeeds - returns 500 and deletes the board by id", async () => {
    mockBoardServices.addBoardContributors.mockRejectedValueOnce(new Error("insert failed"));

    const res = await POST(makeContext(validBody));

    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Something went wrong. Please try again.");
    expect(mockSupabase.from).toHaveBeenCalledWith("boards");
    expect(mockDeleteEq).toHaveBeenCalledWith("id", "board-1");
  });

  it("H6: step 4 fails, cleanup also fails - returns 500 and logs the cleanup failure", async () => {
    mockBoardServices.addBoardContributors.mockRejectedValueOnce(new Error("insert failed"));
    mockDeleteEq.mockResolvedValueOnce({ error: { message: "delete denied" } });

    const res = await POST(makeContext(validBody));

    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Something went wrong. Please try again.");
    // Cleanup-of-cleanup failure orphans the board (S6) — the endpoint still returns
    // 500, but the failure is recorded so it can be diagnosed from logs.
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining("Cleanup delete failed"));
  });

  describe("H7: validation - missing/invalid fields", () => {
    it.each<[string, CreateBoardBody, string]>([
      ["name", { ...validBody, name: "" }, "Board name is required"],
      ["pat", { ...validBody, pat: "" }, "GitHub token is required"],
      ["repos", { ...validBody, repos: [] }, "At least one repository is required"],
      ["contributors", { ...validBody, contributors: [] }, "At least one contributor is required"],
    ])("H7 (%s): returns 400 with the field-specific message", async (_field, body, expectedMessage) => {
      const res = await POST(makeContext(body));

      expect(res.status).toBe(400);
      const json = (await res.json()) as { error: string };
      expect(json.error).toBe(expectedMessage);
    });
  });

  it("H8: no session returns 401", async () => {
    mockSupabase.auth.getUser.mockResolvedValueOnce({ data: { user: null } });

    const res = await POST(makeContext(validBody));

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Unauthorized");
  });
});
