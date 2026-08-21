import {
  resolveLatestCompleteDate,
  resolveReportingRange,
  FRESHNESS_PROBE_WINDOW_DAYS,
  type SearchAnalyticsQuerier,
} from '../../src/api/data-freshness.js';
import { getDateRange, getPreviousPeriod, daysBetween } from '../../src/utils/date-helpers.js';
import type { SearchAnalyticsRequest, SearchAnalyticsResponse } from '../../src/api/types.js';

const NOW = new Date(2024, 5, 15); // June 15, 2024

interface StubOptions {
  /** What the API reports as the first day still being collected. */
  firstIncompleteDate?: string;
  /** Last day that actually has traffic — may be far older than the boundary. */
  lastDayWithTraffic?: string;
  clicksPerDay?: number;
  fail?: boolean;
}

/**
 * A stand-in for the Search Console API: it answers with per-date rows and,
 * when asked with `dataState: "all"` and grouped by date, with the freshness
 * metadata the real API attaches.
 */
function stubApi(opts: StubOptions): SearchAnalyticsQuerier & { requests: SearchAnalyticsRequest[] } {
  const requests: SearchAnalyticsRequest[] = [];
  const clicksPerDay = opts.clicksPerDay ?? 100;

  return {
    requests,
    async querySearchAnalytics(request: SearchAnalyticsRequest): Promise<SearchAnalyticsResponse> {
      requests.push(request);
      if (opts.fail) throw new Error('quota exceeded');

      const rows = [];
      if (opts.lastDayWithTraffic !== undefined) {
        for (
          let day = new Date(request.startDate + 'T00:00:00');
          day <= new Date(request.endDate + 'T00:00:00');
          day.setDate(day.getDate() + 1)
        ) {
          const iso = day.toISOString().slice(0, 10);
          if (iso > opts.lastDayWithTraffic) continue;
          rows.push({
            keys: [iso],
            clicks: clicksPerDay,
            impressions: clicksPerDay * 10,
            ctr: 0.1,
            position: 5,
          });
        }
      }

      const reportsMetadata =
        opts.firstIncompleteDate !== undefined &&
        request.dataState === 'all' &&
        (request.dimensions ?? []).includes('date');

      return {
        rows,
        responseAggregationType: 'auto',
        ...(reportsMetadata
          ? { metadata: { first_incomplete_date: opts.firstIncompleteDate! } }
          : {}),
      };
    },
  };
}

