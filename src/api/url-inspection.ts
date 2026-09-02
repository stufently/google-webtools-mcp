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
import { GscError, ValidationError } from '../errors/gsc-error.js';
import { decodeHtmlEntities } from '../utils/html-entities.js';
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
            message: decodeHtmlEntities(issue.message ?? ''),
          })),
        }
      : undefined,
    richResultsResult: rich
      ? {
          verdict: rich.verdict ?? 'VERDICT_UNSPECIFIED',
          detectedItems: rich.detectedItems?.map((item) => ({
            // Google sends these labels HTML-escaped ("Q&amp;A"). Our output is
            // markdown, so decode here rather than shipping the entity through.
            richResultType: decodeHtmlEntities(item.richResultType ?? ''),
            items: (item.items ?? []).map((entity) => ({
              name: entity.name ? decodeHtmlEntities(entity.name) : undefined,
              // The reason a rich result FAILs lives here and nowhere else.
              issues: entity.issues?.map((issue) => ({
                issueMessage: decodeHtmlEntities(issue.issueMessage ?? ''),
                severity: issue.severity ?? '',
              })),
            })),
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

/**
 * One URL's inspection outcome: either a result or the reason it failed.
 */
export type InspectionOutcome =
  | { url: string; ok: true; result: InspectionResult }
  | { url: string; ok: false; error: string };

/**
 * Turns an inspection failure into a line a report can print.
 *
 * The raw message from the API is often just "Internal error encountered",
 * which names neither the URL nor the step; the caller supplies the URL and
 * the recovery hint carries whatever else is known.
 */
export function describeInspectionError(error: unknown): string {
  if (error instanceof GscError) {
    const hint = error.recoveryHint ? ` ${error.recoveryHint}` : '';
    return `${error.code} (HTTP ${error.statusCode}): ${error.message}${hint}`;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Inspects every URL and reports per-URL outcomes instead of throwing.
 *
 * The Inspection API fails transiently on individual URLs -- the same URL that
 * returns "Internal error encountered" succeeds a minute later. Letting that
 * one failure reject the whole call throws away the other 19 inspections that
 * did succeed, and the caller cannot even tell which URL broke. Here each URL
 * stands or falls on its own.
 */
export async function inspectUrlsSettled(
  client: searchconsole_v1.Searchconsole,
  siteUrl: string,
  urls: string[],
  cache: CacheManager,
  rateLimiter: RateLimiter,
): Promise<InspectionOutcome[]> {
  const outcomes: InspectionOutcome[] = [];

  for (const url of urls) {
    try {
      const result = await inspectUrl(client, siteUrl, url, cache, rateLimiter);
      outcomes.push({ url, ok: true, result });
    } catch (error) {
      outcomes.push({ url, ok: false, error: describeInspectionError(error) });
    }
  }

  return outcomes;
}
