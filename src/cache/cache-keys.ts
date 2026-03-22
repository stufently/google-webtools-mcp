/**
 * Deterministic cache-key builders for GSC data.
 *
 * Keys are human-readable and use `|` as a segment separator.
 * Object parameters are serialized with sorted keys so that the same
 * logical request always produces the same cache key.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Produce a stable JSON string by sorting object keys recursively.
 * Primitive values are returned as-is via `JSON.stringify`.
 */
function stableStringify(value: unknown): string {
  if (value === null || value === undefined) {
    return String(value);
  }

  if (Array.isArray(value)) {
    return "[" + value.map(stableStringify).join(",") + "]";
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const sortedKeys = Object.keys(obj).sort();
    const parts = sortedKeys
      .filter((k) => obj[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`);
    return "{" + parts.join(",") + "}";
  }

  return JSON.stringify(value);
}

// ---------------------------------------------------------------------------
// Key builders
// ---------------------------------------------------------------------------

/**
 * Build a cache key for an analytics (Search Analytics) query.
 *
 * @param siteUrl  The GSC property URL (e.g. `sc-domain:example.com`).
 * @param params   The query parameters object – order of keys does not matter.
 */
export function buildAnalyticsKey(
  siteUrl: string,
  params: Record<string, unknown>,
): string {
  return `analytics|${siteUrl}|${stableStringify(params)}`;
}

/**
 * Build a cache key for the sites list or a single site.
 *
 * @param siteUrl  Optional – if provided, the key targets a single site's metadata.
 */
export function buildSitesKey(siteUrl?: string): string {
  if (siteUrl !== undefined) {
    return `sites|${siteUrl}`;
  }
  return "sites|__all__";
}

/**
 * Build a cache key for sitemaps.
 *
 * @param siteUrl   The GSC property URL.
 * @param feedpath  Optional specific sitemap URL / feed path.
 */
export function buildSitemapsKey(siteUrl: string, feedpath?: string): string {
  if (feedpath !== undefined) {
    return `sitemaps|${siteUrl}|${feedpath}`;
  }
  return `sitemaps|${siteUrl}|__all__`;
}

/**
 * Build a cache key for a URL inspection result.
 *
 * @param siteUrl        The GSC property URL.
 * @param inspectionUrl  The URL that was inspected.
 */
export function buildInspectionKey(
  siteUrl: string,
  inspectionUrl: string,
): string {
  return `inspection|${siteUrl}|${inspectionUrl}`;
}
