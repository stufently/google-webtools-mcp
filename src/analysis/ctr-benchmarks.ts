/**
 * CTR Benchmarks Module
 *
 * Provides expected organic click-through rates by search position
 * based on industry averages, and utilities for analyzing actual CTR
 * performance against these benchmarks.
 */

/**
 * A benchmark mapping a search position to its expected CTR.
 */
export interface CtrBenchmark {
  position: number;
  expectedCtr: number;
}

/**
 * Result of analyzing an actual CTR against the expected benchmark.
 */
export interface CtrAnalysis {
  /** The search result position (1-based). */
  position: number;
  /** The actual observed CTR as a decimal (e.g., 0.25 for 25%). */
  actualCtr: number;
  /** The expected CTR for this position based on industry benchmarks. */
  expectedCtr: number;
  /** The gap between actual and expected CTR (actualCtr - expectedCtr). */
  ctrGap: number;
  /** The ratio of actual to expected CTR (actualCtr / expectedCtr). */
  ctrRatio: number;
  /** A human-readable performance label. */
  performance: 'excellent' | 'good' | 'average' | 'below_average' | 'poor';
}

/**
 * Built-in expected organic CTR by position (based on industry averages).
 *
 * Position 1: 31.7%, 2: 24.7%, 3: 18.7%, 4: 13.6%, 5: 9.5%
 * 6: 6.2%, 7: 4.2%, 8: 3.1%, 9: 2.4%, 10: 2.2%
 * 11-20: ~1.5% average, 20+: <1%
 */
const CTR_BENCHMARKS: ReadonlyMap<number, number> = new Map<number, number>([
  [1, 0.317],
  [2, 0.247],
  [3, 0.187],
  [4, 0.136],
  [5, 0.095],
  [6, 0.062],
  [7, 0.042],
  [8, 0.031],
  [9, 0.024],
  [10, 0.022],
]);

/** Average CTR for positions 11-20. */
const PAGE_TWO_CTR = 0.015;

/** Average CTR for positions 21+. */
const DEEP_CTR = 0.005;

/**
 * Returns the expected organic CTR for a given search position.
 *
 * Uses industry-average benchmarks for positions 1-10, a flat average
 * for positions 11-20, and a minimal rate for positions beyond 20.
 *
 * @param position - The search result position (1-based). Fractional
 *   positions are rounded to the nearest integer.
 * @returns The expected CTR as a decimal (e.g., 0.317 for 31.7%).
 */
export function getExpectedCtr(position: number): number {
  const roundedPosition = Math.max(1, Math.round(position));

  const benchmark = CTR_BENCHMARKS.get(roundedPosition);
  if (benchmark !== undefined) {
    return benchmark;
  }

  if (roundedPosition <= 20) {
    return PAGE_TWO_CTR;
  }

  return DEEP_CTR;
}

/**
 * Returns a human-readable performance label based on the ratio of
 * actual CTR to expected CTR.
 *
 * - excellent: ratio >= 1.5 (50%+ above expected)
 * - good: ratio >= 1.1 (10%+ above expected)
 * - average: ratio >= 0.8 (within 20% of expected)
 * - below_average: ratio >= 0.5 (20-50% below expected)
 * - poor: ratio < 0.5 (more than 50% below expected)
 *
 * @param ratio - The CTR ratio (actualCtr / expectedCtr).
 * @returns The performance label.
 */
export function getCtrPerformanceLabel(
  ratio: number
): CtrAnalysis['performance'] {
  if (ratio >= 1.5) return 'excellent';
  if (ratio >= 1.1) return 'good';
  if (ratio >= 0.8) return 'average';
  if (ratio >= 0.5) return 'below_average';
  return 'poor';
}

/**
 * Analyzes a single position/CTR pair against the expected benchmark.
 *
 * @param position - The search result position (1-based).
 * @param actualCtr - The actual observed CTR as a decimal.
 * @returns A full CTR analysis including gap, ratio, and performance label.
 */
export function analyzeCtr(position: number, actualCtr: number): CtrAnalysis {
  const expectedCtr = getExpectedCtr(position);
  const ctrGap = actualCtr - expectedCtr;
  const ctrRatio = expectedCtr > 0 ? actualCtr / expectedCtr : 0;
  const performance = getCtrPerformanceLabel(ctrRatio);

  return {
    position,
    actualCtr,
    expectedCtr,
    ctrGap,
    ctrRatio,
    performance,
  };
}

/**
 * Analyzes multiple rows of position/CTR data against benchmarks.
 *
 * @param rows - An array of objects containing `position` and `ctr` fields.
 * @returns An array of CTR analyses, one per input row.
 */
export function batchAnalyzeCtr(
  rows: ReadonlyArray<{ position: number; ctr: number }>
): CtrAnalysis[] {
  return rows.map((row) => analyzeCtr(row.position, row.ctr));
}
