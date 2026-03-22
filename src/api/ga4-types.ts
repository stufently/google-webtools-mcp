export interface Ga4Account {
  account: string; // "accounts/123"
  displayName: string;
  name: string;
}

export interface Ga4AccountSummary {
  account: string;
  displayName: string;
  propertySummaries?: Ga4PropertySummary[];
}

export interface Ga4PropertySummary {
  property: string; // "properties/123"
  displayName: string;
  propertyType: string;
}

export interface Ga4Property {
  name: string; // "properties/123"
  displayName: string;
  timeZone: string;
  currencyCode: string;
  createTime: string;
  updateTime: string;
  industryCategory?: string;
  propertyType: string;
  parent?: string;
}

export interface Ga4DataStream {
  name: string; // "properties/123/dataStreams/456"
  type: string; // "WEB_DATA_STREAM"
  displayName: string;
  webStreamData?: {
    measurementId: string; // "G-XXXXXXX"
    defaultUri: string;
  };
  createTime: string;
  updateTime: string;
}

export interface Ga4ReportRequest {
  propertyId: string;
  startDate: string;
  endDate: string;
  metrics: string[];
  dimensions?: string[];
  dimensionFilter?: any;
  metricFilter?: any;
  orderBys?: any[];
  limit?: number;
  offset?: number;
}

export interface Ga4ReportRow {
  dimensionValues: { value: string }[];
  metricValues: { value: string }[];
}

export interface Ga4ReportResponse {
  dimensionHeaders: { name: string }[];
  metricHeaders: { name: string; type: string }[];
  rows: Ga4ReportRow[];
  rowCount: number;
  metadata?: any;
}

export interface Ga4MetadataItem {
  apiName: string;
  uiName: string;
  description: string;
  category: string;
  customDefinition: boolean;
}
