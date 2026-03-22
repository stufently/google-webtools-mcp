/**
 * Date helpers for GSC analytics work.
 *
 * All date strings use the `YYYY-MM-DD` format expected by the
 * Search Console API.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DatePeriod =
  | "last7d"
  | "last28d"
  | "last3m"
  | "last6m"
  | "last12m"
  | "last16m";

export interface DateRange {
  startDate: string;
  endDate: string;
}

// ---------------------------------------------------------------------------
// Core helpers
// ---------------------------------------------------------------------------

/**
 * Format a `Date` as `YYYY-MM-DD`.
 */
export function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Parse a `YYYY-MM-DD` string into a `Date` (local time, midnight).
 * Throws on invalid input.
 */
export function parseDate(str: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
  if (!match) {
    throw new Error(`Invalid date string: "${str}". Expected YYYY-MM-DD.`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]) - 1; // 0-indexed
  const day = Number(match[3]);

  const date = new Date(year, month, day);

  // Guard against overflows like "2024-02-30" silently becoming March.
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month ||
    date.getDate() !== day
  ) {
    throw new Error(`Invalid date: "${str}" does not represent a real date.`);
  }

  return date;
}

/**
 * Return the number of whole days between two `YYYY-MM-DD` strings.
 * The result is always non-negative.
 */
export function daysBetween(start: string, end: string): number {
  const startMs = parseDate(start).getTime();
  const endMs = parseDate(end).getTime();
  return Math.round(Math.abs(endMs - startMs) / 86_400_000);
}

/**
 * Check whether `dateStr` falls within `daysThreshold` days of today
 * (inclusive, looking backwards).
 */
export function isDateFresh(dateStr: string, daysThreshold: number): boolean {
  const target = parseDate(dateStr);
  const now = new Date();
  // Normalize "today" to midnight for a fair comparison.
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffMs = today.getTime() - target.getTime();
  const diffDays = diffMs / 86_400_000;
  return diffDays >= 0 && diffDays <= daysThreshold;
}

// ---------------------------------------------------------------------------
// Range builders
// ---------------------------------------------------------------------------

/**
 * Build a `{ startDate, endDate }` range for a named period.
 *
 * `endDate` is always **yesterday** (GSC data is typically delayed by ~2 days,
 * but yesterday is the latest date the API accepts for queries).
 */
export function getDateRange(period: DatePeriod): DateRange {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // End date = yesterday.
  const end = new Date(today);
  end.setDate(end.getDate() - 1);

  const start = new Date(end);

  switch (period) {
    case "last7d":
      start.setDate(start.getDate() - 6); // 7 days inclusive
      break;
    case "last28d":
      start.setDate(start.getDate() - 27); // 28 days inclusive
      break;
    case "last3m":
      start.setMonth(start.getMonth() - 3);
      break;
    case "last6m":
      start.setMonth(start.getMonth() - 6);
      break;
    case "last12m":
      start.setMonth(start.getMonth() - 12);
      break;
    case "last16m":
      start.setMonth(start.getMonth() - 16);
      break;
  }

  return {
    startDate: formatDate(start),
    endDate: formatDate(end),
  };
}

/**
 * Given an existing date range, return the same-length period immediately
 * preceding it.
 *
 * Example: if the input spans 2024-01-15 to 2024-01-21 (7 days), the
 * previous period is 2024-01-08 to 2024-01-14.
 */
export function getPreviousPeriod(
  startDate: string,
  endDate: string,
): DateRange {
  const start = parseDate(startDate);
  const end = parseDate(endDate);

  const spanMs = end.getTime() - start.getTime();
  if (spanMs < 0) {
    throw new RangeError("startDate must be before endDate");
  }

  // Length in days (inclusive range → +1 day offset).
  const lengthMs = spanMs + 86_400_000;

  const prevEnd = new Date(start.getTime() - 86_400_000);
  const prevStart = new Date(prevEnd.getTime() - lengthMs + 86_400_000);

  return {
    startDate: formatDate(prevStart),
    endDate: formatDate(prevEnd),
  };
}
