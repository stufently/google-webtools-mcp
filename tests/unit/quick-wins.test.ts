import { describe, it, expect } from 'vitest';
import {
  classifyQuickWins,
  sumAdditionalClicks,
} from '../../src/analysis/quick-wins.js';
import type { SearchAnalyticsRow } from '../../src/api/types.js';

function row(
  query: string,
  position: number,
  opts: { impressions?: number; clicks?: number } = {},
): SearchAnalyticsRow {
  const impressions = opts.impressions ?? 1000;
  const clicks = opts.clicks ?? 0;
  return {
    keys: [query, `/page-${query}`],
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : 0,
    position,
  };
}

describe('classifyQuickWins', () => {
  it('puts a row in exactly one bucket', () => {
    const rows = [
      row('a', 2, { clicks: 1 }),   // top 3, CTR far below benchmark
      row('b', 6),                   // quick gain
      row('c', 15),                  // page two
      row('d', 30),                  // nothing
    ];

    const buckets = classifyQuickWins(rows);

    expect(buckets.ctr).toHaveLength(1);
    expect(buckets.quickGains).toHaveLength(1);
    expect(buckets.pageTwo).toHaveLength(1);
    expect(buckets.all).toHaveLength(3);
  });

  it('counts a position in the old 8-10 overlap once, not twice', () => {
    // This is the bug: position 9 satisfied both "almost page 1" (8-20) and
    // "quick position gains" (4-10), so it was counted in both buckets and its
    // estimate was added twice.
    const buckets = classifyQuickWins([row('overlap', 9)]);

    expect(buckets.all).toHaveLength(1);
    expect(buckets.quickGains).toHaveLength(1);
    expect(buckets.pageTwo).toHaveLength(0);
  });

  it('assigns every overlap position 8, 9 and 10 to quick gains only', () => {
    for (const position of [8, 9, 10]) {
      const buckets = classifyQuickWins([row(`p${position}`, position)]);
      expect(buckets.all).toHaveLength(1);
      expect(buckets.all[0]?.category).toBe('quick_gain');
    }
  });

  it('total equals the sum of the buckets, with nothing double counted', () => {
    const rows = [
      row('a', 2, { clicks: 1 }),
      row('b', 8),
      row('c', 9),
      row('d', 12),
      row('e', 18),
    ];

    const buckets = classifyQuickWins(rows);
    const total = sumAdditionalClicks(buckets.all);

    expect(buckets.ctr.length + buckets.quickGains.length + buckets.pageTwo.length).toBe(
      buckets.all.length,
    );
    expect(total).toBe(
      sumAdditionalClicks(buckets.ctr) +
        sumAdditionalClicks(buckets.quickGains) +
        sumAdditionalClicks(buckets.pageTwo),
    );
  });

  it('never lists the same query/page pair in two buckets', () => {
    const rows = Array.from({ length: 25 }, (_, i) => row(`q${i}`, i * 0.9 + 1));

    const buckets = classifyQuickWins(rows);
    const keys = buckets.all.map((w) => w.row.keys.join('||'));

    expect(new Set(keys).size).toBe(keys.length);
  });

  it('credits one scenario per row, never both top-5 and plus-two', () => {
    const buckets = classifyQuickWins([row('overlap', 9)]);
    const win = buckets.all[0]!;

    // Position 9 is a quick gain: the estimate targets position 7, not 5.
    expect(win.targetPosition).toBe(7);
  });

  it('skips top-3 rows whose CTR already matches the benchmark', () => {
    const strong = row('strong', 1, { impressions: 1000, clicks: 400 });

    expect(classifyQuickWins([strong]).all).toHaveLength(0);
  });

  it('classifies rows between position 3 and 4 instead of dropping them', () => {
    // The old filters used >= 4 and <= 3, so 3.5 fell through both.
    const buckets = classifyQuickWins([row('gap', 3.5)]);

    expect(buckets.quickGains).toHaveLength(1);
  });

  it('ignores anything past position 20', () => {
    expect(classifyQuickWins([row('deep', 20.5)]).all).toHaveLength(0);
  });
});
