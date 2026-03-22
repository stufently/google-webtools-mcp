/**
 * URL Inspection API wrapper.
 *
 * Uses the Search Console v1 `urlInspection.index.inspect` endpoint, which
 * is a *different* API from the webmasters v3 client used elsewhere.
 */

import type { searchconsole_v1 } from 'googleapis';
import type { CacheManager } from '../cache/cache-manager.js';
import { CACHE_TTL } from '../cache/cache-manager.js';
import { buildInspectionKey } from '../cache/cache-keys.js';
import type { RateLimiter } from '../utils/rate-limiter.js';
import { handleApiError } from '../errors/error-handler.js';
import { ValidationError } from '../errors/gsc-error.js';
import type { InspectionResult } from './types.js';

/** Maximum URLs accepted by `batchInspectUrls`. */
const MAX_BATCH_SIZE = 50;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Map the raw API inspection result to our typed {@link InspectionResult}.
 */
function toInspectionResult(
  raw: searchconsole_v1.Schema$UrlInspectionResult,
): InspectionResult {
  const idx = raw.indexStatusResult;
  const mob = raw.mobileUsabilityResult;
  const rich = raw.richResultsResult;

  return {
    inspectionResultLink: raw.inspectionResultLink ?? '',
    indexStatusResult: idx
      ? {
          verdict: idx.verdict ?? 'VERDICT_UNSPECIFIED',
          coverageState: idx.coverageState ?? '',
          robotsTxtState: idx.robotsTxtState ?? '',
          indexingState: idx.indexingState ?? '',
          lastCrawlTime: idx.lastCrawlTime ?? undefined,
          pageFetchState: idx.pageFetchState ?? '',
          googleCanonical: idx.googleCanonical ?? undefined,
          userCanonical: idx.userCanonical ?? undefined,
          sitemap: (idx.sitemap as string[] | undefined) ?? undefined,
          referringUrls: (idx.referringUrls as string[] | undefined) ?? undefined,
          crawledAs: idx.crawledAs ?? undefined,
        }
      : undefined,
    mobileUsabilityResult: mob
      ? {
          verdict: mob.verdict ?? 'VERDICT_UNSPECIFIED',
          issues: mob.issues?.map((issue) => ({
            issueType: issue.issueType ?? '',
            severity: issue.severity ?? '',
            message: issue.message ?? '',
          })),
        }
      : undefined,
    richResultsResult: rich
      ? {
          verdict: rich.verdict ?? 'VERDICT_UNSPECIFIED',
          detectedItems: rich.detectedItems?.map((item) => ({
            richResultType: item.richResultType ?? '',
            items: item.items ?? [],
          })),
        }
      : undefined,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Inspect a single URL using the Search Console URL Inspection API.
 */
export async function inspectUrl(
  client: searchconsole_v1.Searchconsole,
  siteUrl: string,
  inspectionUrl: string,
  cache: CacheManager,
  rateLimiter: RateLimiter,
): Promise<InspectionResult> {
  const cacheKey = buildInspectionKey(siteUrl, inspectionUrl);
  const cached = cache.get<InspectionResult>(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  try {
    await rateLimiter.acquire();

    const response = await client.urlInspection.index.inspect({
      requestBody: {
        inspectionUrl,
        siteUrl,
      },
    });

    const raw = response.data.inspectionResult;
    if (!raw) {
      throw new Error(
        `URL Inspection API returned no result for "${inspectionUrl}".`,
      );
    }

    const result = toInspectionResult(raw);
    cache.set(cacheKey, result, CACHE_TTL.URL_INSPECTION);
    return result;
  } catch (error) {
    throw handleApiError(error);
  }
}

/**
 * Inspect multiple URLs sequentially with rate limiting.
 *
 * The Search Console URL Inspection API does not support batch requests
 * natively, so each URL is inspected individually. A maximum of
 * {@link MAX_BATCH_SIZE} URLs can be inspected in a single call.
 *
 * @throws {ValidationError} if more than 50 URLs are provided.
 */
export async function batchInspectUrls(
  client: searchconsole_v1.Searchconsole,
  siteUrl: string,
  urls: string[],
  cache: CacheManager,
  rateLimiter: RateLimiter,
): Promise<InspectionResult[]> {
  if (urls.length > MAX_BATCH_SIZE) {
    throw new ValidationError(
      `batchInspectUrls accepts at most ${MAX_BATCH_SIZE} URLs, but ${urls.length} were provided.`,
      {
        recoveryHint: `Split the URL list into batches of ${MAX_BATCH_SIZE} or fewer.`,
        fieldErrors: {
          urls: [`Must contain at most ${MAX_BATCH_SIZE} entries.`],
        },
      },
    );
  }

  const results: InspectionResult[] = [];

  for (const url of urls) {
    const result = await inspectUrl(client, siteUrl, url, cache, rateLimiter);
    results.push(result);
  }

  return results;
}
