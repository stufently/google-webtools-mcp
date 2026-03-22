/**
 * Search Analytics query functions with auto-pagination support.
 *
 * The Google Search Console API caps a single response at 25 000 rows.
 * These helpers transparently paginate to retrieve larger result sets.
 */

import type { webmasters_v3 } from 'googleapis';
import type { CacheManager } from '../cache/cache-manager.js';
import { CACHE_TTL } from '../cache/cache-manager.js';
import { buildAnalyticsKey } from '../cache/cache-keys.js';
import type { RateLimiter } from '../utils/rate-limiter.js';
import { handleApiError } from '../errors/error-handler.js';
import { isDateFresh } from '../utils/date-helpers.js';
import type {
  SearchAnalyticsRequest,
  SearchAnalyticsRow,
  SearchAnalyticsResponse,
} from './types.js';

/** Google API maximum rows per single request. */
const API_MAX_ROW_LIMIT = 25_000;

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

/**
 * Execute a single searchanalytics.query call against the API.
 */
async function executeSingleQuery(
  client: webmasters_v3.Webmasters,
  request: SearchAnalyticsRequest,
  rateLimiter: RateLimiter,
): Promise<SearchAnalyticsResponse> {
  await rateLimiter.acquire();

  const { siteUrl, ...requestBody } = request;

  const response = await client.searchanalytics.query({
    siteUrl,
    requestBody: {
      startDate: requestBody.startDate,
      endDate: requestBody.endDate,
      dimensions: requestBody.dimensions,
      searchType: requestBody.searchType,
      dimensionFilterGroups: requestBody.dimensionFilterGroups,
      rowLimit: requestBody.rowLimit,
      startRow: requestBody.startRow,
      dataState: requestBody.dataState,
      aggregationType: requestBody.aggregationType,
    },
  });

  const data = response.data;

  const rows: SearchAnalyticsRow[] = (data.rows ?? []).map((row) => ({
    keys: row.keys ?? [],
    clicks: row.clicks ?? 0,
    impressions: row.impressions ?? 0,
    ctr: row.ctr ?? 0,
    position: row.position ?? 0,
  }));

  return {
    rows,
    responseAggregationType: data.responseAggregationType ?? 'auto',
  };
}

/**
 * Choose the appropriate cache TTL based on whether the queried date range
 * contains recent (potentially still changing) data.
 */
function chooseTtl(request: SearchAnalyticsRequest): number {
  // Data within the last 2 days is considered "fresh" and may still update.
  if (isDateFresh(request.endDate, 2)) {
    return CACHE_TTL.ANALYTICS_FRESH;
  }
  return CACHE_TTL.ANALYTICS_FINAL;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Query search analytics data with automatic pagination.
 *
 * If the requested `rowLimit` exceeds 25 000, multiple API calls are made
 * using `startRow` offsets and the results are concatenated.
 *
 * @returns A merged {@link SearchAnalyticsResponse}.
 */
export async function querySearchAnalytics(
  client: webmasters_v3.Webmasters,
  request: SearchAnalyticsRequest,
  cache: CacheManager,
  rateLimiter: RateLimiter,
): Promise<SearchAnalyticsResponse> {
  const cacheKey = buildAnalyticsKey(
    request.siteUrl,
    request as unknown as Record<string, unknown>,
  );
  const cached = cache.get<SearchAnalyticsResponse>(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  try {
    const desiredLimit = request.rowLimit ?? API_MAX_ROW_LIMIT;

    // If within a single page, just fetch directly.
    if (desiredLimit <= API_MAX_ROW_LIMIT) {
      const result = await executeSingleQuery(
        client,
        { ...request, rowLimit: desiredLimit },
        rateLimiter,
      );
      cache.set(cacheKey, result, chooseTtl(request));
      return result;
    }

    // Multi-page fetch: iterate with startRow offsets.
    const allRows: SearchAnalyticsRow[] = [];
    let startRow = request.startRow ?? 0;
    let responseAggregationType = 'auto';

    while (allRows.length < desiredLimit) {
      const pageSize = Math.min(API_MAX_ROW_LIMIT, desiredLimit - allRows.length);

      const page = await executeSingleQuery(
        client,
        { ...request, rowLimit: pageSize, startRow },
        rateLimiter,
      );

      responseAggregationType = page.responseAggregationType;
      allRows.push(...page.rows);

      // If the API returned fewer rows than requested, we have reached the end.
      if (page.rows.length < pageSize) {
        break;
      }

      startRow += page.rows.length;
    }

    const result: SearchAnalyticsResponse = {
      rows: allRows,
      responseAggregationType,
    };

    cache.set(cacheKey, result, chooseTtl(request));
    return result;
  } catch (error) {
    throw handleApiError(error);
  }
}

/**
 * Fetch **all** rows for a search analytics query by paginating until
 * the API returns an empty page.
 *
 * Use with caution on very broad queries — this can issue many API calls.
 *
 * @returns A merged {@link SearchAnalyticsResponse} containing every row.
 */
export async function querySearchAnalyticsAllRows(
  client: webmasters_v3.Webmasters,
  request: SearchAnalyticsRequest,
  cache: CacheManager,
  rateLimiter: RateLimiter,
): Promise<SearchAnalyticsResponse> {
  const cacheKey = buildAnalyticsKey(request.siteUrl, {
    ...(request as unknown as Record<string, unknown>),
    _allRows: true,
  });
  const cached = cache.get<SearchAnalyticsResponse>(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  try {
    const allRows: SearchAnalyticsRow[] = [];
    let startRow = request.startRow ?? 0;
    let responseAggregationType = 'auto';

    while (true) {
      const page = await executeSingleQuery(
        client,
        { ...request, rowLimit: API_MAX_ROW_LIMIT, startRow },
        rateLimiter,
      );

      responseAggregationType = page.responseAggregationType;
      allRows.push(...page.rows);

      // An empty or partial page signals the end of data.
      if (page.rows.length < API_MAX_ROW_LIMIT) {
        break;
      }

      startRow += page.rows.length;
    }

    const result: SearchAnalyticsResponse = {
      rows: allRows,
      responseAggregationType,
    };

    cache.set(cacheKey, result, chooseTtl(request));
    return result;
  } catch (error) {
    throw handleApiError(error);
  }
}
