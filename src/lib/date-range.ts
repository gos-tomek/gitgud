import type { PeriodSlug, DateRange } from "@/types";

export type { PeriodSlug };

export const VALID_SLUGS = ["7d", "30d", "90d", "6m", "ytd", "all"] as const satisfies readonly PeriodSlug[];

export function isValidPeriodSlug(slug: string): slug is PeriodSlug {
  return (VALID_SLUGS as readonly string[]).includes(slug);
}

export function parsePeriodSlug(slug: string): DateRange {
  const normalized: PeriodSlug = isValidPeriodSlug(slug) ? slug : "90d";
  const now = new Date();

  switch (normalized) {
    case "7d":
      return makeDayRange(now, 7);
    case "30d":
      return makeDayRange(now, 30);
    case "90d":
      return makeDayRange(now, 90);
    case "6m":
      return makeMonthRange(now, 6);
    case "ytd":
      return makeYtdRange(now);
    case "all":
      return { start: null, end: now, previousStart: null, previousEnd: new Date(0) };
  }
}

function makeDayRange(now: Date, days: number): DateRange {
  const ms = days * 24 * 60 * 60 * 1000;
  const start = new Date(now.getTime() - ms);
  const previousEnd = new Date(start);
  const previousStart = new Date(start.getTime() - ms);
  return { start, end: now, previousStart, previousEnd };
}

function makeMonthRange(now: Date, months: number): DateRange {
  const start = new Date(now);
  start.setMonth(start.getMonth() - months);
  const previousEnd = new Date(start);
  const previousStart = new Date(start);
  previousStart.setMonth(previousStart.getMonth() - months);
  return { start, end: now, previousStart, previousEnd };
}

function makeYtdRange(now: Date): DateRange {
  const start = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
  const previousEnd = new Date(now);
  previousEnd.setFullYear(previousEnd.getFullYear() - 1);
  const previousStart = new Date(now.getFullYear() - 1, 0, 1, 0, 0, 0, 0);
  return { start, end: now, previousStart, previousEnd };
}
