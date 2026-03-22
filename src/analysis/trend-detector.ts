/**
 * Trend Detector Module
 *
 * Detects rising, falling, and stable trends in time-series data using
 * simple linear regression. Also identifies breakpoints (sudden changes)
 * and measures volatility.
 */

/**
 * A single data point in a time series.
 */
export interface TrendPoint {
  /** ISO date string (e.g., "2024-01-15"). */
  date: string;
  /** The metric value for this date. */
  value: number;
}

/**
 * The result of analyzing a time series for trends.
 */
export interface TrendAnalysis {
  /** Overall direction of the trend. */
  direction: 'rising' | 'falling' | 'stable';
  /** Slope of the linear fit, expressed as change per day. */
  slope: number;
  /** Total percentage change over the entire period. */
  percentChange: number;
  /** Coefficient of variation (stddev / mean). Higher = more volatile. */
  volatility: number;
  /** R-squared of the linear fit (0-1). Higher = stronger trend signal. */
  confidence: number;
  /** Detected sudden changes in the series. */
  breakpoints: Breakpoint[];
  /** A human-readable summary of the trend. */
  summary: string;
}

/**
 * A detected sudden change (breakpoint) in the time series.
 */
export interface Breakpoint {
  /** The date on which the sudden change occurred. */
  date: string;
  /** The magnitude of the change as a percentage. */
  changePercent: number;
  /** Whether the change was an increase or decrease. */
  direction: 'up' | 'down';
}

/** Minimum slope magnitude (per day, as fraction of mean) to classify as rising/falling. */
const DIRECTION_THRESHOLD = 0.005;

/** Breakpoint sensitivity: a day-over-day change must exceed this multiple of the average daily change. */
const BREAKPOINT_MULTIPLIER = 2;

/** Minimum number of data points required for meaningful analysis. */
const MIN_POINTS = 2;

/**
 * Performs simple linear regression (least squares) on an array of (x, y) pairs.
 *
 * @param xs - The independent variable values.
 * @param ys - The dependent variable values.
 * @returns An object with slope, intercept, and rSquared.
 */
