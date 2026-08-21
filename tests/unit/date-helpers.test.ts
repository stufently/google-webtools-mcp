import {
  formatDate,
  parseDate,
  daysBetween,
  isDateFresh,
  getDateRange,
  getFallbackLatestCompleteDate,
  getPreviousPeriod,
  GSC_DATA_LAG_DAYS,
} from '../../src/utils/date-helpers.js';
import type { DatePeriod } from '../../src/utils/date-helpers.js';

const ALL_PERIODS: DatePeriod[] = [
  'last7d', 'last28d', 'last3m', 'last6m', 'last12m', 'last16m',
];

describe('date-helpers', () => {
  describe('formatDate', () => {
    it('formats a date as YYYY-MM-DD', () => {
      expect(formatDate(new Date(2024, 0, 5))).toBe('2024-01-05');
      expect(formatDate(new Date(2024, 11, 31))).toBe('2024-12-31');
    });

    it('zero-pads month and day', () => {
      expect(formatDate(new Date(2024, 0, 1))).toBe('2024-01-01');
      expect(formatDate(new Date(2024, 8, 9))).toBe('2024-09-09');
    });
  });

  describe('parseDate', () => {
    it('parses a valid YYYY-MM-DD string', () => {
      const d = parseDate('2024-03-15');
      expect(d.getFullYear()).toBe(2024);
      expect(d.getMonth()).toBe(2); // 0-indexed
      expect(d.getDate()).toBe(15);
    });

    it('throws on invalid format', () => {
      expect(() => parseDate('2024/01/01')).toThrow('Invalid date string');
      expect(() => parseDate('01-01-2024')).toThrow('Invalid date string');
      expect(() => parseDate('not-a-date')).toThrow('Invalid date string');
      expect(() => parseDate('')).toThrow('Invalid date string');
    });

    it('throws on impossible dates like Feb 30', () => {
      expect(() => parseDate('2024-02-30')).toThrow('does not represent a real date');
    });

    it('round-trips with formatDate', () => {
      const original = '2024-06-15';
      expect(formatDate(parseDate(original))).toBe(original);
    });
  });

  describe('daysBetween', () => {
    it('returns the number of days between two dates', () => {
      expect(daysBetween('2024-01-01', '2024-01-08')).toBe(7);
      expect(daysBetween('2024-01-01', '2024-01-01')).toBe(0);
    });

    it('returns a non-negative value regardless of order', () => {
      expect(daysBetween('2024-01-08', '2024-01-01')).toBe(7);
    });

    it('works across month boundaries', () => {
      expect(daysBetween('2024-01-31', '2024-02-01')).toBe(1);
    });
  });

  describe('isDateFresh', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns true for today within threshold', () => {
      vi.setSystemTime(new Date(2024, 5, 15)); // June 15, 2024
      expect(isDateFresh('2024-06-15', 3)).toBe(true);
    });

    it('returns true for dates within threshold', () => {
      vi.setSystemTime(new Date(2024, 5, 15));
      expect(isDateFresh('2024-06-13', 3)).toBe(true); // 2 days ago
    });

    it('returns true for date exactly at threshold', () => {
      vi.setSystemTime(new Date(2024, 5, 15));
      expect(isDateFresh('2024-06-12', 3)).toBe(true); // 3 days ago
    });

    it('returns false for dates beyond threshold', () => {
      vi.setSystemTime(new Date(2024, 5, 15));
      expect(isDateFresh('2024-06-11', 3)).toBe(false); // 4 days ago
    });

    it('returns false for future dates', () => {
      vi.setSystemTime(new Date(2024, 5, 15));
      expect(isDateFresh('2024-06-16', 3)).toBe(false);
    });
  });

  describe('getDateRange', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      // June 15, 2024. With the default lag of 3 days the last complete day
      // is June 12 — deliberately NOT yesterday, because Search Console is
      // still collecting the days after it.
      vi.setSystemTime(new Date(2024, 5, 15));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns correct range for last7d', () => {
      const range = getDateRange('last7d');
      expect(range.endDate).toBe('2024-06-12');
      expect(range.startDate).toBe('2024-06-06'); // 6 days before end = 7 days inclusive
    });

    it('returns correct range for last28d', () => {
      const range = getDateRange('last28d');
      expect(range.endDate).toBe('2024-06-12');
      expect(range.startDate).toBe('2024-05-16'); // 27 days before end = 28 days inclusive
    });

    it('returns correct range for last3m', () => {
      const range = getDateRange('last3m');
      expect(range.endDate).toBe('2024-06-12');
      expect(range.startDate).toBe('2024-03-12');
    });

    it('returns correct range for last6m', () => {
      const range = getDateRange('last6m');
      expect(range.endDate).toBe('2024-06-12');
      expect(range.startDate).toBe('2023-12-12');
    });

    it('returns correct range for last12m', () => {
      const range = getDateRange('last12m');
      expect(range.endDate).toBe('2024-06-12');
      expect(range.startDate).toBe('2023-06-12');
    });

    it('returns correct range for last16m', () => {
      const range = getDateRange('last16m');
      expect(range.endDate).toBe('2024-06-12');
      expect(range.startDate).toBe('2023-02-12');
    });

    it('ends at the fallback complete day, not yesterday', () => {
      for (const period of ALL_PERIODS) {
        expect(getDateRange(period).endDate).toBe('2024-06-12');
        expect(getDateRange(period).endDate).not.toBe('2024-06-14');
      }
    });

    it('ends at an explicitly supplied complete day', () => {
      // The observed boundary drifts; when the API reports it, it wins over
      // the assumed lag in either direction.
      for (const period of ALL_PERIODS) {
        expect(getDateRange(period, { latestCompleteDate: '2024-06-09' }).endDate)
          .toBe('2024-06-09');
        expect(getDateRange(period, { latestCompleteDate: '2024-06-13' }).endDate)
          .toBe('2024-06-13');
      }
    });

    it('honours an explicit lagDays override', () => {
      expect(getDateRange('last7d', { lagDays: 1 }).endDate).toBe('2024-06-14');
      expect(getDateRange('last7d', { lagDays: 0 }).endDate).toBe('2024-06-15');
    });

    it('shifts the whole window, keeping day counts identical', () => {
      const shifted = getDateRange('last28d', { latestCompleteDate: '2024-06-09' });
      const dflt = getDateRange('last28d');
      expect(daysBetween(shifted.startDate, shifted.endDate))
        .toBe(daysBetween(dflt.startDate, dflt.endDate));
    });

    it('gives the current and previous windows the same length', () => {
      // The whole point of moving the anchor: fix the tail without creating a
      // second bug, an unfair comparison between windows of different lengths.
      for (const period of ALL_PERIODS) {
        const current = getDateRange(period, { latestCompleteDate: '2024-06-11' });
        const previous = getPreviousPeriod(current.startDate, current.endDate);

        expect(daysBetween(previous.startDate, previous.endDate))
          .toBe(daysBetween(current.startDate, current.endDate));
        // Back-to-back, no gap and no overlap.
        expect(daysBetween(previous.endDate, current.startDate)).toBe(1);
      }
    });
  });

  describe('getDateRange month-end arithmetic', () => {
    it('clamps to the last day of the target month instead of spilling over', () => {
      // Naive setMonth turns May 31 minus three months into March 2 and
      // quietly shortens the window by two days.
      expect(getDateRange('last3m', { latestCompleteDate: '2024-05-31' }).startDate)
        .toBe('2024-02-29');
      expect(getDateRange('last3m', { latestCompleteDate: '2023-05-31' }).startDate)
        .toBe('2023-02-28');
      expect(getDateRange('last6m', { latestCompleteDate: '2024-08-31' }).startDate)
        .toBe('2024-02-29');
    });

    it('leaves ordinary month arithmetic alone', () => {
      expect(getDateRange('last3m', { latestCompleteDate: '2024-06-12' }).startDate)
        .toBe('2024-03-12');
      expect(getDateRange('last12m', { latestCompleteDate: '2024-02-29' }).startDate)
        .toBe('2023-02-28');
    });
  });

  describe('getFallbackLatestCompleteDate', () => {
    it('is today minus the documented lag', () => {
      const now = new Date(2024, 5, 15);
      expect(getFallbackLatestCompleteDate(GSC_DATA_LAG_DAYS, now)).toBe('2024-06-12');
      expect(getFallbackLatestCompleteDate(5, now)).toBe('2024-06-10');
    });

    it('defaults to a three-day lag', () => {
      expect(GSC_DATA_LAG_DAYS).toBe(3);
    });
  });

  describe('getPreviousPeriod', () => {
    it('returns the immediately preceding period of the same length', () => {
      const prev = getPreviousPeriod('2024-01-15', '2024-01-21');
      expect(prev.startDate).toBe('2024-01-08');
      expect(prev.endDate).toBe('2024-01-14');
    });

    it('works for a single-day range', () => {
      const prev = getPreviousPeriod('2024-03-15', '2024-03-15');
      expect(prev.startDate).toBe('2024-03-14');
      expect(prev.endDate).toBe('2024-03-14');
    });

    it('throws when startDate is after endDate', () => {
      expect(() => getPreviousPeriod('2024-01-21', '2024-01-15')).toThrow(RangeError);
    });

    it('works across month boundaries', () => {
      const prev = getPreviousPeriod('2024-02-01', '2024-02-07');
      expect(prev.startDate).toBe('2024-01-25');
      expect(prev.endDate).toBe('2024-01-31');
    });

    it('counts calendar days across a daylight-saving change', () => {
      // US DST starts on 2024-03-10; a 23-hour day must still count as one day.
      const prev = getPreviousPeriod('2024-03-11', '2024-03-17');
      expect(prev.startDate).toBe('2024-03-04');
      expect(prev.endDate).toBe('2024-03-10');
      expect(daysBetween(prev.startDate, prev.endDate)).toBe(6);
    });

    it('works across a leap day', () => {
      const prev = getPreviousPeriod('2024-03-01', '2024-03-07');
      expect(prev.startDate).toBe('2024-02-23');
      expect(prev.endDate).toBe('2024-02-29');
    });
  });
});
