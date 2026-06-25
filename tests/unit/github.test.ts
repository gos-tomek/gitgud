import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// astro:env/server is a virtual module — Vitest cannot resolve it without a factory mock.
// github.ts imports GITHUB_TOKEN_ENCRYPTION_KEY at module scope even though
// parseGitHubTokenExpiry itself doesn't use it.
vi.mock("astro:env/server", () => ({ GITHUB_TOKEN_ENCRYPTION_KEY: "test-encryption-key" }));

const { parseGitHubTokenExpiry } = await import("@/lib/github");

const FIXED_NOW = new Date("2026-06-25T12:00:00.000Z");

describe("parseGitHubTokenExpiry with frozen time", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("parses the named-timezone format (UTC)", () => {
    const result = parseGitHubTokenExpiry("2026-07-03 19:52:44 UTC");
    expect(result).toEqual(new Date("2026-07-03T19:52:44Z"));
  });

  it("parses the numeric-offset format", () => {
    const result = parseGitHubTokenExpiry("2026-09-05 17:55:53 +0500");
    expect(result).toEqual(new Date("2026-09-05T17:55:53+05:00"));
  });

  it("parses a negative numeric offset", () => {
    const result = parseGitHubTokenExpiry("2026-09-05 17:55:53 -0700");
    expect(result).toEqual(new Date("2026-09-05T17:55:53-07:00"));
  });

  it.each(["", "not a date", "2026-07-03", "2026-07-03 19:52:44"])(
    "returns null for an unparseable value: %j",
    (raw) => {
      expect(parseGitHubTokenExpiry(raw)).toBeNull();
    },
  );

  it("returns null for a date in the past (defensive against the 2025 GitHub header bug)", () => {
    const result = parseGitHubTokenExpiry("2026-06-01 00:00:00 UTC");
    expect(result).toBeNull();
  });
});
