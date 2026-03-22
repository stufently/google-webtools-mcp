/**
 * Opportunity Scorer Module
 *
 * Scores SEO opportunities on a 0-100 scale based on multiple weighted
 * factors: search volume (impressions), CTR efficiency gap, position
 * feasibility, trend momentum, and query breadth.
 */

/**
 * The final scored opportunity with breakdown of contributing factors.
 */
export interface OpportunityScore {
  /** Overall opportunity score from 0 to 100. */
  score: number;
  /** Priority bucket derived from the score. */
  priority: 'critical' | 'high' | 'medium' | 'low';
  /** Individual factor contributions to the final score. */
  factors: ScoreFactor[];
}

/**
 * A single factor that contributes to the overall opportunity score.
 */
export interface ScoreFactor {
  /** Human-readable name of the factor. */
  name: string;
  /** The weight of this factor (0-1, all weights sum to 1). */
  weight: number;
  /** The normalized value of this factor (0-100). */
  value: number;
  /** The weighted contribution to the final score (weight * value). */
  contribution: number;
}

/**
 * Input parameters for scoring an opportunity.
 */
export interface OpportunityParams {
  /** Total impressions for the page/query. */
  impressions: number;
  /** Total clicks for the page/query. */
  clicks: number;
  /** Click-through rate as a decimal (e.g., 0.05 for 5%). */
  ctr: number;
  /** Average position in search results. */
  position: number;
  /** Expected CTR for this position (if pre-computed). */
  expectedCtr?: number;
  /** Trend direction: 1 = rising, 0 = stable, -1 = declining. */
  trend?: number;
  /** Number of distinct queries driving impressions to this page. */
  queryCount?: number;
}

/** Factor weights (must sum to 1.0). */
const WEIGHTS = {
  impressions: 0.30,
  ctrGap: 0.25,
  position: 0.25,
  trend: 0.10,
  queryCount: 0.10,
} as const;

/**
 * Log-scale normalization cap for impressions.
 * log10(100_000) = 5, so 100k+ impressions maps to ~100.
 */
const MAX_IMPRESSIONS_LOG = 5;

/**
 * Log-scale normalization cap for query count.
 * log10(1000) = 3, so 1000+ queries maps to ~100.
 */
const MAX_QUERY_COUNT_LOG = 3;

/**
 * Default expected CTR values by rounded position (used when expectedCtr
 * is not provided). Mirrors ctr-benchmarks.ts but kept self-contained
 * to avoid a circular dependency.
 */
const DEFAULT_EXPECTED_CTR: ReadonlyMap<number, number> = new Map([
  [1, 0.317], [2, 0.247], [3, 0.187], [4, 0.136], [5, 0.095],
  [6, 0.062], [7, 0.042], [8, 0.031], [9, 0.024], [10, 0.022],
]);

/**
 * Returns the default expected CTR for a position.
 */
function getDefaultExpectedCtr(position: number): number {
  const rounded = Math.max(1, Math.round(position));
  const benchmark = DEFAULT_EXPECTED_CTR.get(rounded);
  if (benchmark !== undefined) return benchmark;
  if (rounded <= 20) return 0.015;
  return 0.005;
}

/**
 * Clamps a value to the 0-100 range.
 */
function clamp100(value: number): number {
  return Math.max(0, Math.min(100, value));
}

/**
 * Normalizes impressions to a 0-100 scale using log scaling.
 * This prevents extremely high-volume pages from dominating.
 *
 * @param impressions - Raw impression count.
 * @returns A value from 0 to 100.
 */
function normalizeImpressions(impressions: number): number {
  if (impressions <= 0) return 0;
  const logValue = Math.log10(impressions + 1);
  return clamp100((logValue / MAX_IMPRESSIONS_LOG) * 100);
}

/**
 * Normalizes the CTR gap (expectedCtr - actualCtr) to a 0-100 scale.
 * A larger gap means more room for improvement, scoring higher.
 * If actual CTR exceeds expected, the score is 0 (no gap to exploit).
 *
 * @param actualCtr - The actual observed CTR.
 * @param expectedCtr - The expected CTR for this position.
 * @returns A value from 0 to 100.
 */
function normalizeCtrGap(actualCtr: number, expectedCtr: number): number {
  if (expectedCtr <= 0) return 0;
  const gap = expectedCtr - actualCtr;
  if (gap <= 0) return 0;
  // Normalize: a gap equal to the full expected CTR = 100
  return clamp100((gap / expectedCtr) * 100);
}

