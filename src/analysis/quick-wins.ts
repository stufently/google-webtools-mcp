/**
 * Quick-win bucketing.
 *
 * Every query/page row lands in at most ONE bucket. The buckets used to
 * overlap -- positions 8-10 were both "almost page 1" and "quick position
 * gain" -- so those rows were counted twice in the totals and their estimated
 * clicks were summed across two mutually exclusive futures: the row was
 * credited both for reaching the top 5 and for moving up two spots. The split
 * below is exhaustive and disjoint, so counts and estimates add up.
 */

import type { SearchAnalyticsRow } from '../api/types.js';
import { getExpectedCtr } from './ctr-benchmarks.js';

export type QuickWinCategory = 'ctr' | 'quick_gain' | 'page_two';

export interface QuickWin {
  row: SearchAnalyticsRow;
  category: QuickWinCategory;
  /** Benchmark CTR for the position the row holds today. */
  expectedCtr: number;
  /** Position the estimate assumes the row could reach; null for CTR fixes. */
  targetPosition: number | null;
  /** Clicks the row could gain if the scenario for its bucket played out. */
  additionalClicks: number;
}

export interface QuickWinBuckets {
  /** Positions 1 to 3 whose CTR trails the benchmark: fix the snippet, not the rank. */
  ctr: QuickWin[];
  /** Above 3 up to 10: already on page 1, a two-spot climb pays off steeply. */
  quickGains: QuickWin[];
  /** Above 10 up to 20: on page 2, worth pushing onto page 1. */
  pageTwo: QuickWin[];
  /** Every classified row exactly once, in no particular order. */
  all: QuickWin[];
}

/** How far below the benchmark a top-3 CTR must sit to count as an opportunity. */
export const CTR_OPPORTUNITY_RATIO = 0.8;

/**
 * Sorts a bucket by the clicks it could add, largest first.
 */
function byAdditionalClicks(a: QuickWin, b: QuickWin): number {
  return b.additionalClicks - a.additionalClicks;
}

function estimate(row: SearchAnalyticsRow, targetCtr: number): number {
  return Math.round(row.impressions * Math.max(0, targetCtr - row.ctr));
}

/**
 * Assigns each row to exactly one quick-win bucket.
 *
 * Boundaries are chosen so that no position belongs to two buckets:
 *   - 1 to 3     -> CTR fix, and only when the CTR actually trails the benchmark
 *   - above 3 to 10  -> quick position gain (still page 1)
 *   - above 10 to 20 -> page-two breakthrough
 * Anything past 20, or a top-3 row already hitting its benchmark, is not an
 * opportunity and is left out entirely.
 */
export function classifyQuickWins(
  rows: readonly SearchAnalyticsRow[],
): QuickWinBuckets {
  const ctr: QuickWin[] = [];
  const quickGains: QuickWin[] = [];
  const pageTwo: QuickWin[] = [];

  for (const row of rows) {
    const position = row.position;
    const expectedCtr = getExpectedCtr(position);

    if (position >= 1 && position <= 3) {
      const ratio = expectedCtr > 0 ? row.ctr / expectedCtr : 1;
      if (ratio >= CTR_OPPORTUNITY_RATIO) continue;
      ctr.push({
        row,
        category: 'ctr',
        expectedCtr,
        targetPosition: null,
        additionalClicks: estimate(row, expectedCtr),
      });
      continue;
    }

    if (position > 3 && position <= 10) {
      const targetPosition = Math.max(1, Math.round(position) - 2);
      quickGains.push({
        row,
        category: 'quick_gain',
        expectedCtr,
        targetPosition,
        additionalClicks: estimate(row, getExpectedCtr(targetPosition)),
      });
      continue;
    }

    if (position > 10 && position <= 20) {
      pageTwo.push({
        row,
        category: 'page_two',
        expectedCtr,
        targetPosition: 5,
        additionalClicks: estimate(row, getExpectedCtr(5)),
      });
    }
  }

  ctr.sort(byAdditionalClicks);
  quickGains.sort(byAdditionalClicks);
  pageTwo.sort(byAdditionalClicks);

  return { ctr, quickGains, pageTwo, all: [...ctr, ...quickGains, ...pageTwo] };
}

/** Total estimated additional clicks across a bucket. */
export function sumAdditionalClicks(wins: readonly QuickWin[]): number {
  return wins.reduce((sum, w) => sum + w.additionalClicks, 0);
}
