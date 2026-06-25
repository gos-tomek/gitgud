import { describe, it, expect, vi, beforeEach } from "vitest";
import type { APIContext } from "astro";

vi.mock("astro:env/server", () => ({ GITHUB_TOKEN_ENCRYPTION_KEY: "test-encryption-key" }));

const mockLogger = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: mockLogger }));

const mockSupabase = vi.hoisted(() => ({ auth: { getUser: vi.fn() } }));
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

const { POST } = await import("@/pages/api/github/validate-pat");

function makeContext(body: unknown): APIContext {
  const request = new Request("http://localhost/api/github/validate-pat", {
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
});

describe("POST /api/github/validate-pat — expiry capture (hermetic)", () => {
  it("header present: returns the parsed ISO expiresAt", async () => {
    mockGetAuthenticated.mockResolvedValue({
      data: { login: "octocat", id: 1, avatar_url: "https://avatars.example/octocat.png" },
      headers: { "github-authentication-token-expiration": "2099-06-03 19:52:44 UTC" },
    });

    const res = await POST(makeContext({ pat: "ghp_test" }));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { expiresAt: string | null };
    expect(body.expiresAt).toBe("2099-06-03T19:52:44.000Z");
  });

  it("header absent (no-expiry token): returns expiresAt: null", async () => {
    mockGetAuthenticated.mockResolvedValue({
      data: { login: "octocat", id: 1, avatar_url: "https://avatars.example/octocat.png" },
      headers: {},
    });

    const res = await POST(makeContext({ pat: "ghp_test" }));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { expiresAt: string | null };
    expect(body.expiresAt).toBeNull();
  });

  it("malformed header: returns expiresAt: null rather than throwing", async () => {
    mockGetAuthenticated.mockResolvedValue({
      data: { login: "octocat", id: 1, avatar_url: "https://avatars.example/octocat.png" },
      headers: { "github-authentication-token-expiration": "not-a-date" },
    });

    const res = await POST(makeContext({ pat: "ghp_test" }));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { expiresAt: string | null };
    expect(body.expiresAt).toBeNull();
  });
});
