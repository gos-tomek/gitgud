import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getTokenWarning } from "@/lib/token-status";

interface MockSupabase {
  from: ReturnType<typeof vi.fn>;
}

function makeSupabase(tokenExpiresAt: string | null, error?: object): MockSupabase {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: tokenExpiresAt !== null ? { token_expires_at: tokenExpiresAt } : null,
    error: error ?? null,
  });
  const eq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  return { from };
}

const NOW = new Date("2026-06-25T12:00:00.000Z").getTime();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getTokenWarning", () => {
  it("returns a warning when the token expires within 7 days", async () => {
    const sixDaysFromNow = new Date(NOW + 6 * 24 * 60 * 60 * 1000).toISOString();
    const supabase = makeSupabase(sixDaysFromNow);

    const result = await getTokenWarning(supabase as never, "user-1");

    expect(result).not.toBeNull();
    expect(result?.message).toMatch(/expires in 6 days/);
    expect(result?.expiresAt).toBe(sixDaysFromNow);
  });

  it("returns null when the token expires in more than 7 days", async () => {
    const eightDaysFromNow = new Date(NOW + 8 * 24 * 60 * 60 * 1000).toISOString();
    const supabase = makeSupabase(eightDaysFromNow);

    const result = await getTokenWarning(supabase as never, "user-1");

    expect(result).toBeNull();
  });

  it("returns null when token_expires_at is null (token has no expiry)", async () => {
    const supabase = makeSupabase(null);

    const result = await getTokenWarning(supabase as never, "user-1");

    expect(result).toBeNull();
  });

  it("returns a warning when the token has already expired", async () => {
    const yesterday = new Date(NOW - 24 * 60 * 60 * 1000).toISOString();
    const supabase = makeSupabase(yesterday);

    const result = await getTokenWarning(supabase as never, "user-1");

    expect(result).not.toBeNull();
    expect(result?.message).toMatch(/has expired/);
  });

  it("returns null on a Supabase query error without throwing", async () => {
    const supabase = makeSupabase(null, { message: "db error" });

    const result = await getTokenWarning(supabase as never, "user-1");

    expect(result).toBeNull();
  });

  it("returns singular 'day' when exactly 1 day remains", async () => {
    const oneDayFromNow = new Date(NOW + 23 * 60 * 60 * 1000).toISOString();
    const supabase = makeSupabase(oneDayFromNow);

    const result = await getTokenWarning(supabase as never, "user-1");

    expect(result?.message).toMatch(/expires in 1 day[^s]/);
  });
});
