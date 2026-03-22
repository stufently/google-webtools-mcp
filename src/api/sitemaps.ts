/**
 * Sitemaps endpoints for Google Search Console.
 *
 * Wraps the webmasters v3 `sitemaps` resource with caching and rate limiting.
 * Mutation operations (submit / delete) invalidate relevant cache entries.
 */

import type { webmasters_v3 } from 'googleapis';
import type { CacheManager } from '../cache/cache-manager.js';
import { CACHE_TTL } from '../cache/cache-manager.js';
import { buildSitemapsKey } from '../cache/cache-keys.js';
import type { RateLimiter } from '../utils/rate-limiter.js';
import { handleApiError } from '../errors/error-handler.js';
import type { SitemapInfo, SitemapContent } from './types.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Map a raw API sitemap entry to our typed {@link SitemapInfo}.
 */
function toSitemapInfo(raw: webmasters_v3.Schema$WmxSitemap): SitemapInfo {
  const contents: SitemapContent[] = (raw.contents ?? []).map((c) => ({
    type: c.type ?? 'unknown',
    submitted: c.submitted ?? undefined,
    indexed: c.indexed ?? undefined,
  }));

  return {
    path: raw.path ?? '',
    lastSubmitted: raw.lastSubmitted ?? undefined,
    isPending: raw.isPending ?? false,
    isSitemapsIndex: raw.isSitemapsIndex ?? false,
    type: raw.type ?? 'unknown',
    lastDownloaded: raw.lastDownloaded ?? undefined,
    warnings: raw.warnings ?? undefined,
    errors: raw.errors ?? undefined,
    contents: contents.length > 0 ? contents : undefined,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * List all sitemaps submitted for a site.
 */
export async function listSitemaps(
  client: webmasters_v3.Webmasters,
  siteUrl: string,
  cache: CacheManager,
  rateLimiter: RateLimiter,
): Promise<SitemapInfo[]> {
  const cacheKey = buildSitemapsKey(siteUrl);
  const cached = cache.get<SitemapInfo[]>(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  try {
    await rateLimiter.acquire();
    const response = await client.sitemaps.list({ siteUrl });

    const sitemaps: SitemapInfo[] = (response.data.sitemap ?? []).map(toSitemapInfo);

    cache.set(cacheKey, sitemaps, CACHE_TTL.SITEMAPS);
    return sitemaps;
  } catch (error) {
    throw handleApiError(error);
  }
}

/**
 * Get details for a specific sitemap.
 */
export async function getSitemap(
  client: webmasters_v3.Webmasters,
  siteUrl: string,
  feedpath: string,
  cache: CacheManager,
  rateLimiter: RateLimiter,
): Promise<SitemapInfo> {
  const cacheKey = buildSitemapsKey(siteUrl, feedpath);
  const cached = cache.get<SitemapInfo>(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  try {
    await rateLimiter.acquire();
    const response = await client.sitemaps.get({ siteUrl, feedpath });

    const sitemap = toSitemapInfo(response.data);

    cache.set(cacheKey, sitemap, CACHE_TTL.SITEMAPS);
    return sitemap;
  } catch (error) {
    throw handleApiError(error);
  }
}

/**
 * Submit (or resubmit) a sitemap for a site.
 * Invalidates sitemaps cache for the site on success.
 */
export async function submitSitemap(
  client: webmasters_v3.Webmasters,
  siteUrl: string,
  feedpath: string,
  cache: CacheManager,
  rateLimiter: RateLimiter,
): Promise<void> {
  try {
    await rateLimiter.acquire();
    await client.sitemaps.submit({ siteUrl, feedpath });

    // Invalidate list and the specific sitemap entry.
    cache.delete(buildSitemapsKey(siteUrl));
    cache.delete(buildSitemapsKey(siteUrl, feedpath));
  } catch (error) {
    throw handleApiError(error);
  }
}

/**
 * Delete a sitemap from a site.
 * Invalidates sitemaps cache for the site on success.
 */
export async function deleteSitemap(
  client: webmasters_v3.Webmasters,
  siteUrl: string,
  feedpath: string,
  cache: CacheManager,
  rateLimiter: RateLimiter,
): Promise<void> {
  try {
    await rateLimiter.acquire();
    await client.sitemaps.delete({ siteUrl, feedpath });

    // Invalidate list and the specific sitemap entry.
    cache.delete(buildSitemapsKey(siteUrl));
    cache.delete(buildSitemapsKey(siteUrl, feedpath));
  } catch (error) {
    throw handleApiError(error);
  }
}
