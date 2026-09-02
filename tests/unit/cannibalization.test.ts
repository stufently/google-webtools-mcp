import { describe, it, expect } from 'vitest';
import {
  buildCannibalizationCases,
  rankCompetingPages,
  selectWinner,
  DEFAULT_MIN_PAGE_IMPRESSIONS,
  type CompetingPage,
} from '../../src/analysis/cannibalization.js';
import { recommendActions } from '../../src/tools/queries/index.js';
import type { SearchAnalyticsRow } from '../../src/api/types.js';

/** query/page row, the shape find_cannibalization asks the API for. */
function row(
  query: string,
  page: string,
  metrics: { clicks: number; impressions: number; position: number },
): SearchAnalyticsRow {
  return {
    keys: [query, page],
    clicks: metrics.clicks,
    impressions: metrics.impressions,
    ctr: metrics.impressions > 0 ? metrics.clicks / metrics.impressions : 0,
    position: metrics.position,
  };
}

function page(
  url: string,
  metrics: { clicks: number; impressions: number; position: number },
): CompetingPage {
  return {
    url,
    clicks: metrics.clicks,
    impressions: metrics.impressions,
    position: metrics.position,
    ctr: metrics.impressions > 0 ? metrics.clicks / metrics.impressions : 0,
  };
}

describe('selectWinner', () => {
  it('picks the page with the most clicks, not the best average position', () => {
    // The live failure: a page seen 10 times at position 3.1 was declared the
    // winner over the page carrying 1,399 impressions and every click.
    const sunrise = page('/aroma-sunrise', { clicks: 0, impressions: 10, position: 3.1 });
    const bright = page('/aroma-bright', { clicks: 3, impressions: 1399, position: 5.7 });

    expect(selectWinner([sunrise, bright]).url).toBe('/aroma-bright');
  });

  it('falls back to impressions when clicks tie', () => {
    const thin = page('/thin', { clicks: 0, impressions: 12, position: 2.0 });
    const fat = page('/fat', { clicks: 0, impressions: 900, position: 9.4 });

    expect(selectWinner([thin, fat]).url).toBe('/fat');
  });

  it('uses position only as the last tiebreaker', () => {
    const worse = page('/worse', { clicks: 5, impressions: 100, position: 7.0 });
    const better = page('/better', { clicks: 5, impressions: 100, position: 2.0 });

    expect(selectWinner([worse, better]).url).toBe('/better');
  });

  it('orders every page, winner first', () => {
    const ranked = rankCompetingPages([
      page('/c', { clicks: 0, impressions: 5, position: 1.1 }),
      page('/a', { clicks: 9, impressions: 500, position: 8.0 }),
      page('/b', { clicks: 1, impressions: 200, position: 4.0 }),
    ]);

    expect(ranked.map((p) => p.url)).toEqual(['/a', '/b', '/c']);
  });

  it('throws rather than inventing a winner for an empty list', () => {
    expect(() => selectWinner([])).toThrow();
  });
});

