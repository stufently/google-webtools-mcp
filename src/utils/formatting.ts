/**
 * Display-formatting utilities for GSC metrics.
 */

/**
 * Format a number with locale-style thousand separators.
 *
 * @example formatNumber(1234)    // "1,234"
 * @example formatNumber(1000000) // "1,000,000"
 */
export function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

/**
 * Format a ratio as a percentage string.
 *
 * The input is expected to be a decimal ratio (e.g. `0.1234` for 12.34 %).
 *
 * @param n         Decimal ratio.
 * @param decimals  Number of fractional digits (default `2`).
 *
 * @example formatPercent(0.1234)    // "12.34%"
 * @example formatPercent(0.5, 0)    // "50%"
 */
export function formatPercent(n: number, decimals: number = 2): string {
  return `${(n * 100).toFixed(decimals)}%`;
}

/**
 * Format an average position value to one decimal place.
 *
 * @example formatPosition(3.456) // "3.5"
 */
export function formatPosition(n: number): string {
  return n.toFixed(1);
}

/**
 * Format the percentage change between two values.
 *
 * Returns a signed string like `"+15.2%"` or `"-3.1%"`.
 * If `previous` is `0`, returns `"N/A"` to avoid division by zero.
 *
 * @example formatChange(115.2, 100) // "+15.20%"
 * @example formatChange(96.9, 100)  // "-3.10%"
 */
export function formatChange(
  current: number,
  previous: number,
  decimals: number = 2,
): string {
  if (previous === 0) {
    return "N/A";
  }

  const change = ((current - previous) / Math.abs(previous)) * 100;
  const sign = change >= 0 ? "+" : "";
  return `${sign}${change.toFixed(decimals)}%`;
}

/**
 * Truncate a string to `maxLen` characters, appending an ellipsis if
 * truncation occurs.
 *
 * @example truncate("hello world", 5) // "hello..."
 */
export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) {
    return str;
  }
  return str.slice(0, maxLen) + "...";
}
