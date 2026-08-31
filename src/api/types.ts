// SearchAnalyticsRequest - matches Google's searchanalytics.query API
export interface SearchAnalyticsRequest {
  siteUrl: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;
  dimensions?: ('date' | 'query' | 'page' | 'country' | 'device' | 'searchAppearance')[];
  searchType?: 'web' | 'image' | 'video' | 'news' | 'discover' | 'googleNews';
  dimensionFilterGroups?: DimensionFilterGroup[];
  rowLimit?: number; // max 25000
  startRow?: number;
  dataState?: 'all' | 'final';
  aggregationType?: 'auto' | 'byPage' | 'byProperty';
}

export interface DimensionFilterGroup {
  groupType?: 'and';
  filters: DimensionFilter[];
}

export interface DimensionFilter {
  dimension: string;
  operator: 'contains' | 'equals' | 'notContains' | 'notEquals' | 'includingRegex' | 'excludingRegex';
  expression: string;
}

export interface SearchAnalyticsRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

/**
 * Freshness metadata the API attaches to a response.
 *
 * `first_incomplete_date` is populated only when the request asked for
 * `dataState: "all"` and grouped by date; it names the first day that is still
 * being collected, so the day before it is the last complete one.
 */
export interface SearchAnalyticsMetadata {
  first_incomplete_date?: string;
  first_incomplete_hour?: string;
}

export interface SearchAnalyticsResponse {
  rows: SearchAnalyticsRow[];
  responseAggregationType: string;
  /** Present only when the API returned it — see {@link SearchAnalyticsMetadata}. */
  metadata?: SearchAnalyticsMetadata;
}

// SiteInfo, SitemapInfo, InspectionResult types too
export interface SiteInfo {
  siteUrl: string;
  permissionLevel: string;
}

export interface SitemapInfo {
  path: string;
  lastSubmitted?: string;
  isPending: boolean;
  isSitemapsIndex: boolean;
  type: string;
  lastDownloaded?: string;
  warnings?: number;
  errors?: number;
  contents?: SitemapContent[];
}

export interface SitemapContent {
  type: string;
  submitted?: string;
  indexed?: string;
}

export interface InspectionResult {
  inspectionResultLink: string;
  indexStatusResult?: {
    verdict: string;
    coverageState: string;
    robotsTxtState: string;
    indexingState: string;
    lastCrawlTime?: string;
    pageFetchState: string;
    googleCanonical?: string;
    userCanonical?: string;
    sitemap?: string[];
    referringUrls?: string[];
    crawledAs?: string;
  };
  mobileUsabilityResult?: {
    verdict: string;
    issues?: { issueType: string; severity: string; message: string }[];
  };
  richResultsResult?: {
    verdict: string;
    detectedItems?: { richResultType: string; items: any[] }[];
  };
}