describe('buildCannibalizationCases', () => {
  const marlboro = [
    row('marlboro aroma', '/aroma-sunrise', { clicks: 0, impressions: 10, position: 3.1 }),
    row('marlboro aroma', '/aroma-bright', { clicks: 3, impressions: 1399, position: 5.7 }),
  ];

  it('names the high-volume page the winner', () => {
    const [c] = buildCannibalizationCases(marlboro, { minImpressions: 20 });

    expect(c?.winner.url).toBe('/aroma-bright');
    expect(c?.losers.map((l) => l.url)).toEqual(['/aroma-sunrise']);
  });

  it('does not count the real page\'s impressions as wasted', () => {
    const [c] = buildCannibalizationCases(marlboro, { minImpressions: 20 });

    // Only the 10-impression page is on the losing side, and even that is not
    // counted because the case is not actionable.
    expect(c?.wastedImpressions).toBe(0);
  });

  it('marks a query as low-volume when only one page clears the bar', () => {
    const [c] = buildCannibalizationCases(marlboro, { minImpressions: 20 });

    expect(c?.actionable).toBe(false);
    expect(c?.contenders).toHaveLength(1);
  });

  it('marks a query actionable when two pages both carry real volume', () => {
    const rows = [
      row('vape kit', '/kit-a', { clicks: 40, impressions: 800, position: 3.0 }),
      row('vape kit', '/kit-b', { clicks: 12, impressions: 400, position: 6.0 }),
    ];

    const [c] = buildCannibalizationCases(rows, { minImpressions: 20 });

    expect(c?.actionable).toBe(true);
    expect(c?.severity).toBe('critical');
    expect(c?.wastedImpressions).toBe(400);
  });

  it('keeps a low-volume page from promoting severity to critical', () => {
    const rows = [
      row('q', '/main', { clicks: 30, impressions: 900, position: 14.0 }),
      row('q', '/noise', { clicks: 0, impressions: 4, position: 1.2 }),
      row('q', '/second', { clicks: 5, impressions: 300, position: 15.0 }),
    ];

    const [c] = buildCannibalizationCases(rows, { minImpressions: 20 });

    // /noise ranks 1.2 but on four impressions; severity must come from the
    // two pages that actually rank, both of them on page 2.
    expect(c?.severity).toBe('medium');
  });

  it('honours a custom contender threshold', () => {
    const rows = [
      row('q', '/a', { clicks: 5, impressions: 100, position: 4.0 }),
      row('q', '/b', { clicks: 0, impressions: 25, position: 6.0 }),
    ];

    expect(buildCannibalizationCases(rows, { minImpressions: 20 })[0]?.actionable).toBe(false);
    expect(
      buildCannibalizationCases(rows, { minImpressions: 20, minPageImpressions: 20 })[0]?.actionable,
    ).toBe(true);
  });

  it('skips queries served by a single page and those under the impression floor', () => {
    const rows = [
      row('solo', '/only', { clicks: 3, impressions: 500, position: 2.0 }),
      row('tiny', '/a', { clicks: 0, impressions: 5, position: 3.0 }),
      row('tiny', '/b', { clicks: 0, impressions: 4, position: 4.0 }),
    ];

    expect(buildCannibalizationCases(rows, { minImpressions: 20 })).toHaveLength(0);
  });

  it('sorts actionable cases ahead of low-volume ones', () => {
    const rows = [
      // Low-volume but huge total impressions.
      row('loud', '/main', { clicks: 0, impressions: 9000, position: 5.0 }),
      row('loud', '/noise', { clicks: 0, impressions: 3, position: 1.0 }),
      // Actionable but smaller.
      row('real', '/a', { clicks: 2, impressions: 200, position: 4.0 }),
      row('real', '/b', { clicks: 1, impressions: 150, position: 6.0 }),
    ];

    const cases = buildCannibalizationCases(rows, { minImpressions: 20 });

    expect(cases.map((c) => c.query)).toEqual(['real', 'loud']);
  });

  it('uses 30 impressions as the default contender threshold', () => {
    expect(DEFAULT_MIN_PAGE_IMPRESSIONS).toBe(30);
  });

  it('never crowns a low-volume page in an actionable case', () => {
    // The inverse of the original defect: one click on one impression outranks
    // two high-impression pages on clicks. If the winner were taken from the
    // whole list, the report would advise redirecting a real page into noise.
    const rows = [
      row('q', '/noise', { clicks: 1, impressions: 1, position: 2.0 }),
      row('q', '/big', { clicks: 0, impressions: 1000, position: 7.0 }),
      row('q', '/mid', { clicks: 0, impressions: 500, position: 9.0 }),
    ];

    const [c] = buildCannibalizationCases(rows, { minImpressions: 20 });

    expect(c?.actionable).toBe(true);
    expect(c?.winner.url).toBe('/big');
    expect(c?.losers.map((l) => l.url)).toContain('/noise');
  });

  it('counts only losing contenders as wasted impressions', () => {
    const rows = [
      row('q', '/a', { clicks: 40, impressions: 800, position: 3.0 }),
      row('q', '/b', { clicks: 12, impressions: 400, position: 6.0 }),
      row('q', '/noise', { clicks: 0, impressions: 7, position: 1.5 }),
    ];

    const [c] = buildCannibalizationCases(rows, { minImpressions: 20 });

    // 400 from the losing contender; the 7 on the noise page are not traffic a
    // redirect could recover, exactly as the report's limitation promises.
    expect(c?.wastedImpressions).toBe(400);
  });

  it('leaves the winner as the volume leader when a single contender exists', () => {
    const rows = [
      row('q', '/noise', { clicks: 2, impressions: 3, position: 1.0 }),
      row('q', '/real', { clicks: 0, impressions: 900, position: 8.0 }),
    ];

    const [c] = buildCannibalizationCases(rows, { minImpressions: 20 });

    expect(c?.actionable).toBe(false);
    expect(c?.winner.url).toBe('/real');
  });
});

