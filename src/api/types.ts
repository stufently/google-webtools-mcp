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

export interface SearchAnalyticsResponse {
  rows: SearchAnalyticsRow[];
  responseAggregationType: string;
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
  warnings?: string;
  errors?: string;
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