function linearRegression(
  xs: readonly number[],
  ys: readonly number[]
): { slope: number; intercept: number; rSquared: number } {
  const n = xs.length;
  if (n < MIN_POINTS) {
    return { slope: 0, intercept: ys[0] ?? 0, rSquared: 0 };
  }

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  let sumYY = 0;

  for (let i = 0; i < n; i++) {
    const x = xs[i]!;
    const y = ys[i]!;
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
    sumYY += y * y;
  }

  const denominator = n * sumXX - sumX * sumX;
  if (denominator === 0) {
    return { slope: 0, intercept: sumY / n, rSquared: 0 };
  }

  const slope = (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;

  // R-squared
  const meanY = sumY / n;
  let ssTot = 0;
  let ssRes = 0;
  for (let i = 0; i < n; i++) {
    const predicted = slope * xs[i]! + intercept;
    ssTot += (ys[i]! - meanY) ** 2;
    ssRes += (ys[i]! - predicted) ** 2;
  }

  const rSquared = ssTot === 0 ? 0 : 1 - ssRes / ssTot;

  return { slope, intercept, rSquared: Math.max(0, rSquared) };
}

/**
 * Calculates the mean of an array of numbers.
 *
 * @param values - The numbers to average.
 * @returns The arithmetic mean, or 0 for an empty array.
 */
function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/**
 * Calculates the standard deviation of an array of numbers.
 *
 * @param values - The numbers.
 * @param avg - Pre-computed mean (optional).
 * @returns The population standard deviation.
 */
function stddev(values: readonly number[], avg?: number): number {
  if (values.length === 0) return 0;
  const m = avg ?? mean(values);
  let sumSqDiff = 0;
  for (const v of values) {
    sumSqDiff += (v - m) ** 2;
  }
  return Math.sqrt(sumSqDiff / values.length);
}

/**
 * Converts a date string to a numeric day offset from the earliest date.
 *
 * @param dateStr - An ISO date string.
 * @param baseTime - The base timestamp (earliest date) in milliseconds.
 * @returns The number of days since baseTime.
 */
function dateToDayOffset(dateStr: string, baseTime: number): number {
  const ms = new Date(dateStr).getTime();
  return (ms - baseTime) / (1000 * 60 * 60 * 24);
}

/**
 * Detects the overall trend, breakpoints, and volatility in a time series.
 *
 * Uses simple linear regression (least squares) to determine slope and
 * confidence (R-squared). Breakpoints are detected when a day-over-day
 * change exceeds 2x the average daily change. Volatility is measured as
 * the coefficient of variation (stddev / mean).
 *
 * @param points - An array of date/value pairs, not necessarily sorted.
 *   Must contain at least 2 points for meaningful analysis.
 * @returns A full trend analysis including direction, slope, breakpoints,
 *   volatility, confidence, and a human-readable summary.
 */
export function detectTrend(points: readonly TrendPoint[]): TrendAnalysis {
  if (points.length < MIN_POINTS) {
    return {
      direction: 'stable',
      slope: 0,
      percentChange: 0,
      volatility: 0,
      confidence: 0,
      breakpoints: [],
      summary: 'Insufficient data for trend analysis (need at least 2 points).',
    };
  }

  // Sort by date
  const sorted = [...points].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  const firstSorted = sorted[0]!;
  const baseTime = new Date(firstSorted.date).getTime();
  const xs = sorted.map((p) => dateToDayOffset(p.date, baseTime));
  const ys = sorted.map((p) => p.value);

  // Linear regression
  const { slope, rSquared } = linearRegression(xs, ys);

  // Percent change over the full period
  const firstValue = ys[0]!;
  const lastValue = ys[ys.length - 1]!;
  const percentChange =
    firstValue !== 0 ? ((lastValue - firstValue) / Math.abs(firstValue)) * 100 : 0;

  // Volatility (coefficient of variation)
  const meanValue = mean(ys);
  const stddevValue = stddev(ys, meanValue);
  const volatility = meanValue !== 0 ? stddevValue / Math.abs(meanValue) : 0;

  // Breakpoint detection
  const dailyChanges: number[] = [];
  for (let i = 1; i < ys.length; i++) {
    dailyChanges.push(Math.abs(ys[i]! - ys[i - 1]!));
  }
  const avgDailyChange = mean(dailyChanges);

  const breakpoints: Breakpoint[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const currentValue = ys[i]!;
    const previousValue = ys[i - 1]!;
    const change = currentValue - previousValue;
    const absChange = Math.abs(change);

    if (avgDailyChange > 0 && absChange > BREAKPOINT_MULTIPLIER * avgDailyChange) {
      const changePct =
        previousValue !== 0 ? (change / Math.abs(previousValue)) * 100 : 0;
      breakpoints.push({
        date: sorted[i]!.date,
        changePercent: Math.abs(changePct),
        direction: change > 0 ? 'up' : 'down',
      });
    }
  }

  // Direction classification
  // Normalize slope relative to mean to get a proportional threshold
  const normalizedSlope = meanValue !== 0 ? slope / Math.abs(meanValue) : 0;
  let direction: TrendAnalysis['direction'];
  if (normalizedSlope > DIRECTION_THRESHOLD) {
    direction = 'rising';
  } else if (normalizedSlope < -DIRECTION_THRESHOLD) {
    direction = 'falling';
  } else {
    direction = 'stable';
  }

  // Human-readable summary
  const summary = buildSummary(direction, percentChange, rSquared, breakpoints, volatility);

  return {
    direction,
    slope,
    percentChange,
    volatility,
    confidence: rSquared,
    breakpoints,
    summary,
  };
}

/**
 * Builds a human-readable summary string for a trend analysis.
 */
function buildSummary(
  direction: TrendAnalysis['direction'],
  percentChange: number,
  confidence: number,
  breakpoints: readonly Breakpoint[],
  volatility: number
): string {
  const parts: string[] = [];

  const dirLabel =
    direction === 'rising'
      ? 'upward'
      : direction === 'falling'
        ? 'downward'
        : 'stable';

  const changeStr = `${percentChange >= 0 ? '+' : ''}${percentChange.toFixed(1)}%`;
  parts.push(`Trend is ${dirLabel} (${changeStr} over the period).`);

  if (confidence >= 0.7) {
    parts.push('Strong trend signal.');
  } else if (confidence >= 0.4) {
    parts.push('Moderate trend signal.');
  } else {
    parts.push('Weak trend signal; data is noisy.');
  }

  if (volatility > 0.5) {
    parts.push('High volatility detected.');
  } else if (volatility > 0.2) {
    parts.push('Moderate volatility.');
  }

  if (breakpoints.length > 0) {
    parts.push(
      `${breakpoints.length} sudden change${breakpoints.length > 1 ? 's' : ''} detected.`
    );
  }

  return parts.join(' ');
}
