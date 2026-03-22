/**
 * Sites endpoints for Google Search Console.
 *
 * Wraps the webmasters v3 `sites` resource with caching and rate limiting.
 * Mutation operations (add / delete) invalidate relevant cache entries.
 */

import type { webmasters_v3 } from 'googleapis';
import type { CacheManager } from '../cache/cache-manager.js';
import { CACHE_TTL } from '../cache/cache-manager.js';
import { buildSitesKey } from '../cache/cache-keys.js';
import type { RateLimiter } from '../utils/rate-limiter.js';
import { handleApiError } from '../errors/error-handler.js';
import type { SiteInfo } from './types.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * List all sites (properties) the authenticated account has access to.
 */
export async function listSites(
  client: webmasters_v3.Webmasters,
  cache: CacheManager,
  rateLimiter: RateLimiter,
): Promise<SiteInfo[]> {
  const cacheKey = buildSitesKey();
  const cached = cache.get<SiteInfo[]>(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  try {
    await rateLimiter.acquire();
    const response = await client.sites.list();

    const sites: SiteInfo[] = (response.data.siteEntry ?? []).map((entry) => ({
      siteUrl: entry.siteUrl ?? '',
      permissionLevel: entry.permissionLevel ?? 'unknown',
    }));

    cache.set(cacheKey, sites, CACHE_TTL.SITES);
    return sites;
  } catch (error) {
    throw handleApiError(error);
  }
}

/**
 * Get metadata for a single site.
 */
export async function getSite(
  client: webmasters_v3.Webmasters,
  siteUrl: string,
  cache: CacheManager,
  rateLimiter: RateLimiter,
): Promise<SiteInfo> {
  const cacheKey = buildSitesKey(siteUrl);
  const cached = cache.get<SiteInfo>(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  try {
    await rateLimiter.acquire();
    const response = await client.sites.get({ siteUrl });

    const site: SiteInfo = {
      siteUrl: response.data.siteUrl ?? siteUrl,
      permissionLevel: response.data.permissionLevel ?? 'unknown',
    };

    cache.set(cacheKey, site, CACHE_TTL.SITES);
    return site;
  } catch (error) {
    throw handleApiError(error);
  }
}

/**
 * Add a site to the authenticated account's Search Console.
 * Invalidates the sites list cache on success.
 */
export async function addSite(
  client: webmasters_v3.Webmasters,
  siteUrl: string,
  cache: CacheManager,
  rateLimiter: RateLimiter,
): Promise<void> {
  try {
    await rateLimiter.acquire();
    await client.sites.add({ siteUrl });

    // Invalidate both the full list and the specific site entry.
    cache.delete(buildSitesKey());
    cache.delete(buildSitesKey(siteUrl));
  } catch (error) {
    throw handleApiError(error);
  }
}

/**
 * Remove a site from the authenticated account's Search Console.
 * Invalidates the sites list cache on success.
 */
export async function deleteSite(
  client: webmasters_v3.Webmasters,
  siteUrl: string,
  cache: CacheManager,
  rateLimiter: RateLimiter,
): Promise<void> {
  try {
    await rateLimiter.acquire();
    await client.sites.delete({ siteUrl });

    // Invalidate both the full list and the specific site entry.
    cache.delete(buildSitesKey());
    cache.delete(buildSitesKey(siteUrl));
  } catch (error) {
    throw handleApiError(error);
  }
}
