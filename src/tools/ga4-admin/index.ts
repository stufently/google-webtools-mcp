import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { readOnly, createOnce } from '../annotations.js';
import { z } from 'zod';
import { Ga4ApiClient } from '../../api/ga4-client.js';
import { createToolResponse, formatToolResponse } from '../schemas.js';
import { formatErrorForMcp } from '../../errors/error-handler.js';

export function registerGa4AdminTools(server: McpServer, ga4: Ga4ApiClient): void {
  // ── ga4_list_accounts ─────────────────────────────────────────────────
  server.tool(
    'ga4_list_accounts',
    'List every Google Analytics 4 account the credentials can reach, and the properties under each account. Use when the user does not yet know the account or property id. Call ga4_list_properties when they already named an account, and call ga4_get_property for one property settings.',
    {},
    readOnly,
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
        return formatErrorForMcp(error);
      }
    },
  );

  // ── ga4_list_properties ───────────────────────────────────────────────
  server.tool(
    'ga4_list_properties',
    'List Google Analytics 4 properties under one account, including timezone, currency, and when each property was created. Use when the user names an account and wants its properties. Call ga4_list_accounts when the account id is unknown, and call ga4_get_property to open one property.',
    {
      account_id: z.string().describe('GA4 account ID (e.g., "123456" or "accounts/123456")'),
    },
    readOnly,
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
        return formatErrorForMcp(error);
      }
    },
  );

  // ── ga4_get_property ──────────────────────────────────────────────────
  server.tool(
    'ga4_get_property',
    'Read one Google Analytics 4 property display name, timezone, currency, industry, and parent account. Use when the user asks how a known property is configured. Call ga4_list_properties to find the id first, and call ga4_list_data_streams for the streams on that property.',
    {
      property_id: z.string().describe('GA4 property ID (e.g., "123456" or "properties/123456")'),
    },
    readOnly,
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
        return formatErrorForMcp(error);
      }
    },
  );

  // ── ga4_create_property ───────────────────────────────────────────────
  server.tool(
    'ga4_create_property',
    'Create a new Google Analytics 4 property under an account, with a display name, timezone, and currency. Use when the user asks to provision a GA4 property. This server cannot remove the property afterwards. Call ga4_list_properties to see properties that already exist, and call ga4_create_data_stream next when they need a measurement id.',
    {
      account_id: z.string().describe('GA4 account ID (e.g., "123456" or "accounts/123456")'),
      display_name: z.string().describe('Display name for the new property'),
      timezone: z.string().describe('Reporting timezone (e.g., "America/New_York", "Europe/Moscow")'),
      currency_code: z.string().optional().default('USD').describe('Currency code (e.g., "USD", "EUR")'),
      industry_category: z.string().optional().describe('Industry category (e.g., "TECHNOLOGY", "FINANCE")'),
    },
    createOnce,
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
        return formatErrorForMcp(error);
      }
    },
  );

  // ── ga4_create_data_stream ────────────────────────────────────────────
  server.tool(
    'ga4_create_data_stream',
    'Create a web data stream on a Google Analytics 4 property and return its measurement id for the tag. Use when the user needs a measurement id to install analytics on a site. This server cannot delete the stream afterwards. Call ga4_list_data_streams if a stream may already exist, and call ga4_create_property first when the property itself does not exist yet.',
    {
      property_id: z.string().describe('GA4 property ID (e.g., "123456" or "properties/123456")'),
      url: z.string().describe('Website URL for the data stream (e.g., "https://example.com")'),
      stream_name: z.string().optional().describe('Display name for the stream (defaults to hostname)'),
    },
    createOnce,
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
        return formatErrorForMcp(error);
      }
    },
  );

  // ── ga4_list_data_streams ─────────────────────────────────────────────
  server.tool(
    'ga4_list_data_streams',
    'List the data streams on a Google Analytics 4 property, including each web stream measurement id and default URI. Use when the user asks which streams or measurement ids a property already has. Call ga4_get_data_stream for one stream, and call ga4_create_data_stream only when they want a new stream.',
    {
      property_id: z.string().describe('GA4 property ID (e.g., "123456" or "properties/123456")'),
    },
    readOnly,
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
        return formatErrorForMcp(error);
      }
    },
  );

  // ── ga4_get_data_stream ───────────────────────────────────────────────
  server.tool(
    'ga4_get_data_stream',
    'Read one Google Analytics 4 data stream, including its measurement id, default URI, and created and updated times. Use when the user names a stream and wants its measurement id or settings. Call ga4_list_data_streams when the stream id is not known yet.',
    {
      property_id: z.string().describe('GA4 property ID (e.g., "123456" or "properties/123456")'),
      stream_id: z.string().describe('Data stream ID (numeric, e.g., "789012")'),
    },
    readOnly,
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
        return formatErrorForMcp(error);
      }
    },
  );
}
