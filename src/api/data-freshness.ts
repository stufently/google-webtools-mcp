/**
 * Finding the real edge of Search Console data.
 *
 * Search Console publishes search analytics with a lag: the most recent days
 * are still being collected and processed. The lag is not fixed — it drifts
 * day to day and differs between properties — so any hard-coded "minus three
 * days" is a guess that is wrong part of the time.
 *
 * The API can be asked instead. A query with `dataState: "all"` grouped by
 * date comes back with `metadata.first_incomplete_date` — the first day still
 * being collected — so the day before it is the last complete one. That is the
 * boundary the reporting windows are anchored to.
 *
 * Deliberately not used: "the newest date present in a `final` response".
 * Search Console omits days with no traffic entirely, so on a quiet property
 * that reads a gap in traffic as a gap in publishing and drags every window
 * back to the last day that happened to have a click.
 *
 * The fixed lag survives only as a fallback for when the API does not report
 * the boundary at all, or when the probe fails.
 */

import {
  formatDate,
  getDateRange,
  getFallbackLatestCompleteDate,
  GSC_DATA_LAG_DAYS,
  parseDate,
  type DatePeriod,
  type DateRange,
} from '../utils/date-helpers.js';
import type { SearchAnalyticsRequest, SearchAnalyticsResponse } from './types.js';

/**
 * How far back the probe window reaches.
 *
 * It only has to be long enough that the API has something to report the
 * boundary against; the answer itself comes from the response metadata.
 */
export const FRESHNESS_PROBE_WINDOW_DAYS = 14;

/**
 * The slice of the API client this module needs. Structural, so tests can pass
 * a stub and so `api/client.ts` is free to import from here without a cycle.
 */
export interface SearchAnalyticsQuerier {
  querySearchAnalytics(request: SearchAnalyticsRequest): Promise<SearchAnalyticsResponse>;
}

export interface LatestCompleteDate {
  /** `YYYY-MM-DD` — the last day whose data is complete. */
  date: string;
  /**
   * `probe` — reported by the API. `fallback` — the API had nothing to say and
   * {@link GSC_DATA_LAG_DAYS} was assumed.
   */
  source: 'probe' | 'fallback';
}

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

export interface ResolveOptions {
  /** Overrides "now"; tests use it, callers do not. */
  now?: Date;
  /** Fallback lag when the probe comes back empty. */
  lagDays?: number;
  /**
   * Search type the caller is about to query. Publishing is not guaranteed to
   * advance in lockstep across types, so the boundary is resolved for the same
   * type the data will be read with.
   */
  searchType?: SearchAnalyticsRequest['searchType'];
}

/**
 * Ask the API for the last day of complete data for `siteUrl`.
 *
 * Never throws: a probe that fails is a probe that could not answer, and the
 * caller gets the fallback anchor. The real query that follows will surface
 * any genuine auth or permission problem on its own.
 */
export async function resolveLatestCompleteDate(
  api: SearchAnalyticsQuerier,
  siteUrl: string,
  options: ResolveOptions = {},
): Promise<LatestCompleteDate> {
  const now = options.now ?? new Date();
  const lagDays = options.lagDays ?? GSC_DATA_LAG_DAYS;
  const fallback: LatestCompleteDate = {
    date: getFallbackLatestCompleteDate(lagDays, now),
    source: 'fallback',
  };

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const probeStart = new Date(today);
  probeStart.setDate(probeStart.getDate() - FRESHNESS_PROBE_WINDOW_DAYS);

  try {
    const response = await api.querySearchAnalytics({
      siteUrl,
      startDate: formatDate(probeStart),
      endDate: formatDate(today),
      dimensions: ['date'],
      // "all" plus a date grouping is exactly the combination the API answers
      // with first_incomplete_date; under "final" it says nothing.
      dataState: 'all',
      rowLimit: FRESHNESS_PROBE_WINDOW_DAYS + 1,
      ...(options.searchType !== undefined ? { searchType: options.searchType } : {}),
    });

    const firstIncomplete = response.metadata?.first_incomplete_date;
    if (firstIncomplete === undefined || !DATE_KEY.test(firstIncomplete)) {
      return fallback;
    }

    const lastComplete = parseDate(firstIncomplete);
    lastComplete.setDate(lastComplete.getDate() - 1);
    return { date: formatDate(lastComplete), source: 'probe' };
  } catch {
    return fallback;
  }
}

/**
 * Build a reporting window for `period` that ends at the last day of complete
 * data for `siteUrl`.
 *
 * This is the entry point tools should use: it keeps every window in the
 * server anchored to the same, API-observed boundary instead of to yesterday.
 * A comparison window derived from the result with `getPreviousPeriod` is
 * shifted by the same amount and stays the same length.
 */
export async function resolveReportingRange(
  api: SearchAnalyticsQuerier,
  siteUrl: string,
  period: DatePeriod,
  options: ResolveOptions = {},
): Promise<DateRange> {
  const { date } = await resolveLatestCompleteDate(api, siteUrl, options);
  return getDateRange(period, { latestCompleteDate: date });
}
