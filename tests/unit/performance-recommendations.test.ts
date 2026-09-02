import { describe, it, expect } from 'vitest';
import {
  buildPerformanceRecommendations,
  hasBaseline,
  type PeriodTotals,
} from '../../src/tools/performance/index.js';

const empty: PeriodTotals = { clicks: 0, impressions: 0, ctr: 0, position: 0 };

function totals(over: Partial<PeriodTotals>): PeriodTotals {
  return { clicks: 0, impressions: 0, ctr: 0.05, position: 8.5, ...over };
}

describe('hasBaseline', () => {
  it('is false when the previous period returned no rows', () => {
    expect(hasBaseline([])).toBe(false);
  });

  it('is true as soon as the previous period returned anything', () => {
    expect(hasBaseline([{ clicks: 0 }])).toBe(true);
  });
});

describe('buildPerformanceRecommendations', () => {
  it('does not claim a worsening position when there is no baseline', () => {
    // The live failure: a property with data only since July compared its 8.5
    // average position against a "previous" 0.0 and reported a decline.
    const current = totals({ clicks: 1857, impressions: 188932, ctr: 0.0098, position: 8.5 });

    const recommendations = buildPerformanceRecommendations(current, empty, false);

    expect(recommendations.join(' ')).not.toMatch(/position has worsened/i);
    expect(recommendations.join(' ')).not.toMatch(/dropped significantly/i);
    expect(recommendations.join(' ')).not.toMatch(/Great progress/i);
  });

  it('says why the comparison is missing instead of staying silent', () => {
    const recommendations = buildPerformanceRecommendations(totals({ clicks: 10 }), empty, false);

    expect(recommendations[0]).toMatch(/No data for the previous period/i);
  });

  it('still reports observations that need no baseline', () => {
    const current = totals({ clicks: 1857, impressions: 188932, ctr: 0.0098, position: 8.5 });

    const recommendations = buildPerformanceRecommendations(current, empty, false);

    expect(recommendations.join(' ')).toMatch(/CTR is below 2%/);
  });

  it('does not lecture about CTR when nothing was ever shown', () => {
    const current: PeriodTotals = { clicks: 0, impressions: 0, ctr: 0, position: 0 };

    const recommendations = buildPerformanceRecommendations(current, empty, false);

    expect(recommendations.join(' ')).not.toMatch(/CTR is below 2%/);
  });

  it('reports a worsening position when a real baseline exists', () => {
    const current = totals({ clicks: 100, impressions: 5000, ctr: 0.02, position: 12 });
    const previous = totals({ clicks: 100, impressions: 5000, ctr: 0.02, position: 6 });

    const recommendations = buildPerformanceRecommendations(current, previous, true);

    expect(recommendations.join(' ')).toMatch(/position has worsened/i);
  });

  it('will not read a position decline against a previous position of zero', () => {
    // Belt and braces: even if a caller passes baselineExists=true with a row
    // whose position is 0, that zero is missing data, not rank one.
    const current = totals({ clicks: 100, impressions: 5000, ctr: 0.05, position: 9 });
    const previous = totals({ clicks: 50, impressions: 2000, ctr: 0.025, position: 0 });

    const recommendations = buildPerformanceRecommendations(current, previous, true);

    expect(recommendations.join(' ')).not.toMatch(/position has worsened/i);
  });

  it('flags a significant click drop against a real baseline', () => {
    const current = totals({ clicks: 50, impressions: 5000, ctr: 0.01, position: 8 });
    const previous = totals({ clicks: 200, impressions: 5000, ctr: 0.04, position: 8 });

    const recommendations = buildPerformanceRecommendations(current, previous, true);

    expect(recommendations.join(' ')).toMatch(/Clicks have dropped significantly/);
  });
});
