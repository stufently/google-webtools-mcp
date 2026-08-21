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

/**
 * How many days back from today the last day of *complete* Search Console data
 * is assumed to be when the real boundary cannot be determined.
 *
 * Search Console keeps collecting and processing data for the most recent days:
 * with `dataState: "final"` those days are simply absent, and with
 * `dataState: "all"` they are present but still growing. Either way a window
 * that runs up to yesterday ends in a partial tail, which reads as a traffic
 * collapse when it is compared against a fully settled earlier window.
 *
 * The lag is not a constant — it drifts, and it differs between properties —
 * so this is only the fallback. Prefer passing the boundary observed from the
 * API itself (see `resolveLatestCompleteDate` in `api/data-freshness.ts`).
 */
export const GSC_DATA_LAG_DAYS = 3;

export interface DateRangeOptions {
  /**
   * Last date (`YYYY-MM-DD`) known to hold complete data. The range ends here.
   * Normally obtained by probing the API rather than assumed.
   */
  latestCompleteDate?: string;
  /**
   * Fallback lag in days, used only when `latestCompleteDate` is absent.
   * Defaults to {@link GSC_DATA_LAG_DAYS}.
   */
  lagDays?: number;
}

/**
 * The assumed last day of complete data: today minus `lagDays`.
 *
 * Exposed so callers (and tests) can reproduce the fallback anchor without
 * duplicating the arithmetic.
 */
export function getFallbackLatestCompleteDate(
  lagDays: number = GSC_DATA_LAG_DAYS,
  now: Date = new Date(),
): string {
  const anchor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  anchor.setDate(anchor.getDate() - lagDays);
  return formatDate(anchor);
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
 * `endDate` is the last day of **complete** data, not yesterday: pass
 * `latestCompleteDate` (observed from the API) or let it fall back to
 * today minus {@link GSC_DATA_LAG_DAYS}.
 *
 * Ending the window at yesterday used to pull Search Console's still-settling
 * tail into the current period while the comparison period was fully settled,
 * manufacturing declines that never happened — most visibly on `last7d`, where
 * three unsettled days are nearly half the window.
 *
 * Because {@link getPreviousPeriod} derives the comparison window from this
 * range, moving the anchor keeps both windows the same length and shifts them
 * together.
 */
/**
 * Go back `months` calendar months, clamping to the last day of the target
 * month instead of spilling into the next one.
 *
 * `Date.setMonth` alone turns May 31 minus three months into March 2, which
 * silently shortens the window on month ends.
 */
function subtractMonths(date: Date, months: number): Date {
  const day = date.getDate();
  const anchor = new Date(date.getFullYear(), date.getMonth(), 1);
  anchor.setMonth(anchor.getMonth() - months);

  const lastDayOfTargetMonth = new Date(
    anchor.getFullYear(),
    anchor.getMonth() + 1,
    0,
  ).getDate();

  anchor.setDate(Math.min(day, lastDayOfTargetMonth));
  return anchor;
}

export function getDateRange(
  period: DatePeriod,
  options: DateRangeOptions = {},
): DateRange {
  const end = parseDate(
    options.latestCompleteDate ??
      getFallbackLatestCompleteDate(options.lagDays ?? GSC_DATA_LAG_DAYS),
  );

  let start = new Date(end);

  switch (period) {
    case "last7d":
      start.setDate(start.getDate() - 6); // 7 days inclusive
      break;
    case "last28d":
      start.setDate(start.getDate() - 27); // 28 days inclusive
      break;
    case "last3m":
      start = subtractMonths(start, 3);
      break;
    case "last6m":
      start = subtractMonths(start, 6);
      break;
    case "last12m":
      start = subtractMonths(start, 12);
      break;
    case "last16m":
      start = subtractMonths(start, 16);
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

  if (end.getTime() < start.getTime()) {
    throw new RangeError("startDate must be before endDate");
  }

  // Calendar-day arithmetic, not fixed 24-hour blocks: in a timezone with
  // daylight saving a "day" is occasionally 23 or 25 hours long, and adding
  // milliseconds would land the boundary on the wrong date.
  const lengthDays = daysBetween(startDate, endDate) + 1;

  const prevEnd = new Date(start);
  prevEnd.setDate(prevEnd.getDate() - 1);

  const prevStart = new Date(prevEnd);
  prevStart.setDate(prevStart.getDate() - (lengthDays - 1));

  return {
    startDate: formatDate(prevStart),
    endDate: formatDate(prevEnd),
  };
}
