/**
 * Keyword cannibalization analysis.
 *
 * Pure logic, deliberately separated from the tool that renders it so the
 * decision that actually matters -- which of several competing pages is the
 * one to keep -- can be tested without touching the Search Console API.
 */

import type { SearchAnalyticsRow } from '../api/types.js';

export interface CompetingPage {
  url: string;
  position: number;
  clicks: number;
  impressions: number;
  ctr: number;
}

export type CannibalizationSeverity = 'critical' | 'high' | 'medium';

export interface CannibalizationCase {
  query: string;
  /** Every competing page, ordered by volume. */
  pages: CompetingPage[];
  totalImpressions: number;
  totalClicks: number;
  severity: CannibalizationSeverity;
  winner: CompetingPage;
  losers: CompetingPage[];
  /**
   * Pages carrying enough volume for their metrics to mean anything. A case is
   * only worth acting on when at least two of them compete.
   */
  contenders: CompetingPage[];
  /**
   * True when at least two pages each clear `minPageImpressions`, i.e. real
   * traffic is actually being split rather than one page plus noise.
   */
  actionable: boolean;
  /** Impressions absorbed by the losing pages. Zero for non-actionable cases. */
  wastedImpressions: number;
}

/**
 * Impressions a page needs before its average position and CTR are worth
 * comparing against another page's.
 *
 * Below roughly thirty impressions a page can surface once or twice by chance
 * and post a better average position than an established page that ranks
 * steadily -- the sampling error on a mean scales with 1/sqrt(n), so a handful
 * of impressions carries almost no information. Thirty is the conventional
 * small-sample floor, and it is also around the point where a single click
 * (~3% CTR) becomes a resolvable signal rather than an all-or-nothing event.
 */
export const DEFAULT_MIN_PAGE_IMPRESSIONS = 30;

/**
 * Orders competing pages by how much of the query they actually carry.
 *
 * Volume first, position second. Ranking by average position alone hands the
 * "winner" title to whichever page happened to surface a handful of times in a
 * good slot, and the recommendation built on top of it then proposes redirecting
 * the page that does all the work into the one that does none.
 */
export function rankCompetingPages(
  pages: readonly CompetingPage[],
): CompetingPage[] {
  return [...pages].sort(
    (a, b) =>
      b.clicks - a.clicks ||
      b.impressions - a.impressions ||
      a.position - b.position ||
      a.url.localeCompare(b.url),
  );
}

/**
 * The page to keep: the one earning the most clicks, breaking ties on
 * impressions and only then on average position.
 */
export function selectWinner(pages: readonly CompetingPage[]): CompetingPage {
  const ranked = rankCompetingPages(pages);
  const winner = ranked[0];
  if (!winner) {
    throw new Error('selectWinner requires at least one competing page.');
  }
  return winner;
}

/**
 * Severity of an actionable case, judged on the two best-ranking pages that
 * carry real volume. Low-volume pages are excluded on purpose: a page seen
 * three times must not be able to promote a case to "critical".
 */
function severityFor(
  contenders: readonly CompetingPage[],
): CannibalizationSeverity {
  if (contenders.length < 2) return 'medium';

  const byPosition = [...contenders].sort((a, b) => a.position - b.position);
  const bestPos = byPosition[0]!.position;
  const secondBestPos = byPosition[1]!.position;

  if (bestPos <= 10 && secondBestPos <= 10) return 'critical';
  if (bestPos <= 10 && secondBestPos <= 20) return 'high';
  return 'medium';
}

export interface BuildCasesOptions {
  /** Minimum total impressions across all pages for a query to be considered. */
  minImpressions: number;
  /** Minimum impressions for one page to count as a real contender. */
  minPageImpressions?: number;
}

/**
 * Groups query/page rows into cannibalization cases, worst first.
 *
 * Actionable cases (two or more pages with real volume) sort ahead of
 * low-volume ones regardless of severity, because only the former support a
 * consolidation decision.
 */
export function buildCannibalizationCases(
  rows: readonly SearchAnalyticsRow[],
  options: BuildCasesOptions,
): CannibalizationCase[] {
  const minPageImpressions =
    options.minPageImpressions ?? DEFAULT_MIN_PAGE_IMPRESSIONS;

  const queryPages = new Map<string, SearchAnalyticsRow[]>();
  for (const row of rows) {
    const query = row.keys[0] ?? '';
    const existing = queryPages.get(query);
    if (existing) existing.push(row);
    else queryPages.set(query, [row]);
  }

  const cases: CannibalizationCase[] = [];

  for (const [query, queryRows] of queryPages) {
    if (queryRows.length < 2) continue;

    const totalImpressions = queryRows.reduce((s, r) => s + r.impressions, 0);
    if (totalImpressions < options.minImpressions) continue;

    const pages = rankCompetingPages(
      queryRows.map((r) => ({
        url: r.keys[1] ?? '',
        position: r.position,
        clicks: r.clicks,
        impressions: r.impressions,
        ctr: r.ctr,
      })),
    );

    // `pages` is already ranked, so filtering keeps the contenders ranked too.
    const contenders = pages.filter((p) => p.impressions >= minPageImpressions);
    const actionable = contenders.length >= 2;

    // The winner is drawn from the contenders, never from the whole list. A
    // page with one click on one impression outranks two 1,000-impression
    // pages that happen to have zero clicks, and picking it would revive the
    // exact defect this module exists to prevent -- only inverted: the report
    // would advise redirecting a real page into the noise. Fall back to the
    // overall leader only when nothing clears the bar, where no advice is
    // given anyway.
    const winner = contenders[0] ?? pages[0]!;
    const losers = pages.filter((p) => p !== winner);

    cases.push({
      query,
      pages,
      totalImpressions,
      totalClicks: queryRows.reduce((s, r) => s + r.clicks, 0),
      severity: actionable ? severityFor(contenders) : 'medium',
      winner,
      losers,
      contenders,
      actionable,
      // Only a genuine split wastes impressions, and only between pages that
      // have some. Counting the stray handful a near-invisible page picked up
      // would inflate the headline with traffic no consolidation could ever
      // recover -- which is what the report's own limitation promises not to do.
      wastedImpressions: actionable
        ? contenders
            .filter((p) => p !== winner)
            .reduce((s, l) => s + l.impressions, 0)
        : 0,
    });
  }

  const severityOrder: Record<CannibalizationSeverity, number> = {
    critical: 0,
    high: 1,
    medium: 2,
  };

  cases.sort(
    (a, b) =>
      Number(b.actionable) - Number(a.actionable) ||
      severityOrder[a.severity] - severityOrder[b.severity] ||
      b.totalImpressions - a.totalImpressions,
  );

  return cases;
}
