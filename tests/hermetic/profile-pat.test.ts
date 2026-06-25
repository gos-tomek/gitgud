import { describe, it, expect, vi, beforeEach } from "vitest";
import type { APIContext } from "astro";

vi.mock("astro:env/server", () => ({ GITHUB_TOKEN_ENCRYPTION_KEY: "test-encryption-key" }));

const mockLogger = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: mockLogger }));

const mockSupabase = vi.hoisted(() => ({ auth: { getUser: vi.fn() }, rpc: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ createClient: vi.fn(() => mockSupabase) }));

class FakeGitHubAuthError extends Error {}
const mockGetAuthenticated = vi.hoisted(() => vi.fn());
const mockMakeOctokit = vi.hoisted(() => vi.fn());
vi.mock("@/lib/github", async () => {
  const actual = await vi.importActual<typeof import("@/lib/github")>("@/lib/github");
  return {
    ...actual,
    makeOctokit: mockMakeOctokit,
    GitHubAuthError: FakeGitHubAuthError,
  };
});

const { POST } = await import("@/pages/api/profile/pat");

function makeContext(body: unknown): APIContext {
  const request = new Request("http://localhost/api/profile/pat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { request, cookies: {} } as unknown as APIContext;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  mockMakeOctokit.mockReturnValue({ rest: { users: { getAuthenticated: mockGetAuthenticated } } });
  mockSupabase.rpc.mockResolvedValue({ data: null, error: null });
});

describe("POST /api/profile/pat (hermetic)", () => {
  it("valid token with expiry: encrypts + stores via set_user_github_pat, returns login + expiresAt", async () => {
    mockGetAuthenticated.mockResolvedValue({
      data: { login: "octocat" },
      headers: { "github-authentication-token-expiration": "2099-06-03 19:52:44 UTC" },
    });

    const res = await POST(makeContext({ pat: "ghp_validtoken" }));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { login: string; expiresAt: string | null };
    expect(body).toEqual({ login: "octocat", expiresAt: "2099-06-03T19:52:44.000Z" });
    expect(mockSupabase.rpc).toHaveBeenCalledWith("set_user_github_pat", {
      p_user_id: "user-1",
      p_raw_token: "ghp_validtoken",
      p_encryption_key: "test-encryption-key",
      p_expires_at: "2099-06-03T19:52:44.000Z",
      p_github_login: "octocat",
    });
  });

  it("valid token with no expiry header: stores p_expires_at: null", async () => {
    mockGetAuthenticated.mockResolvedValue({ data: { login: "octocat" }, headers: {} });

    const res = await POST(makeContext({ pat: "ghp_validtoken" }));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { expiresAt: string | null };
    expect(body.expiresAt).toBeNull();
    expect(mockSupabase.rpc).toHaveBeenCalledWith(
      "set_user_github_pat",
      expect.objectContaining({ p_expires_at: null }),
    );
  });

  it("invalid token: GitHubAuthError surfaces as 401, rpc is never called", async () => {
    mockGetAuthenticated.mockRejectedValue(new FakeGitHubAuthError("bad token"));

    const res = await POST(makeContext({ pat: "ghp_badtoken" }));

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Token is invalid or expired");
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it("missing pat: returns 400, never calls GitHub or rpc", async () => {
    const res = await POST(makeContext({ pat: "" }));

    expect(res.status).toBe(400);
    expect(mockMakeOctokit).not.toHaveBeenCalled();
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it("no session: returns 401, never calls GitHub or rpc", async () => {
    mockSupabase.auth.getUser.mockResolvedValueOnce({ data: { user: null } });

    const res = await POST(makeContext({ pat: "ghp_validtoken" }));

    expect(res.status).toBe(401);
    expect(mockMakeOctokit).not.toHaveBeenCalled();
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it("rpc failure: returns 500 and logs the detail", async () => {
    mockGetAuthenticated.mockResolvedValue({ data: { login: "octocat" }, headers: {} });
    mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: { message: "db error" } });

    const res = await POST(makeContext({ pat: "ghp_validtoken" }));

    expect(res.status).toBe(500);
    expect(mockLogger.error).toHaveBeenCalledWith(
      "[profile/pat] set_user_github_pat failed",
      expect.objectContaining({ userId: "user-1", detail: "db error" }),
    );
  });
});
