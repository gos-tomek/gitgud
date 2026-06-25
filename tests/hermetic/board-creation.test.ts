import { describe, it, expect, vi, beforeEach } from "vitest";
import type { APIContext } from "astro";

const mockLogger = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({ logger: mockLogger }));

const mockSupabase = vi.hoisted(() => ({
  auth: { getUser: vi.fn() },
  rpc: vi.fn(),
}));
vi.mock("@/lib/supabase", () => ({ createClient: vi.fn(() => mockSupabase) }));

const { POST } = await import("@/pages/api/board/index");

interface CreateBoardBody {
  name: string;
  repos: { owner: string; name: string }[];
  contributors: { githubId: number; githubLogin: string; avatarUrl?: string }[];
}

const validBody: CreateBoardBody = {
  name: "Test Board",
  repos: [{ owner: "octocat", name: "hello-world" }],
  contributors: [{ githubId: 1, githubLogin: "octocat", avatarUrl: "https://avatars.example/octocat.png" }],
};

function makeContext(body: unknown): APIContext {
  const request = new Request("http://localhost/api/board", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { request, cookies: {} } as unknown as APIContext;
}

describe("POST /api/board (hermetic)", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    mockSupabase.rpc.mockResolvedValue({ data: "board-1", error: null });
  });

  it("happy path: rpc succeeds, returns 201 with board id, calls rpc with mapped args", async () => {
    const res = await POST(makeContext(validBody));

    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string };
    expect(body).toEqual({ id: "board-1" });
    expect(mockSupabase.rpc).toHaveBeenCalledWith("create_board_atomic", {
      p_user_id: "user-1",
      p_name: "Test Board",
      p_repos: [{ owner: "octocat", name: "hello-world" }],
      p_contributors: [{ github_id: 1, github_login: "octocat", avatar_url: "https://avatars.example/octocat.png" }],
    });
  });

  it("no stored PAT: rpc raises the no-token exception, returns 400 with a friendly message", async () => {
    mockSupabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "P0001", message: "No GitHub token configured — save one in Profile Settings first" },
    });

    const res = await POST(makeContext(validBody));

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("No GitHub token configured — save one in Profile Settings first");
  });

  it("duplicate name: rpc returns 23505 returns 409 with the duplicate-name message", async () => {
    mockSupabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "23505", message: "duplicate key value violates unique constraint" },
    });

    const res = await POST(makeContext(validBody));

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("You already have a board with that name");
  });

  it("generic rpc failure returns 500 with a generic message and logs the pg error detail", async () => {
    mockSupabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "XX000", message: "internal error" },
    });

    const res = await POST(makeContext(validBody));

    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Board creation failed. Please try again.");
    expect(mockLogger.error).toHaveBeenCalledWith(
      "[boards] create_board_atomic failed",
      expect.objectContaining({ boardName: "Test Board", userId: "user-1", pgCode: "XX000", detail: "internal error" }),
    );
  });

  it("rpc throws (e.g. network error) returns 500 with a generic message and logs", async () => {
    mockSupabase.rpc.mockRejectedValueOnce(new Error("network timeout"));

    const res = await POST(makeContext(validBody));

    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Board creation failed. Please try again.");
    expect(mockLogger.error).toHaveBeenCalledWith(
      "[boards] create_board_atomic threw",
      expect.objectContaining({ boardName: "Test Board", userId: "user-1" }),
      expect.any(Error),
    );
  });

  describe("validation: missing/empty fields", () => {
    it.each<[string, CreateBoardBody, string]>([
      ["name", { ...validBody, name: "" }, "Board name is required"],
      ["repos", { ...validBody, repos: [] }, "At least one repository is required"],
      ["contributors", { ...validBody, contributors: [] }, "At least one contributor is required"],
    ])(
      "%s: returns 400 with the field-specific message, rpc is never called",
      async (_field, body, expectedMessage) => {
        const res = await POST(makeContext(body));

        expect(res.status).toBe(400);
        const json = (await res.json()) as { error: string };
        expect(json.error).toBe(expectedMessage);
        expect(mockSupabase.rpc).not.toHaveBeenCalled();
      },
    );
  });

  it("no session returns 401, rpc is never called", async () => {
    mockSupabase.auth.getUser.mockResolvedValueOnce({ data: { user: null } });

    const res = await POST(makeContext(validBody));

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Unauthorized");
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });
});
