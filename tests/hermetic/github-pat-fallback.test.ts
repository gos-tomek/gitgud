import { describe, it, expect, vi, beforeEach } from "vitest";
import type { APIContext, APIRoute } from "astro";

// astro:env/server is a virtual module — Vitest cannot resolve it without a factory mock.
vi.mock("astro:env/server", () => ({ GITHUB_TOKEN_ENCRYPTION_KEY: "test-encryption-key" }));

const mockLogger = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: mockLogger }));

const mockSupabase = vi.hoisted(() => ({
  auth: { getUser: vi.fn() },
  rpc: vi.fn(),
}));
vi.mock("@/lib/supabase", () => ({ createClient: vi.fn(() => mockSupabase) }));

// makeOctokit is stubbed to a minimal fake — these tests exercise only the new optional-pat /
// RPC-fallback branching added in p3, not the pre-existing repo/collaborator listing logic.
class FakeGitHubAuthError extends Error {}
const fakeOctokit = {
  rest: {
    repos: {
      listForAuthenticatedUser: vi.fn(),
      listContributors: vi.fn(),
      get: vi.fn().mockResolvedValue({
        data: { owner: { login: "octocat" }, name: "hello-world", full_name: "octocat/hello-world", private: false },
      }),
    },
  },
  paginate: { iterator: () => ({ [Symbol.asyncIterator]: () => ({ next: () => Promise.resolve({ done: true }) }) }) },
};
const mockMakeOctokit = vi.hoisted(() => vi.fn());
vi.mock("@/lib/github", () => ({
  makeOctokit: mockMakeOctokit,
  GitHubAuthError: FakeGitHubAuthError,
}));

const { POST: reposPost } = await import("@/pages/api/github/repos");
const { POST: collaboratorsPost } = await import("@/pages/api/github/collaborators");
const { POST: validateRepoPost } = await import("@/pages/api/github/validate-repo");

function makeContext(body: unknown): APIContext {
  const request = new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { request, cookies: {} } as unknown as APIContext;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockMakeOctokit.mockReturnValue(fakeOctokit);
  mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
});

describe("optional pat + get_user_github_pat_by_user_id fallback", () => {
  describe.each<{ name: string; handler: APIRoute; body: Record<string, unknown> }>([
    { name: "POST /api/github/repos", handler: reposPost, body: {} },
    {
      name: "POST /api/github/collaborators",
      handler: collaboratorsPost,
      body: { repos: [{ owner: "octocat", name: "hello-world" }] },
    },
    {
      name: "POST /api/github/validate-repo",
      handler: validateRepoPost,
      body: { owner: "octocat", name: "hello-world" },
    },
  ])("$name", ({ handler, body }) => {
    it("pat provided directly: uses it, never calls get_user_github_pat_by_user_id", async () => {
      const res = await handler(makeContext({ ...body, pat: "ghp_directtoken" }));

      expect(res.status).toBe(200);
      expect(mockSupabase.rpc).not.toHaveBeenCalled();
      expect(mockMakeOctokit).toHaveBeenCalledWith("ghp_directtoken");
    });

    it("pat absent, rpc resolves a stored token: decrypts and uses it", async () => {
      mockSupabase.rpc.mockResolvedValueOnce({ data: "ghp_decryptedtoken", error: null });
      const res = await handler(makeContext(body));

      expect(res.status).toBe(200);
      expect(mockSupabase.rpc).toHaveBeenCalledWith("get_user_github_pat_by_user_id", {
        p_user_id: "user-1",
        p_encryption_key: "test-encryption-key",
      });
      expect(mockMakeOctokit).toHaveBeenCalledWith("ghp_decryptedtoken");
    });

    it("pat absent, rpc resolves null (no stored token): 400 with a friendly message, makeOctokit never called", async () => {
      mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: null });
      const res = await handler(makeContext(body));

      expect(res.status).toBe(400);
      const json = (await res.json()) as { error: string };
      expect(json.error).toBe("No GitHub token configured — save one in Profile Settings first");
      expect(mockMakeOctokit).not.toHaveBeenCalled();
    });

    it("pat absent, rpc errors: 400 with a friendly message, makeOctokit never called", async () => {
      mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: { message: "decrypt failed" } });
      const res = await handler(makeContext(body));

      expect(res.status).toBe(400);
      expect(mockMakeOctokit).not.toHaveBeenCalled();
    });
  });
});