describe('data-freshness', () => {
  describe('resolveLatestCompleteDate', () => {
    it('probes with dataState "all" grouped by date, the combination that yields metadata', async () => {
      const api = stubApi({ firstIncompleteDate: '2024-06-13', lastDayWithTraffic: '2024-06-12' });
      await resolveLatestCompleteDate(api, 'sc-domain:example.com', { now: NOW });

      expect(api.requests).toHaveLength(1);
      const probe = api.requests[0]!;
      expect(probe.dataState).toBe('all');
      expect(probe.dimensions).toEqual(['date']);
      expect(probe.endDate).toBe('2024-06-15');
      expect(daysBetween(probe.startDate, probe.endDate)).toBe(FRESHNESS_PROBE_WINDOW_DAYS);
    });

    it('passes the caller\'s searchType so the boundary matches the data being read', async () => {
      const api = stubApi({ firstIncompleteDate: '2024-06-13' });
      await resolveLatestCompleteDate(api, 'sc-domain:example.com', { now: NOW, searchType: 'image' });
      expect(api.requests[0]!.searchType).toBe('image');
    });

    it('takes the day before the first incomplete one', async () => {
      const api = stubApi({ firstIncompleteDate: '2024-06-13', lastDayWithTraffic: '2024-06-12' });
      const result = await resolveLatestCompleteDate(api, 'sc-domain:example.com', { now: NOW });
      expect(result).toEqual({ date: '2024-06-12', source: 'probe' });
    });

    it('follows the boundary when the lag is worse than usual', async () => {
      // The lag drifts; a five-day lag must not be reported as three.
      const api = stubApi({ firstIncompleteDate: '2024-06-11', lastDayWithTraffic: '2024-06-10' });
      const result = await resolveLatestCompleteDate(api, 'sc-domain:example.com', { now: NOW });
      expect(result).toEqual({ date: '2024-06-10', source: 'probe' });
    });

    it('is not fooled by a gap in traffic', async () => {
      // Data is published through June 12, but the property last had a click on
      // June 5. Reading the boundary off the newest row present would drag every
      // window a week into the past; the metadata says otherwise.
      const api = stubApi({ firstIncompleteDate: '2024-06-13', lastDayWithTraffic: '2024-06-05' });
      const result = await resolveLatestCompleteDate(api, 'sc-domain:example.com', { now: NOW });
      expect(result).toEqual({ date: '2024-06-12', source: 'probe' });
    });

    it('falls back to the assumed lag when the API reports no boundary', async () => {
      const api = stubApi({ lastDayWithTraffic: '2024-06-12' }); // no metadata
      const result = await resolveLatestCompleteDate(api, 'sc-domain:example.com', { now: NOW });
      expect(result).toEqual({ date: '2024-06-12', source: 'fallback' });
    });

    it('falls back instead of throwing when the probe call fails', async () => {
      const api = stubApi({ fail: true });
      const result = await resolveLatestCompleteDate(api, 'sc-domain:example.com', { now: NOW });
      expect(result).toEqual({ date: '2024-06-12', source: 'fallback' });
    });
  });

  describe('resolveReportingRange', () => {
    it('ends the window at the observed boundary', async () => {
      const api = stubApi({ firstIncompleteDate: '2024-06-12', lastDayWithTraffic: '2024-06-11' });
      const range = await resolveReportingRange(api, 'sc-domain:example.com', 'last7d', { now: NOW });
      expect(range).toEqual({ startDate: '2024-06-05', endDate: '2024-06-11' });
    });

    it('keeps current and previous windows equal in length', async () => {
      const api = stubApi({ firstIncompleteDate: '2024-06-12', lastDayWithTraffic: '2024-06-11' });
      const current = await resolveReportingRange(api, 'sc-domain:example.com', 'last28d', { now: NOW });
      const previous = getPreviousPeriod(current.startDate, current.endDate);

      expect(daysBetween(previous.startDate, previous.endDate))
        .toBe(daysBetween(current.startDate, current.endDate));
    });
  });

  describe('regression: the undelivered tail is not a traffic collapse', () => {
    /** Total clicks inside a window for a property with flat daily traffic. */
    async function clicksIn(
      api: SearchAnalyticsQuerier,
      range: { startDate: string; endDate: string },
    ): Promise<number> {
      const res = await api.querySearchAnalytics({
        siteUrl: 'sc-domain:example.com',
        startDate: range.startDate,
        endDate: range.endDate,
        dimensions: ['date'],
        dataState: 'final',
      });
      return res.rows.reduce((sum, row) => sum + row.clicks, 0);
    }

    /** Flat 100 clicks a day, published through June 12. Nothing declined. */
    const flatProperty = (): StubOptions => ({
      firstIncompleteDate: '2024-06-13',
      lastDayWithTraffic: '2024-06-12',
      clicksPerDay: 100,
    });

    it('windows ending yesterday invent a decline that never happened', async () => {
      const api = stubApi(flatProperty());

      // The old behaviour: anchor the window at yesterday, June 14.
      const current = getDateRange('last7d', { latestCompleteDate: '2024-06-14' });
      const previous = getPreviousPeriod(current.startDate, current.endDate);

      const currentClicks = await clicksIn(api, current);
      const previousClicks = await clicksIn(api, previous);

      // Two of the seven "current" days have no data yet, so a flat property
      // looks like it lost a third of its traffic.
      expect(currentClicks).toBe(500);
      expect(previousClicks).toBe(700);
      expect(currentClicks).toBeLessThan(previousClicks);
    });

    it('windows anchored to the observed boundary report no decline', async () => {
      const api = stubApi(flatProperty());

      const current = await resolveReportingRange(api, 'sc-domain:example.com', 'last7d', { now: NOW });
      const previous = getPreviousPeriod(current.startDate, current.endDate);

      const currentClicks = await clicksIn(api, current);
      const previousClicks = await clicksIn(api, previous);

      expect(current.endDate).toBe('2024-06-12');
      expect(currentClicks).toBe(700);
      expect(previousClicks).toBe(700);
      expect(currentClicks).toBe(previousClicks);
    });
  });
});
