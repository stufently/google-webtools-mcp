import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { Ga4ApiClient } from '../../api/ga4-client.js';
import { createToolResponse, formatToolResponse } from '../schemas.js';
import { GscError } from '../../errors/gsc-error.js';
import type { Ga4ReportResponse } from '../../api/ga4-types.js';

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

/**
 * Format a GA4 report response as a markdown table.
 */
function formatReportAsTable(report: Ga4ReportResponse): string {
  if (!report.rows || report.rows.length === 0) {
    return '_No data available for the specified parameters._';
  }

  const dimHeaders = (report.dimensionHeaders ?? []).map(h => h.name);
  const metHeaders = (report.metricHeaders ?? []).map(h => h.name);
  const allHeaders = [...dimHeaders, ...metHeaders];

  // Header row
  const headerRow = `| ${allHeaders.join(' | ')} |`;
  const separatorRow = `| ${allHeaders.map(() => '---').join(' | ')} |`;

  // Data rows
  const dataRows = report.rows.map((row) => {
    const dimValues = (row.dimensionValues ?? []).map(v => v.value);
    const metValues = (row.metricValues ?? []).map(v => v.value);
    return `| ${[...dimValues, ...metValues].join(' | ')} |`;
  });

  return [headerRow, separatorRow, ...dataRows].join('\n');
}

export function registerGa4ReportingTools(server: McpServer, ga4: Ga4ApiClient): void {
  // ── ga4_run_report ────────────────────────────────────────────────────
  server.tool(
    'ga4_run_report',
    'Run a GA4 analytics report with specified metrics, dimensions, and date range',
    {
      property_id: z.string().describe('GA4 property ID (e.g., "123456" or "properties/123456")'),
      start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Start date in YYYY-MM-DD format (or relative: "7daysAgo", "30daysAgo", "yesterday", "today")'),
      end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('End date in YYYY-MM-DD format (or relative: "yesterday", "today")'),
      metrics: z.array(z.string()).min(1).describe('Metrics to retrieve (e.g., ["activeUsers", "sessions", "screenPageViews"])'),
      dimensions: z.array(z.string()).optional().describe('Dimensions to group by (e.g., ["date", "country", "pagePath"])'),
      limit: z.number().min(1).max(100000).optional().default(100).describe('Maximum rows to return (1-100000, default 100)'),
    },
    async ({ property_id, start_date, end_date, metrics, dimensions, limit }) => {
      try {
        const report = await ga4.runReport({
          propertyId: property_id,
          startDate: start_date,
          endDate: end_date,
          metrics,
          dimensions,
          limit,
        });

        const table = formatReportAsTable(report);
        const rowCount = report.rowCount ?? report.rows?.length ?? 0;

        const summary = `Report returned ${rowCount} row${rowCount === 1 ? '' : 's'} for property ${property_id} (${start_date} to ${end_date}). Metrics: ${metrics.join(', ')}${dimensions ? '. Dimensions: ' + dimensions.join(', ') : ''}.`;

        const recommendations: string[] = [];
        if (rowCount === 0) {
          recommendations.push('No data found. Check that the property is receiving data and the date range is correct.');
          recommendations.push('Use ga4_get_metadata to see available metrics and dimensions.');
        }
        if (limit && rowCount >= limit) {
          recommendations.push(`Results may be truncated at ${limit} rows. Increase the limit parameter to get more data.`);
        }

        const limitations = [
          'Data may be subject to sampling for large date ranges.',
          'Some metrics may not be compatible with certain dimensions.',
        ];

        const text = formatToolResponse(createToolResponse(table, summary, recommendations, limitations));
        return { content: [{ type: 'text' as const, text }] };
      } catch (error) {
        return errorResponse(error);
      }
    },
  );

  // ── ga4_run_realtime_report ───────────────────────────────────────────
  server.tool(
    'ga4_run_realtime_report',
    'Run a GA4 realtime report showing current active users and activity',
    {
      property_id: z.string().describe('GA4 property ID (e.g., "123456" or "properties/123456")'),
      metrics: z.array(z.string()).min(1).describe('Realtime metrics (e.g., ["activeUsers", "screenPageViews", "conversions"])'),
      dimensions: z.array(z.string()).optional().describe('Realtime dimensions (e.g., ["country", "city", "unifiedScreenName"])'),
    },
    async ({ property_id, metrics, dimensions }) => {
      try {
        const report = await ga4.runRealtimeReport(property_id, metrics, dimensions);

        const table = formatReportAsTable(report);
        const rowCount = report.rowCount ?? report.rows?.length ?? 0;

        const summary = `Realtime report returned ${rowCount} row${rowCount === 1 ? '' : 's'} for property ${property_id}. Metrics: ${metrics.join(', ')}${dimensions ? '. Dimensions: ' + dimensions.join(', ') : ''}.`;

        const recommendations: string[] = [];
        if (rowCount === 0) {
          recommendations.push('No realtime data found. This means there are currently no active users on the property.');
        }

        const limitations = [
          'Realtime data reflects activity from the last 30 minutes.',
          'Not all dimensions and metrics available in standard reports are available in realtime.',
        ];

        const text = formatToolResponse(createToolResponse(table, summary, recommendations, limitations));
        return { content: [{ type: 'text' as const, text }] };
      } catch (error) {
        return errorResponse(error);
      }
    },
  );

  // ── ga4_get_metadata ──────────────────────────────────────────────────
  server.tool(
    'ga4_get_metadata',
    'List all available GA4 dimensions and metrics for a property (including custom definitions)',
    {
      property_id: z.string().describe('GA4 property ID (e.g., "123456" or "properties/123456")'),
    },
    async ({ property_id }) => {
      try {
        const items = await ga4.getMetadata(property_id);

        // Group by category
        const grouped: Record<string, typeof items> = {};
        for (const item of items) {
          const cat = item.category || 'Other';
          if (!grouped[cat]) grouped[cat] = [];
          grouped[cat].push(item);
        }

        const sections = Object.entries(grouped)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([category, categoryItems]) => {
            const customItems = categoryItems.filter(i => i.customDefinition);
            const standardItems = categoryItems.filter(i => !i.customDefinition);

            const itemLines = standardItems.map(
              i => `- **${i.apiName}** — ${i.uiName}: ${i.description}`,
            );
            if (customItems.length > 0) {
              itemLines.push('', '_Custom definitions:_');
              for (const ci of customItems) {
                itemLines.push(`- **${ci.apiName}** — ${ci.uiName}: ${ci.description}`);
              }
            }
            return `### ${category}\n${itemLines.join('\n')}`;
          });

        const customCount = items.filter(i => i.customDefinition).length;
        const standardCount = items.length - customCount;

        const data = sections.join('\n\n');
        const summary = `Found ${items.length} available dimensions and metrics (${standardCount} standard, ${customCount} custom) across ${Object.keys(grouped).length} categories.`;

        const limitations = [
          'Not all dimensions and metrics are compatible with each other in a single report.',
          'Realtime reports support a subset of these dimensions and metrics.',
        ];

        const text = formatToolResponse(createToolResponse(data, summary, [], limitations));
        return { content: [{ type: 'text' as const, text }] };
      } catch (error) {
        return errorResponse(error);
      }
    },
  );
}