/**
 * Normalizes position to a 0-100 feasibility score.
 * Pages closer to position 1 are easier to push up, scoring higher.
 * Position 1 = 100, Position 10 = ~55, Position 20 = ~30, Position 100 = 0.
 *
 * @param position - The average search position.
 * @returns A value from 0 to 100.
 */
function normalizePosition(position: number): number {
  if (position <= 0) return 100;
  if (position >= 100) return 0;
  // Inverse relationship: lower position number = higher score
  // Using a curve that emphasizes positions 1-20
  return clamp100(100 * (1 - Math.log10(position) / 2));
}

/**
 * Normalizes a trend signal to a 0-100 urgency score.
 * Declining trends score highest (most urgent), rising trends score lowest.
 *
 * @param trend - Trend direction: positive = rising, negative = declining, 0 = stable.
 * @returns A value from 0 to 100.
 */
function normalizeTrend(trend: number): number {
  // Map from [-1, 1] to [100, 0]: declining = urgent = high score
  // Stable (0) = 50, rising (1) = 0, declining (-1) = 100
  return clamp100(50 - trend * 50);
}

/**
 * Normalizes query count to a 0-100 breadth score using log scaling.
 *
 * @param queryCount - The number of distinct queries.
 * @returns A value from 0 to 100.
 */
function normalizeQueryCount(queryCount: number): number {
  if (queryCount <= 0) return 0;
  const logValue = Math.log10(queryCount + 1);
  return clamp100((logValue / MAX_QUERY_COUNT_LOG) * 100);
}

/**
 * Derives a priority label from a numeric score.
 *
 * - critical: score >= 80
 * - high: score >= 60
 * - medium: score >= 40
 * - low: score < 40
 *
 * @param score - The opportunity score (0-100).
 * @returns The priority label.
 */
export function getPriority(score: number): OpportunityScore['priority'] {
  if (score >= 80) return 'critical';
  if (score >= 60) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

/**
 * Scores an SEO opportunity on a 0-100 scale based on weighted factors.
 *
 * Scoring weights:
 * - **Impressions (30%)**: Volume/opportunity size, log-scaled.
 * - **CTR Gap (25%)**: Efficiency gap between expected and actual CTR.
 * - **Position (25%)**: Feasibility -- closer to page 1 is easier to improve.
 * - **Trend (10%)**: Momentum -- declining trends are more urgent.
 * - **Query Count (10%)**: Breadth -- more queries = broader opportunity.
 *
 * Each factor is normalized to 0-100, then combined via weighted sum.
 *
 * @param params - The input parameters describing the opportunity.
 * @returns The scored opportunity with factor breakdown.
 */
export function scoreOpportunity(params: OpportunityParams): OpportunityScore {
  const {
    impressions,
    ctr,
    position,
    expectedCtr,
    trend = 0,
    queryCount = 1,
  } = params;

  const resolvedExpectedCtr = expectedCtr ?? getDefaultExpectedCtr(position);

  const impressionsValue = normalizeImpressions(impressions);
  const ctrGapValue = normalizeCtrGap(ctr, resolvedExpectedCtr);
  const positionValue = normalizePosition(position);
  const trendValue = normalizeTrend(trend);
  const queryCountValue = normalizeQueryCount(queryCount);

  const factors: ScoreFactor[] = [
    {
      name: 'impressions',
      weight: WEIGHTS.impressions,
      value: impressionsValue,
      contribution: WEIGHTS.impressions * impressionsValue,
    },
    {
      name: 'ctrGap',
      weight: WEIGHTS.ctrGap,
      value: ctrGapValue,
      contribution: WEIGHTS.ctrGap * ctrGapValue,
    },
    {
      name: 'position',
      weight: WEIGHTS.position,
      value: positionValue,
      contribution: WEIGHTS.position * positionValue,
    },
    {
      name: 'trend',
      weight: WEIGHTS.trend,
      value: trendValue,
      contribution: WEIGHTS.trend * trendValue,
    },
    {
      name: 'queryCount',
      weight: WEIGHTS.queryCount,
      value: queryCountValue,
      contribution: WEIGHTS.queryCount * queryCountValue,
    },
  ];

  const score = clamp100(
    factors.reduce((sum, factor) => sum + factor.contribution, 0)
  );

  return {
    score: Math.round(score * 100) / 100,
    priority: getPriority(score),
    factors,
  };
}
