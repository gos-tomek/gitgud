import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parsePeriodSlug, isValidPeriodSlug, VALID_SLUGS } from "@/lib/date-range";

const FIXED_NOW = new Date("2025-10-15T12:00:00.000Z");
const DAY_MS = 86_400_000;

describe("isValidPeriodSlug", () => {
  it.each(VALID_SLUGS)("accepts valid slug '%s'", (slug) => {
    expect(isValidPeriodSlug(slug)).toBe(true);
  });

  it.each(["1d", "60d", "1y", "quarterly", "", "ALL", "90D"])("rejects invalid slug '%s'", (slug) => {
    expect(isValidPeriodSlug(slug)).toBe(false);
  });
});

describe("parsePeriodSlug with frozen time", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("7d: start is 7 days before now; previous period spans the preceding 7 days", () => {
    const r = parsePeriodSlug("7d");
    expect(r.end).toEqual(FIXED_NOW);
    expect(r.start).toEqual(new Date(FIXED_NOW.getTime() - 7 * DAY_MS));
    expect(r.previousEnd).toEqual(r.start);
    expect(r.previousStart).toEqual(new Date(FIXED_NOW.getTime() - 14 * DAY_MS));
  });

  it("30d: start is 30 days before now; previous period spans the preceding 30 days", () => {
    const r = parsePeriodSlug("30d");
    expect(r.end).toEqual(FIXED_NOW);
    expect(r.start).toEqual(new Date(FIXED_NOW.getTime() - 30 * DAY_MS));
    expect(r.previousEnd).toEqual(r.start);
    expect(r.previousStart).toEqual(new Date(FIXED_NOW.getTime() - 60 * DAY_MS));
  });

  it("90d: start is 90 days before now; previous period spans the preceding 90 days", () => {
    const r = parsePeriodSlug("90d");
    expect(r.end).toEqual(FIXED_NOW);
    expect(r.start).toEqual(new Date(FIXED_NOW.getTime() - 90 * DAY_MS));
    expect(r.previousEnd).toEqual(r.start);
    expect(r.previousStart).toEqual(new Date(FIXED_NOW.getTime() - 180 * DAY_MS));
  });

  it("6m: start is 6 calendar months before now", () => {
    const r = parsePeriodSlug("6m");
    expect(r.end).toEqual(FIXED_NOW);
    // Oct 15 - 6 months = Apr 15
    expect(r.start?.getUTCMonth()).toBe(3); // April (0-indexed)
    expect(r.start?.getUTCDate()).toBe(15);
    expect(r.previousEnd).toEqual(r.start);
    // previous start = Oct 15 - 12 months = Oct 15 previous year
    expect(r.previousStart?.getUTCMonth()).toBe(9); // October
    expect(r.previousStart?.getUTCFullYear()).toBe(2024);
  });

  it("ytd: start is Jan 1 of current year; previous period is Jan 1 to same date last year", () => {
    const r = parsePeriodSlug("ytd");
    expect(r.start?.getFullYear()).toBe(2025);
    expect(r.start?.getMonth()).toBe(0); // January
    expect(r.start?.getDate()).toBe(1);
    expect(r.previousStart?.getFullYear()).toBe(2024);
    expect(r.previousStart?.getMonth()).toBe(0);
    expect(r.previousStart?.getDate()).toBe(1);
    // previousEnd is same calendar date one year ago
    expect(r.previousEnd.getFullYear()).toBe(2024);
    expect(r.previousEnd.getMonth()).toBe(9); // October
    expect(r.previousEnd.getDate()).toBe(15);
  });

  it("all: start is null; previousStart is null; previousEnd is epoch", () => {
    const r = parsePeriodSlug("all");
    expect(r.start).toBeNull();
    expect(r.previousStart).toBeNull();
    expect(r.previousEnd).toEqual(new Date(0));
    expect(r.end).toEqual(FIXED_NOW);
  });

  it("invalid slug falls back to 90d", () => {
    const fallback = parsePeriodSlug("90d");
    const invalid = parsePeriodSlug("invalid-slug");
    // Both produce the same relative offsets — compare start offset from end
    const fallbackOffset = fallback.end.getTime() - (fallback.start?.getTime() ?? 0);
    const invalidOffset = invalid.end.getTime() - (invalid.start?.getTime() ?? 0);
    expect(invalidOffset).toBe(fallbackOffset);
  });

  it("previous period length equals current period length for day-based slugs", () => {
    for (const slug of ["7d", "30d", "90d"] as const) {
      const r = parsePeriodSlug(slug);
      const currentLen = r.end.getTime() - (r.start?.getTime() ?? 0);
      const previousLen = r.previousEnd.getTime() - (r.previousStart?.getTime() ?? 0);
      expect(previousLen).toBe(currentLen);
    }
  });
});
