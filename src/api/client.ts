/**
 * Unified API client for Google Search Console.
 *
 * Holds the webmasters v3 client, searchconsole v1 client, cache manager,
 * and rate limiter, and exposes every GSC operation as a typed method.
 */

import { google } from 'googleapis';
import type { webmasters_v3, searchconsole_v1 } from 'googleapis';
import type { AuthClient } from '../auth/client-factory.js';
import { CacheManager } from '../cache/cache-manager.js';
import { RateLimiter } from '../utils/rate-limiter.js';
import type {
  SearchAnalyticsRequest,
  SearchAnalyticsResponse,
  SiteInfo,
  SitemapInfo,
  InspectionResult,
} from './types.js';
import {
  querySearchAnalytics,
  querySearchAnalyticsAllRows,
} from './search-analytics.js';
import { listSites, getSite, addSite, deleteSite } from './sites.js';
import {
  listSitemaps,
  getSitemap,
  submitSitemap,
  deleteSitemap,
} from './sitemaps.js';
import { inspectUrl, batchInspectUrls } from './url-inspection.js';

// ---------------------------------------------------------------------------
// Client class
// ---------------------------------------------------------------------------

export class GscApiClient {
  readonly webmasters: webmasters_v3.Webmasters;
  readonly searchconsole: searchconsole_v1.Searchconsole;
  readonly cache: CacheManager;
  readonly rateLimiter: RateLimiter;

  constructor(auth: AuthClient, cache?: CacheManager, rateLimiter?: RateLimiter) {
    this.webmasters = google.webmasters({ version: 'v3', auth: auth as any });
    this.searchconsole = google.searchconsole({ version: 'v1', auth: auth as any });
    this.cache = cache ?? new CacheManager();
    this.rateLimiter = rateLimiter ?? new RateLimiter(20, 30);
  }

  // -------------------------------------------------------------------------
  // Search Analytics
  // -------------------------------------------------------------------------

  /**
   * Query search analytics with automatic pagination when `rowLimit` > 25 000.
   */
  async querySearchAnalytics(
    request: SearchAnalyticsRequest,
  ): Promise<SearchAnalyticsResponse> {
    return querySearchAnalytics(
      this.webmasters,
      request,
      this.cache,
      this.rateLimiter,
    );
  }

  /**
   * Fetch all available rows for a search analytics query.
   * Paginates automatically until the API returns an empty page.
   */
  async querySearchAnalyticsAllRows(
    request: SearchAnalyticsRequest,
  ): Promise<SearchAnalyticsResponse> {
    return querySearchAnalyticsAllRows(
      this.webmasters,
      request,
      this.cache,
      this.rateLimiter,
    );
  }

  // -------------------------------------------------------------------------
  // Sites
  // -------------------------------------------------------------------------

  /** List all sites the authenticated account has access to. */
  async listSites(): Promise<SiteInfo[]> {
    return listSites(this.webmasters, this.cache, this.rateLimiter);
  }

  /** Get metadata for a single site. */
  async getSite(siteUrl: string): Promise<SiteInfo> {
    return getSite(this.webmasters, siteUrl, this.cache, this.rateLimiter);
  }

  /** Add a site to Search Console. */
  async addSite(siteUrl: string): Promise<void> {
    return addSite(this.webmasters, siteUrl, this.cache, this.rateLimiter);
  }

  /** Remove a site from Search Console. */
  async deleteSite(siteUrl: string): Promise<void> {
    return deleteSite(this.webmasters, siteUrl, this.cache, this.rateLimiter);
  }

  // -------------------------------------------------------------------------
  // Sitemaps
  // -------------------------------------------------------------------------

  /** List all sitemaps for a site. */
  async listSitemaps(siteUrl: string): Promise<SitemapInfo[]> {
    return listSitemaps(this.webmasters, siteUrl, this.cache, this.rateLimiter);
  }

  /** Get details for a specific sitemap. */
  async getSitemap(siteUrl: string, feedpath: string): Promise<SitemapInfo> {
    return getSitemap(
      this.webmasters,
      siteUrl,
      feedpath,
      this.cache,
      this.rateLimiter,
    );
  }

  /** Submit (or resubmit) a sitemap. */
  async submitSitemap(siteUrl: string, feedpath: string): Promise<void> {
    return submitSitemap(
      this.webmasters,
      siteUrl,
      feedpath,
      this.cache,
      this.rateLimiter,
    );
  }

  /** Delete a sitemap. */
  async deleteSitemap(siteUrl: string, feedpath: string): Promise<void> {
    return deleteSitemap(
      this.webmasters,
      siteUrl,
      feedpath,
      this.cache,
      this.rateLimiter,
    );
  }

  // -------------------------------------------------------------------------
  // URL Inspection
  // -------------------------------------------------------------------------

  /** Inspect a single URL. */
  async inspectUrl(
    siteUrl: string,
    inspectionUrl: string,
  ): Promise<InspectionResult> {
    return inspectUrl(
      this.searchconsole,
      siteUrl,
      inspectionUrl,
      this.cache,
      this.rateLimiter,
    );
  }

  /**
   * Inspect multiple URLs sequentially (max 50).
   * Each URL is rate-limited individually.
   */
  async batchInspectUrls(
    siteUrl: string,
    urls: string[],
  ): Promise<InspectionResult[]> {
    return batchInspectUrls(
      this.searchconsole,
      siteUrl,
      urls,
      this.cache,
      this.rateLimiter,
    );
  }
}
