import { describe, it, expect, vi, beforeEach } from "vitest";
import type { APIContext } from "astro";

const mockLogger = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: mockLogger }));

const mockSupabase = vi.hoisted(() => ({
  auth: { getUser: vi.fn(), signInWithPassword: vi.fn(), updateUser: vi.fn() },
}));
vi.mock("@/lib/supabase", () => ({ createClient: vi.fn(() => mockSupabase) }));

const { POST } = await import("@/pages/api/profile/password");

function makeContext(body: unknown): APIContext {
  const request = new Request("http://localhost/api/profile/password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { request, cookies: {} } as unknown as APIContext;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: "user-1", email: "user@test.local" } } });
  mockSupabase.auth.signInWithPassword.mockResolvedValue({ error: null });
  mockSupabase.auth.updateUser.mockResolvedValue({ error: null });
});

describe("POST /api/profile/password (hermetic)", () => {
  it("re-verifies the current password, then updates to the new one", async () => {
    const res = await POST(makeContext({ currentPassword: "old-password", newPassword: "new-password-123" }));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body).toEqual({ ok: true });
    expect(mockSupabase.auth.signInWithPassword).toHaveBeenCalledWith({
      email: "user@test.local",
      password: "old-password",
    });
    expect(mockSupabase.auth.updateUser).toHaveBeenCalledWith({ password: "new-password-123" });
  });

  it("wrong current password: returns 401, never calls updateUser", async () => {
    mockSupabase.auth.signInWithPassword.mockResolvedValueOnce({ error: { message: "bad credentials" } });

    const res = await POST(makeContext({ currentPassword: "wrong-password", newPassword: "new-password-123" }));

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Current password is incorrect");
    expect(mockSupabase.auth.updateUser).not.toHaveBeenCalled();
  });

  it("new password too short: returns 400, never calls Supabase", async () => {
    const res = await POST(makeContext({ currentPassword: "old-password", newPassword: "abc" }));

    expect(res.status).toBe(400);
    expect(mockSupabase.auth.signInWithPassword).not.toHaveBeenCalled();
    expect(mockSupabase.auth.updateUser).not.toHaveBeenCalled();
  });

  it("no session: returns 401, never calls Supabase", async () => {
    mockSupabase.auth.getUser.mockResolvedValueOnce({ data: { user: null } });

    const res = await POST(makeContext({ currentPassword: "old-password", newPassword: "new-password-123" }));

    expect(res.status).toBe(401);
    expect(mockSupabase.auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it("updateUser failure: returns 500 and logs the detail", async () => {
    mockSupabase.auth.updateUser.mockResolvedValueOnce({ error: { message: "db error" } });

    const res = await POST(makeContext({ currentPassword: "old-password", newPassword: "new-password-123" }));

    expect(res.status).toBe(500);
    expect(mockLogger.error).toHaveBeenCalledWith(
      "[profile/password] updateUser failed",
      expect.objectContaining({ userId: "user-1", detail: "db error" }),
    );
  });
});
