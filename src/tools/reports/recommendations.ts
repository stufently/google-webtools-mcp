/**
 * Glue between Search Analytics rows and the recommendation engine for the
 * report tools. The engine reasons about query+page pairs, so callers must
 * fetch rows with the dimensions ['query', 'page'] (in that order).
 */

import type { SearchAnalyticsRow } from '../../api/types.js';
import {
  generateRecommendations,
  deduplicateRecommendations,
  type GscRow,
  type Recommendation,
} from '../../analysis/recommendation-engine.js';
import { analyzeCtr } from '../../analysis/ctr-benchmarks.js';
import { buildCannibalizationCases } from '../../analysis/cannibalization.js';

/** Dimensions the report tools request for recommendation input. */
export const RECOMMENDATION_DIMENSIONS = ['query', 'page'] as const;

/** Row limit for the recommendation query+page fetch. */
export const RECOMMENDATION_ROW_LIMIT = 5000;

/** Same per-query floor as find_cannibalization's default `minImpressions`. */
const CONSOLIDATION_MIN_QUERY_IMPRESSIONS = 20;

/**
 * Convert query+page Search Analytics rows into engine rows. Rows missing
 * either key are dropped rather than producing recommendations about "".
 */
export function toGscRows(rows: readonly SearchAnalyticsRow[]): GscRow[] {
  const result: GscRow[] = [];
  for (const row of rows) {
    const query = row.keys?.[0];
    const page = row.keys?.[1];
    if (!query || !page) continue;
    result.push({
      query,
      page,
      clicks: row.clicks,
      impressions: row.impressions,
      ctr: row.ctr,
      position: row.position,
    });
  }
  return result;
}

/**
 * Prioritized, deduplicated recommendations for query+page rows.
 *
 * CTR is judged against the position benchmark, not the engine's flat 5%
 * fallback. Consolidation advice is kept only for queries that
 * find_cannibalization would call actionable (two or more pages with real
 * volume): the engine alone proposes merging any two pages that share a query,
 * including a strong page and one seen a handful of times.
 */
export function buildReportRecommendations(rows: readonly SearchAnalyticsRow[]): Recommendation[] {
  const gscRows = toGscRows(rows);
  const ctrAnalyses = gscRows.map((r) => analyzeCtr(r.position, r.ctr));
  const actionableQueries = new Set(
    buildCannibalizationCases(rows, { minImpressions: CONSOLIDATION_MIN_QUERY_IMPRESSIONS })
      .filter((c) => c.actionable)
      .map((c) => c.query),
  );
  const recs = generateRecommendations({ rows: gscRows, ctrAnalyses }).filter(
    (r) => r.type !== 'consolidation' || actionableQueries.has(r.data.query as string),
  );
  return deduplicateRecommendations(recs);
}