describe('recommendActions', () => {
  it('refuses to recommend a redirect when only one page has volume', () => {
    const [c] = buildCannibalizationCases(
      [
        row('marlboro aroma', '/aroma-sunrise', { clicks: 0, impressions: 10, position: 3.1 }),
        row('marlboro aroma', '/aroma-bright', { clicks: 3, impressions: 1399, position: 5.7 }),
      ],
      { minImpressions: 20 },
    );

    const advice = recommendActions(c!, DEFAULT_MIN_PAGE_IMPRESSIONS).join(' ');

    expect(advice).toMatch(/Not enough data/i);
    expect(advice).toMatch(/No redirect or canonical change is recommended/i);
    expect(advice).not.toMatch(/301/);
  });

  it('leads with an intent check before offering consolidation', () => {
    const [c] = buildCannibalizationCases(
      [
        row('vape kit', '/kit-a', { clicks: 40, impressions: 800, position: 3.0 }),
        row('vape kit', '/kit-b', { clicks: 12, impressions: 400, position: 6.0 }),
      ],
      { minImpressions: 20 },
    );

    const advice = recommendActions(c!, DEFAULT_MIN_PAGE_IMPRESSIONS);

    expect(advice[0]).toMatch(/same intent/i);
    expect(advice.join(' ')).toMatch(/Product variants, models and flavours usually are not/i);
    // The winner is the page to keep, and it is the one with the traffic.
    expect(advice.join(' ')).toContain('/kit-a');
  });

  it('does not claim one page has volume when none does', () => {
    const [c] = buildCannibalizationCases(
      [
        row('q', '/a', { clicks: 0, impressions: 12, position: 3.0 }),
        row('q', '/b', { clicks: 0, impressions: 11, position: 4.0 }),
      ],
      { minImpressions: 20 },
    );

    const advice = recommendActions(c!, DEFAULT_MIN_PAGE_IMPRESSIONS).join(' ');

    expect(c?.contenders).toHaveLength(0);
    expect(advice).toMatch(/no page reached 30 impressions/i);
    expect(advice).not.toMatch(/only .* has meaningful volume/i);
  });

  it('talks about the strongest contender, not a low-volume page', () => {
    const [c] = buildCannibalizationCases(
      [
        row('q', '/main', { clicks: 40, impressions: 800, position: 3.0 }),
        row('q', '/rival', { clicks: 10, impressions: 400, position: 5.0 }),
        row('q', '/noise', { clicks: 0, impressions: 2, position: 1.0 }),
      ],
      { minImpressions: 20 },
    );

    const advice = recommendActions(c!, DEFAULT_MIN_PAGE_IMPRESSIONS).join(' ');

    expect(advice).toContain('/rival');
    expect(advice).not.toContain('/noise');
  });
});
