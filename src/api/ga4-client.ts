import { google } from 'googleapis';
import type { analyticsadmin_v1beta, analyticsdata_v1beta } from 'googleapis';
import type { AuthClient } from '../auth/client-factory.js';
import { RateLimiter } from '../utils/rate-limiter.js';
import type {
  Ga4AccountSummary, Ga4Property, Ga4DataStream,
  Ga4ReportRequest, Ga4ReportResponse, Ga4MetadataItem,
} from './ga4-types.js';

export class Ga4ApiClient {
  readonly admin: analyticsadmin_v1beta.Analyticsadmin;
  readonly data: analyticsdata_v1beta.Analyticsdata;
  readonly rateLimiter: RateLimiter;

  constructor(auth: AuthClient, rateLimiter?: RateLimiter) {
    this.admin = google.analyticsadmin({ version: 'v1beta', auth: auth as any });
    this.data = google.analyticsdata({ version: 'v1beta', auth: auth as any });
    this.rateLimiter = rateLimiter ?? new RateLimiter(10, 15);
  }

  // --- Admin methods ---

  async listAccountSummaries(): Promise<Ga4AccountSummary[]> {
    await this.rateLimiter.acquire();
    const res = await this.admin.accountSummaries.list({ pageSize: 200 });
    return (res.data.accountSummaries ?? []) as Ga4AccountSummary[];
  }

  async listProperties(accountId: string): Promise<Ga4Property[]> {
    await this.rateLimiter.acquire();
    // Filter requires format "parent:accounts/123"
    const filter = accountId.startsWith('accounts/') ? `parent:${accountId}` : `parent:accounts/${accountId}`;
    const res = await this.admin.properties.list({ filter, pageSize: 200 });
    return (res.data.properties ?? []) as Ga4Property[];
  }

  async getProperty(propertyId: string): Promise<Ga4Property> {
    await this.rateLimiter.acquire();
    const name = propertyId.startsWith('properties/') ? propertyId : `properties/${propertyId}`;
    const res = await this.admin.properties.get({ name });
    return res.data as Ga4Property;
  }

  async createProperty(params: {
    accountId: string;
    displayName: string;
    timeZone: string;
    currencyCode?: string;
    industryCategory?: string;
  }): Promise<Ga4Property> {
    await this.rateLimiter.acquire();
    const parent = params.accountId.startsWith('accounts/') ? params.accountId : `accounts/${params.accountId}`;
    const res = await this.admin.properties.create({
      requestBody: {
        parent,
        displayName: params.displayName,
        timeZone: params.timeZone,
        currencyCode: params.currencyCode ?? 'USD',
        industryCategory: params.industryCategory,
      },
    });
    return res.data as Ga4Property;
  }

  async createDataStream(propertyId: string, url: string, streamName?: string): Promise<Ga4DataStream> {
    await this.rateLimiter.acquire();
    const parent = propertyId.startsWith('properties/') ? propertyId : `properties/${propertyId}`;
    const hostname = new URL(url).hostname;
    const res = await this.admin.properties.dataStreams.create({
      parent,
      requestBody: {
        type: 'WEB_DATA_STREAM',
        displayName: streamName ?? hostname,
        webStreamData: {
          defaultUri: url,
        },
      },
    });
    return res.data as Ga4DataStream;
  }

  async listDataStreams(propertyId: string): Promise<Ga4DataStream[]> {
    await this.rateLimiter.acquire();
    const parent = propertyId.startsWith('properties/') ? propertyId : `properties/${propertyId}`;
    const res = await this.admin.properties.dataStreams.list({ parent, pageSize: 200 });
    return (res.data.dataStreams ?? []) as Ga4DataStream[];
  }

  async getDataStream(propertyId: string, streamId: string): Promise<Ga4DataStream> {
    await this.rateLimiter.acquire();
    const parent = propertyId.startsWith('properties/') ? propertyId : `properties/${propertyId}`;
    const name = `${parent}/dataStreams/${streamId}`;
    const res = await this.admin.properties.dataStreams.get({ name });
    return res.data as Ga4DataStream;
  }

  // --- Reporting methods ---

  async runReport(request: Ga4ReportRequest): Promise<Ga4ReportResponse> {
    await this.rateLimiter.acquire();
    const property = request.propertyId.startsWith('properties/')
      ? request.propertyId
      : `properties/${request.propertyId}`;
    const res = await this.data.properties.runReport({
      property,
      requestBody: {
        dateRanges: [{ startDate: request.startDate, endDate: request.endDate }],
        metrics: request.metrics.map((m: string) => ({ name: m })),
        dimensions: request.dimensions?.map((d: string) => ({ name: d })),
        dimensionFilter: request.dimensionFilter,
        metricFilter: request.metricFilter,
        orderBys: request.orderBys,
        limit: request.limit ?? 100,
        offset: request.offset,
      },
    } as any);
    return (res as any).data as Ga4ReportResponse;
  }

  async runRealtimeReport(propertyId: string, metrics: string[], dimensions?: string[]): Promise<Ga4ReportResponse> {
    await this.rateLimiter.acquire();
    const property = propertyId.startsWith('properties/')
      ? propertyId
      : `properties/${propertyId}`;
    const res = await this.data.properties.runRealtimeReport({
      property,
      requestBody: {
        metrics: metrics.map((m: string) => ({ name: m })),
        dimensions: dimensions?.map((d: string) => ({ name: d })),
      },
    } as any);
    return (res as any).data as Ga4ReportResponse;
  }

  async getMetadata(propertyId: string): Promise<Ga4MetadataItem[]> {
    await this.rateLimiter.acquire();
    const property = propertyId.startsWith('properties/') ? propertyId : `properties/${propertyId}`;
    const res = await this.data.properties.getMetadata({ name: `${property}/metadata` });
    const dimensions = (res.data.dimensions ?? []).map((d: any) => ({
      apiName: d.apiName ?? '',
      uiName: d.uiName ?? '',
      description: d.description ?? '',
      category: d.category ?? '',
      customDefinition: d.customDefinition ?? false,
    }));
    const metrics = (res.data.metrics ?? []).map((m: any) => ({
      apiName: m.apiName ?? '',
      uiName: m.uiName ?? '',
      description: m.description ?? '',
      category: m.category ?? '',
      customDefinition: m.customDefinition ?? false,
    }));
    return [...dimensions, ...metrics];
  }
}
