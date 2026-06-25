import { describe, it, expect, vi, beforeEach } from "vitest";
import type { APIContext } from "astro";

vi.mock("astro:env/server", () => ({ SUPABASE_URL: "http://localhost:54321", SUPABASE_SERVICE_KEY: "service-key" }));

const mockLogger = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: mockLogger }));

const mockSupabase = vi.hoisted(() => ({ auth: { getUser: vi.fn() } }));
vi.mock("@/lib/supabase", () => ({ createClient: vi.fn(() => mockSupabase) }));

const mockDeleteUser = vi.hoisted(() => vi.fn());
const mockCreateServiceClient = vi.hoisted(() => vi.fn(() => ({ auth: { admin: { deleteUser: mockDeleteUser } } })));
vi.mock("@/lib/supabase-admin", () => ({ createServiceClient: mockCreateServiceClient }));

const { DELETE } = await import("@/pages/api/profile/index");

function makeContext(): APIContext {
  const request = new Request("http://localhost/api/profile", { method: "DELETE" });
  return { request, cookies: {} } as unknown as APIContext;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  mockDeleteUser.mockResolvedValue({ error: null });
});

describe("DELETE /api/profile (hermetic)", () => {
  it("deletes the authenticated user via the service client", async () => {
    const res = await DELETE(makeContext());

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body).toEqual({ ok: true });
    expect(mockCreateServiceClient).toHaveBeenCalledWith("http://localhost:54321", "service-key");
    expect(mockDeleteUser).toHaveBeenCalledWith("user-1");
  });

  it("no session: returns 401, never calls deleteUser", async () => {
    mockSupabase.auth.getUser.mockResolvedValueOnce({ data: { user: null } });

    const res = await DELETE(makeContext());

    expect(res.status).toBe(401);
    expect(mockDeleteUser).not.toHaveBeenCalled();
  });

  it("deleteUser failure: returns 500 and logs the detail", async () => {
    mockDeleteUser.mockResolvedValueOnce({ error: { message: "db error" } });

    const res = await DELETE(makeContext());

    expect(res.status).toBe(500);
    expect(mockLogger.error).toHaveBeenCalledWith(
      "[profile] deleteUser failed",
      expect.objectContaining({ userId: "user-1", detail: "db error" }),
    );
  });
});
