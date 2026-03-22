import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { Ga4ApiClient } from '../../api/ga4-client.js';
import { createToolResponse, formatToolResponse } from '../schemas.js';
import { GscError } from '../../errors/gsc-error.js';

/**
 * Format an error into an MCP tool error response.
 */
function errorResponse(error: unknown) {
  const message =
    error instanceof GscError
      ? `${error.message}${error.recoveryHint ? `\n\nHint: ${error.recoveryHint}` : ''}`
      : error instanceof Error
        ? error.message
        : 'An unexpected error occurred.';

  return {
    content: [{ type: 'text' as const, text: message }],
    isError: true,
  };
}

export function registerGa4AdminTools(server: McpServer, ga4: Ga4ApiClient): void {
  // ── ga4_list_accounts ─────────────────────────────────────────────────
  server.tool(
    'ga4_list_accounts',
    'List all GA4 accounts and their properties accessible to the authenticated user',
    {},
    async () => {
      try {
        const summaries = await ga4.listAccountSummaries();

        const rows = summaries.map((s) => {
          const properties = s.propertySummaries ?? [];
          const propList = properties.length > 0
            ? properties.map(p => `  - ${p.displayName} (${p.property}, ${p.propertyType})`).join('\n')
            : '  - _No properties_';
          return `- **${s.displayName}** (${s.account})\n${propList}`;
        });

        const totalProperties = summaries.reduce(
          (acc, s) => acc + (s.propertySummaries?.length ?? 0), 0,
        );

        const data = rows.length > 0 ? rows.join('\n') : '_No accounts found._';
        const summary = `Found ${summaries.length} account${summaries.length === 1 ? '' : 's'} with ${totalProperties} propert${totalProperties === 1 ? 'y' : 'ies'} total.`;

        const recommendations: string[] = [];
        if (summaries.length === 0) {
          recommendations.push('No accounts found. Verify that the authenticated account has access to GA4 properties.');
        }

        const limitations = [
          'Only accounts and properties accessible to the authenticated account are listed.',
        ];

        const text = formatToolResponse(createToolResponse(data, summary, recommendations, limitations));
        return { content: [{ type: 'text' as const, text }] };
      } catch (error) {
        return errorResponse(error);
      }
    },
  );

  // ── ga4_list_properties ───────────────────────────────────────────────
  server.tool(
    'ga4_list_properties',
    'List all GA4 properties for a specific account',
    {
      account_id: z.string().describe('GA4 account ID (e.g., "123456" or "accounts/123456")'),
    },
    async ({ account_id }) => {
      try {
        const properties = await ga4.listProperties(account_id);

        const rows = properties.map((p) => {
          const lines = [
            `| Field | Value |`,
            `| --- | --- |`,
            `| **Name** | ${p.displayName} |`,
            `| **ID** | ${p.name} |`,
            `| **Type** | ${p.propertyType} |`,
            `| **Timezone** | ${p.timeZone} |`,
            `| **Currency** | ${p.currencyCode} |`,
            `| **Created** | ${p.createTime} |`,
          ];
          if (p.industryCategory) {
            lines.push(`| **Industry** | ${p.industryCategory} |`);
          }
          return lines.join('\n');
        });

        const data = rows.length > 0 ? rows.join('\n\n') : '_No properties found for this account._';
        const summary = `Found ${properties.length} propert${properties.length === 1 ? 'y' : 'ies'} for account ${account_id}.`;

        const recommendations: string[] = [];
        if (properties.length === 0) {
          recommendations.push('No properties found. Use ga4_create_property to create one.');
        }

        const limitations = [
          'Only properties the authenticated account has access to are listed.',
        ];

        const text = formatToolResponse(createToolResponse(data, summary, recommendations, limitations));
        return { content: [{ type: 'text' as const, text }] };
      } catch (error) {
        return errorResponse(error);
      }
    },
  );

  // ── ga4_get_property ──────────────────────────────────────────────────
  server.tool(
    'ga4_get_property',
    'Get detailed information for a specific GA4 property',
    {
      property_id: z.string().describe('GA4 property ID (e.g., "123456" or "properties/123456")'),
    },
    async ({ property_id }) => {
      try {
        const property = await ga4.getProperty(property_id);

        const lines = [
          `| Field | Value |`,
          `| --- | --- |`,
          `| **Name** | ${property.displayName} |`,
          `| **ID** | ${property.name} |`,
          `| **Type** | ${property.propertyType} |`,
          `| **Timezone** | ${property.timeZone} |`,
          `| **Currency** | ${property.currencyCode} |`,
          `| **Created** | ${property.createTime} |`,
          `| **Updated** | ${property.updateTime} |`,
        ];
        if (property.industryCategory) {
          lines.push(`| **Industry** | ${property.industryCategory} |`);
        }
        if (property.parent) {
          lines.push(`| **Parent** | ${property.parent} |`);
        }

        const data = lines.join('\n');
        const summary = `Property ${property.displayName} (${property.name}) is a ${property.propertyType} in timezone ${property.timeZone}.`;

        const text = formatToolResponse(createToolResponse(data, summary, [], []));
        return { content: [{ type: 'text' as const, text }] };
      } catch (error) {
        return errorResponse(error);
      }
    },
  );

  // ── ga4_create_property ───────────────────────────────────────────────
  server.tool(
    'ga4_create_property',
    'Create a new GA4 property under an account',
    {
      account_id: z.string().describe('GA4 account ID (e.g., "123456" or "accounts/123456")'),
      display_name: z.string().describe('Display name for the new property'),
      timezone: z.string().describe('Reporting timezone (e.g., "America/New_York", "Europe/Moscow")'),
      currency_code: z.string().optional().default('USD').describe('Currency code (e.g., "USD", "EUR")'),
      industry_category: z.string().optional().describe('Industry category (e.g., "TECHNOLOGY", "FINANCE")'),
    },
    async ({ account_id, display_name, timezone, currency_code, industry_category }) => {
      try {
        const property = await ga4.createProperty({
          accountId: account_id,
          displayName: display_name,
          timeZone: timezone,
          currencyCode: currency_code,
          industryCategory: industry_category,
        });

        const data = [
          `Property **${property.displayName}** has been created.`,
          '',
          `| Field | Value |`,
          `| --- | --- |`,
          `| **ID** | ${property.name} |`,
          `| **Type** | ${property.propertyType} |`,
          `| **Timezone** | ${property.timeZone} |`,
          `| **Currency** | ${property.currencyCode} |`,
          `| **Created** | ${property.createTime} |`,
        ].join('\n');

        const summary = `Successfully created GA4 property "${property.displayName}" (${property.name}).`;

        const recommendations = [
          'Create a data stream next with ga4_create_data_stream to start collecting data.',
          'Install the GA4 measurement tag on your website using the measurement ID from the data stream.',
        ];

        const limitations = [
          'It may take up to 24 hours before data starts appearing in reports.',
        ];

        const text = formatToolResponse(createToolResponse(data, summary, recommendations, limitations));
        return { content: [{ type: 'text' as const, text }] };
      } catch (error) {
        return errorResponse(error);
      }
    },
  );

  // ── ga4_create_data_stream ────────────────────────────────────────────
  server.tool(
    'ga4_create_data_stream',
    'Create a web data stream for a GA4 property and get the measurement ID',
    {
      property_id: z.string().describe('GA4 property ID (e.g., "123456" or "properties/123456")'),
      url: z.string().describe('Website URL for the data stream (e.g., "https://example.com")'),
      stream_name: z.string().optional().describe('Display name for the stream (defaults to hostname)'),
    },
    async ({ property_id, url, stream_name }) => {
      try {
        const stream = await ga4.createDataStream(property_id, url, stream_name);

        const measurementId = stream.webStreamData?.measurementId ?? 'N/A';
        const defaultUri = stream.webStreamData?.defaultUri ?? url;

        const data = [
          `Data stream created successfully.`,
          '',
          `**Measurement ID: ${measurementId}**`,
          '',
          `| Field | Value |`,
          `| --- | --- |`,
          `| **Stream name** | ${stream.displayName} |`,
          `| **Stream ID** | ${stream.name} |`,
          `| **Type** | ${stream.type} |`,
          `| **Measurement ID** | ${measurementId} |`,
          `| **Default URI** | ${defaultUri} |`,
          `| **Created** | ${stream.createTime} |`,
        ].join('\n');

        const summary = `Created web data stream "${stream.displayName}" with measurement ID **${measurementId}**.`;

        const recommendations = [
          `Add the GA4 tag to your website using measurement ID: ${measurementId}`,
          'For Google Tag Manager: create a GA4 Configuration tag with this measurement ID.',
          `For manual installation: add the gtag.js snippet with ID "${measurementId}" to your site's <head>.`,
        ];

        const limitations = [
          'Data collection begins only after the measurement tag is installed on the website.',
          'It may take 24-48 hours for data to appear in GA4 reports.',
        ];

        const text = formatToolResponse(createToolResponse(data, summary, recommendations, limitations));
        return { content: [{ type: 'text' as const, text }] };
      } catch (error) {
        return errorResponse(error);
      }
    },
  );

  // ── ga4_list_data_streams ─────────────────────────────────────────────
  server.tool(
    'ga4_list_data_streams',
    'List all data streams for a GA4 property',
    {
      property_id: z.string().describe('GA4 property ID (e.g., "123456" or "properties/123456")'),
    },
    async ({ property_id }) => {
      try {
        const streams = await ga4.listDataStreams(property_id);

        const rows = streams.map((s) => {
          const measurementId = s.webStreamData?.measurementId ?? 'N/A';
          const defaultUri = s.webStreamData?.defaultUri ?? '';
          return [
            `- **${s.displayName}** (${s.type})`,
            `  - Stream ID: ${s.name}`,
            `  - Measurement ID: ${measurementId}`,
            defaultUri ? `  - URI: ${defaultUri}` : '',
            `  - Created: ${s.createTime}`,
          ].filter(Boolean).join('\n');
        });

        const data = rows.length > 0 ? rows.join('\n') : '_No data streams found._';
        const summary = `Found ${streams.length} data stream${streams.length === 1 ? '' : 's'} for property ${property_id}.`;

        const recommendations: string[] = [];
        if (streams.length === 0) {
          recommendations.push('No data streams found. Use ga4_create_data_stream to create one.');
        }

        const limitations = [
          'Only web data streams show measurement IDs.',
        ];

        const text = formatToolResponse(createToolResponse(data, summary, recommendations, limitations));
        return { content: [{ type: 'text' as const, text }] };
      } catch (error) {
        return errorResponse(error);
      }
    },
  );

  // ── ga4_get_data_stream ───────────────────────────────────────────────
  server.tool(
    'ga4_get_data_stream',
    'Get detailed information for a specific data stream',
    {
      property_id: z.string().describe('GA4 property ID (e.g., "123456" or "properties/123456")'),
      stream_id: z.string().describe('Data stream ID (numeric, e.g., "789012")'),
    },
    async ({ property_id, stream_id }) => {
      try {
        const stream = await ga4.getDataStream(property_id, stream_id);

        const measurementId = stream.webStreamData?.measurementId ?? 'N/A';
        const defaultUri = stream.webStreamData?.defaultUri ?? '';

        const lines = [
          `| Field | Value |`,
          `| --- | --- |`,
          `| **Name** | ${stream.displayName} |`,
          `| **Stream ID** | ${stream.name} |`,
          `| **Type** | ${stream.type} |`,
          `| **Measurement ID** | ${measurementId} |`,
        ];
        if (defaultUri) {
          lines.push(`| **Default URI** | ${defaultUri} |`);
        }
        lines.push(
          `| **Created** | ${stream.createTime} |`,
          `| **Updated** | ${stream.updateTime} |`,
        );

        const data = lines.join('\n');
        const summary = `Data stream "${stream.displayName}" (${stream.type}) with measurement ID ${measurementId}.`;

        const text = formatToolResponse(createToolResponse(data, summary, [], []));
        return { content: [{ type: 'text' as const, text }] };
      } catch (error) {
        return errorResponse(error);
      }
    },
  );
}
