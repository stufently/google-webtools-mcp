import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { GscApiClient } from '../../api/client.js';
import {
  siteUrlSchema,
  periodSchema,
  searchTypeSchema,
  deviceSchema,
  dimensionSchema,
  filterOperatorSchema,
  dimensionFilterSchema,
  dataStateSchema,
  rowLimitSchema,
  aggregationTypeSchema,
  dateRangeSchema,
  createToolResponse,
  formatToolResponse,
} from '../schemas.js';
import { getDateRange, getPreviousPeriod } from '../../utils/date-helpers.js';
import {
  formatNumber,
  formatPercent,
  formatPosition,
  formatChange,
} from '../../utils/formatting.js';
import { getExpectedCtr, analyzeCtr } from '../../analysis/ctr-benchmarks.js';
import type {
  SearchAnalyticsRequest,
  SearchAnalyticsRow,
  DimensionFilter,
  DimensionFilterGroup,
} from '../../api/types.js';
import { GscError } from '../../errors/gsc-error.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
 * Compute the percentage change between two numbers.
 * Returns null when the previous value is 0 to avoid division by zero.
 */
function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/**
 * Get a human-friendly label for a CTR performance rating.
 */
function performanceEmoji(perf: string): string {
  switch (perf) {
    case 'excellent': return '[Excellent]';
    case 'good': return '[Good]';
    case 'average': return '[Average]';
    case 'below_average': return '[Below Avg]';
    case 'poor': return '[Poor]';
    default: return '';
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerPerformanceTools(server: McpServer, api: GscApiClient): void {

  // ========================================================================
  // Tool 1: get_search_analytics
  // ========================================================================
  server.tool(
    'get_search_analytics',
    'Query raw Google Search Console search analytics data with flexible parameters',
    {
      siteUrl: siteUrlSchema,
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Start date in YYYY-MM-DD format'),
      endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('End date in YYYY-MM-DD format'),
      dimensions: z.array(dimensionSchema).optional().describe('Dimensions to group by (e.g. query, page, date, country, device, searchAppearance)'),
      searchType: searchTypeSchema.optional().default('web'),
      filters: z.array(dimensionFilterSchema).optional().describe('Dimension filters to apply'),
      rowLimit: rowLimitSchema.optional().default(1000),
      dataState: dataStateSchema.optional().default('all'),
      aggregationType: aggregationTypeSchema.optional().default('auto'),
    },
    async (params) => {
      try {
        const dimensionFilterGroups: DimensionFilterGroup[] | undefined =
          params.filters && params.filters.length > 0
            ? [{ groupType: 'and' as const, filters: params.filters }]
            : undefined;

        const request: SearchAnalyticsRequest = {
          siteUrl: params.siteUrl,
          startDate: params.startDate,
          endDate: params.endDate,
          dimensions: params.dimensions,
          searchType: params.searchType,
          dimensionFilterGroups,
          rowLimit: params.rowLimit,
          dataState: params.dataState,
          aggregationType: params.aggregationType,
        };

        const response = await api.querySearchAnalytics(request);
        const rows = response.rows;

        if (rows.length === 0) {
          const text = formatToolResponse(createToolResponse(
            '_No data found for the specified parameters._',
            'No search analytics data returned for this query.',
            ['Try broadening your date range or removing filters.'],
            ['Data may not be available for very recent dates (last 1-2 days).'],
          ));
          return { content: [{ type: 'text' as const, text }] };
        }

        // Determine if CTR benchmark analysis should be added
        const dims = params.dimensions ?? [];
        const hasCtrRelevantDim = dims.includes('query') || dims.includes('page');

        // Build markdown table
        const headerCols = [...dims.map(d => d.charAt(0).toUpperCase() + d.slice(1)), 'Clicks', 'Impressions', 'CTR', 'Position'];
        if (hasCtrRelevantDim) {
          headerCols.push('Expected CTR', 'CTR Performance');
        }

        const tableHeader = `| ${headerCols.join(' | ')} |`;
        const tableSep = `| ${headerCols.map(() => '---').join(' | ')} |`;

        const tableRows = rows.map((row) => {
          const keyCols = row.keys.map(k => k);
          const metricCols = [
            formatNumber(row.clicks),
            formatNumber(row.impressions),
            formatPercent(row.ctr),
            formatPosition(row.position),
          ];

          if (hasCtrRelevantDim) {
            const analysis = analyzeCtr(row.position, row.ctr);
            metricCols.push(formatPercent(analysis.expectedCtr));
            metricCols.push(performanceEmoji(analysis.performance));
          }

          return `| ${[...keyCols, ...metricCols].join(' | ')} |`;
        });

        const table = [tableHeader, tableSep, ...tableRows].join('\n');

        // Totals
        const totalClicks = rows.reduce((s, r) => s + r.clicks, 0);
        const totalImpressions = rows.reduce((s, r) => s + r.impressions, 0);

        const summary = `Returned ${formatNumber(rows.length)} row(s) for ${params.siteUrl} from ${params.startDate} to ${params.endDate}. Total: ${formatNumber(totalClicks)} clicks, ${formatNumber(totalImpressions)} impressions.`;

        const recommendations: string[] = [];
        if (rows.length === params.rowLimit) {
          recommendations.push(`Results capped at ${formatNumber(params.rowLimit)} rows. Increase rowLimit to retrieve more data.`);
        }

        const limitations = [
          'GSC data may be delayed by 2-3 days.',
          'Position and CTR are averages and may not reflect individual query performance.',
        ];

        const text = formatToolResponse(createToolResponse(table, summary, recommendations, limitations));
        return { content: [{ type: 'text' as const, text }] };
      } catch (error) {
        return errorResponse(error);
      }
    },
  );

  // ========================================================================
  // Tool 2: get_performance_summary
  // ========================================================================
  server.tool(
    'get_performance_summary',
    'Get a high-level performance overview with period-over-period comparison',
    {
      siteUrl: siteUrlSchema,
      period: periodSchema.optional().default('last28d'),
      searchType: searchTypeSchema.optional().default('web'),
    },
    async (params) => {
      try {
        const currentRange = getDateRange(params.period);
        const previousRange = getPreviousPeriod(currentRange.startDate, currentRange.endDate);

        // Fetch both periods in parallel (no dimensions = totals only)
        const [currentResponse, previousResponse] = await Promise.all([
          api.querySearchAnalytics({
            siteUrl: params.siteUrl,
            startDate: currentRange.startDate,
            endDate: currentRange.endDate,
            searchType: params.searchType,
            dataState: 'all',
          }),
          api.querySearchAnalytics({
            siteUrl: params.siteUrl,
            startDate: previousRange.startDate,
            endDate: previousRange.endDate,
            searchType: params.searchType,
            dataState: 'all',
          }),
        ]);

        const current = currentResponse.rows[0] ?? { clicks: 0, impressions: 0, ctr: 0, position: 0, keys: [] };
        const previous = previousResponse.rows[0] ?? { clicks: 0, impressions: 0, ctr: 0, position: 0, keys: [] };

        // Build comparison table
        const table = [
          '| Metric | Current Period | Previous Period | Change |',
          '| --- | ---: | ---: | ---: |',
          `| **Clicks** | ${formatNumber(current.clicks)} | ${formatNumber(previous.clicks)} | ${formatChange(current.clicks, previous.clicks)} |`,
          `| **Impressions** | ${formatNumber(current.impressions)} | ${formatNumber(previous.impressions)} | ${formatChange(current.impressions, previous.impressions)} |`,
          `| **CTR** | ${formatPercent(current.ctr)} | ${formatPercent(previous.ctr)} | ${formatChange(current.ctr, previous.ctr)} |`,
          `| **Avg Position** | ${formatPosition(current.position)} | ${formatPosition(previous.position)} | ${formatChange(current.position, previous.position)} |`,
          '',
          `*Current period: ${currentRange.startDate} to ${currentRange.endDate}*`,
          `*Previous period: ${previousRange.startDate} to ${previousRange.endDate}*`,
        ].join('\n');

        // Auto-generated summary
        const clicksDirection = current.clicks >= previous.clicks ? 'up' : 'down';
        const clicksChange = formatChange(current.clicks, previous.clicks);
        const impressionsDirection = current.impressions >= previous.impressions ? 'up' : 'down';
        const impressionsChange = formatChange(current.impressions, previous.impressions);

        const summary = [
          `Your site received ${formatNumber(current.clicks)} clicks from ${formatNumber(current.impressions)} impressions over the ${params.period} period.`,
          `Compared to the previous period, clicks are ${clicksDirection} ${clicksChange} and impressions are ${impressionsDirection} ${impressionsChange}.`,
          `Average CTR is ${formatPercent(current.ctr)} and average position is ${formatPosition(current.position)}.`,
        ].join(' ');

        // Recommendations based on data
        const recommendations: string[] = [];

        const clicksPctChange = pctChange(current.clicks, previous.clicks);
        const impressionsPctChange = pctChange(current.impressions, previous.impressions);
        const positionChange = current.position - previous.position;

        if (clicksPctChange !== null && clicksPctChange < -10) {
          recommendations.push('Clicks have dropped significantly. Investigate whether rankings have changed or if there are indexing issues.');
        }
        if (impressionsPctChange !== null && impressionsPctChange > 10 && clicksPctChange !== null && clicksPctChange < 5) {
          recommendations.push('Impressions are growing but clicks are not keeping pace. Consider improving title tags and meta descriptions to boost CTR.');
        }
        if (positionChange > 2) {
          recommendations.push('Average position has worsened. Review content freshness and backlink profile for your key pages.');
        }
        if (current.ctr < 0.02) {
          recommendations.push('CTR is below 2%. Focus on improving title tags, meta descriptions, and structured data to stand out in search results.');
        }
        if (clicksPctChange !== null && clicksPctChange > 10) {
          recommendations.push('Great progress! Clicks are trending upward. Continue optimizing top-performing queries and pages.');
        }

        const limitations = [
          'Totals are aggregated across all queries and pages.',
          'GSC data may be delayed by 2-3 days; recent data may still update.',
          'Position is an average and can be skewed by low-impression queries.',
        ];

        const text = formatToolResponse(createToolResponse(table, summary, recommendations, limitations));
        return { content: [{ type: 'text' as const, text }] };
      } catch (error) {
        return errorResponse(error);
      }
    },
  );

  // ========================================================================
  // Tool 3: compare_periods
  // ========================================================================
  server.tool(
    'compare_periods',
    'Compare search performance between two custom date periods side by side',
    {
      siteUrl: siteUrlSchema,
      period1StartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Period 1 start date (YYYY-MM-DD)'),
      period1EndDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Period 1 end date (YYYY-MM-DD)'),
      period2StartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Period 2 start date (YYYY-MM-DD)'),
      period2EndDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Period 2 end date (YYYY-MM-DD)'),
      dimensions: z.array(dimensionSchema).optional().describe('Dimensions to group by'),
      searchType: searchTypeSchema.optional().default('web'),
    },
    async (params) => {
      try {
        const baseRequest = {
          siteUrl: params.siteUrl,
          searchType: params.searchType,
          dimensions: params.dimensions,
          dataState: 'all' as const,
        };

        const [response1, response2] = await Promise.all([
          api.querySearchAnalytics({
            ...baseRequest,
            startDate: params.period1StartDate,
            endDate: params.period1EndDate,
          }),
          api.querySearchAnalytics({
            ...baseRequest,
            startDate: params.period2StartDate,
            endDate: params.period2EndDate,
          }),
        ]);

        const dims = params.dimensions ?? [];

        if (dims.length === 0) {
          // Aggregate comparison (no dimensions)
          const r1 = response1.rows[0] ?? { clicks: 0, impressions: 0, ctr: 0, position: 0, keys: [] };
          const r2 = response2.rows[0] ?? { clicks: 0, impressions: 0, ctr: 0, position: 0, keys: [] };

          const table = [
            '| Metric | Period 1 | Period 2 | Change |',
            '| --- | ---: | ---: | ---: |',
            `| **Clicks** | ${formatNumber(r1.clicks)} | ${formatNumber(r2.clicks)} | ${formatChange(r2.clicks, r1.clicks)} |`,
            `| **Impressions** | ${formatNumber(r1.impressions)} | ${formatNumber(r2.impressions)} | ${formatChange(r2.impressions, r1.impressions)} |`,
            `| **CTR** | ${formatPercent(r1.ctr)} | ${formatPercent(r2.ctr)} | ${formatChange(r2.ctr, r1.ctr)} |`,
            `| **Avg Position** | ${formatPosition(r1.position)} | ${formatPosition(r2.position)} | ${formatChange(r2.position, r1.position)} |`,
            '',
            `*Period 1: ${params.period1StartDate} to ${params.period1EndDate}*`,
            `*Period 2: ${params.period2StartDate} to ${params.period2EndDate}*`,
          ].join('\n');

          const summary = `Comparison of ${params.siteUrl} between two periods. Period 2 clicks changed by ${formatChange(r2.clicks, r1.clicks)} relative to Period 1.`;

          const text = formatToolResponse(createToolResponse(table, summary, [], [
            'GSC data may be delayed by 2-3 days.',
            'Periods of different lengths may produce misleading comparisons.',
          ]));
          return { content: [{ type: 'text' as const, text }] };
        }

        // Dimension-level comparison: build a lookup map for period 1
        const p1Map = new Map<string, SearchAnalyticsRow>();
        for (const row of response1.rows) {
          p1Map.set(row.keys.join('||'), row);
        }

        const p2Map = new Map<string, SearchAnalyticsRow>();
        for (const row of response2.rows) {
          p2Map.set(row.keys.join('||'), row);
        }

        // Merge all keys
        const allKeys = new Set([...p1Map.keys(), ...p2Map.keys()]);
        const emptyRow: SearchAnalyticsRow = { keys: [], clicks: 0, impressions: 0, ctr: 0, position: 0 };

        // Build comparison rows and sort by absolute click change
        const comparisonRows = Array.from(allKeys).map((key) => {
          const r1 = p1Map.get(key) ?? emptyRow;
          const r2 = p2Map.get(key) ?? emptyRow;
          const clickChange = r2.clicks - r1.clicks;
          const clickChangePct = pctChange(r2.clicks, r1.clicks);
          return { key, r1, r2, clickChange, clickChangePct };
        });

        comparisonRows.sort((a, b) => Math.abs(b.clickChange) - Math.abs(a.clickChange));

        // Build table
        const dimHeaders = dims.map(d => d.charAt(0).toUpperCase() + d.slice(1));
        const headerCols = [...dimHeaders, 'P1 Clicks', 'P2 Clicks', 'Click Change', 'P1 CTR', 'P2 CTR'];
        const tableHeader = `| ${headerCols.join(' | ')} |`;
        const tableSep = `| ${headerCols.map(() => '---').join(' | ')} |`;

        const significantChanges: string[] = [];

        const tableRows = comparisonRows.slice(0, 50).map((c) => {
          const keyParts = c.key.split('||');
          const changePctStr = c.clickChangePct !== null ? `${c.clickChangePct >= 0 ? '+' : ''}${c.clickChangePct.toFixed(1)}%` : 'N/A';
          const changeStr = `${c.clickChange >= 0 ? '+' : ''}${formatNumber(c.clickChange)} (${changePctStr})`;

          // Track significant changes
          if (c.clickChangePct !== null && Math.abs(c.clickChangePct) > 10 && Math.abs(c.clickChange) > 5) {
            const direction = c.clickChange > 0 ? 'gained' : 'lost';
            significantChanges.push(`"${keyParts[0]}" ${direction} ${Math.abs(c.clickChange)} clicks (${changePctStr})`);
          }

          return `| ${[...keyParts, formatNumber(c.r1.clicks), formatNumber(c.r2.clicks), changeStr, formatPercent(c.r1.ctr), formatPercent(c.r2.ctr)].join(' | ')} |`;
        });

        let table = [tableHeader, tableSep, ...tableRows].join('\n');

        table += `\n\n*Period 1: ${params.period1StartDate} to ${params.period1EndDate}*`;
        table += `\n*Period 2: ${params.period2StartDate} to ${params.period2EndDate}*`;

        if (significantChanges.length > 0) {
          table += '\n\n### Significant Changes (>10%)\n' + significantChanges.slice(0, 10).map(c => `- ${c}`).join('\n');
        }

        const summary = `Compared ${formatNumber(allKeys.size)} items between two periods. Found ${significantChanges.length} significant change(s).`;

        const recommendations: string[] = [];
        if (significantChanges.length > 5) {
          recommendations.push('Multiple queries/pages show significant changes. Investigate whether algorithm updates, content changes, or seasonal trends are factors.');
        }

        const text = formatToolResponse(createToolResponse(table, summary, recommendations, [
          'GSC data may be delayed by 2-3 days.',
          'Periods of different lengths may produce misleading comparisons.',
          'Results capped at 50 rows sorted by absolute click change.',
        ]));
        return { content: [{ type: 'text' as const, text }] };
      } catch (error) {
        return errorResponse(error);
      }
    },
  );

  // ========================================================================
  // Tool 4: get_top_queries
  // ========================================================================
  server.tool(
    'get_top_queries',
    'Get top search queries by clicks with CTR benchmark analysis',
    {
      siteUrl: siteUrlSchema,
      period: periodSchema.optional().default('last28d'),
      searchType: searchTypeSchema.optional().default('web'),
      device: deviceSchema.optional().describe('Filter by device type'),
      page: z.string().optional().describe('Filter to a specific page URL (contains match)'),
      country: z.string().optional().describe('Filter by country code (e.g. "USA", "GBR")'),
      limit: z.number().min(1).max(25000).optional().default(20).describe('Number of top queries to return'),
    },
    async (params) => {
      try {
        const dateRange = getDateRange(params.period);

        // Build dimension filters
        const filters: DimensionFilter[] = [];
        if (params.device) filters.push({ dimension: 'device', operator: 'equals', expression: params.device });
        if (params.page) filters.push({ dimension: 'page', operator: 'contains', expression: params.page });
        if (params.country) filters.push({ dimension: 'country', operator: 'equals', expression: params.country });
        const dimensionFilterGroups = filters.length > 0 ? [{ groupType: 'and' as const, filters }] : undefined;

        // Also fetch totals for percentage calculation
        const [queryResponse, totalsResponse] = await Promise.all([
          api.querySearchAnalytics({
            siteUrl: params.siteUrl,
            startDate: dateRange.startDate,
            endDate: dateRange.endDate,
            dimensions: ['query'],
            searchType: params.searchType,
            dimensionFilterGroups,
            rowLimit: params.limit,
            dataState: 'all',
          }),
          api.querySearchAnalytics({
            siteUrl: params.siteUrl,
            startDate: dateRange.startDate,
            endDate: dateRange.endDate,
            searchType: params.searchType,
            dimensionFilterGroups,
            dataState: 'all',
          }),
        ]);

        const rows = queryResponse.rows;
        const totalClicks = totalsResponse.rows[0]?.clicks ?? 0;

        if (rows.length === 0) {
          const text = formatToolResponse(createToolResponse(
            '_No query data found for the specified parameters._',
            'No queries returned.',
            ['Try broadening your date range or removing filters.'],
            [],
          ));
          return { content: [{ type: 'text' as const, text }] };
        }

        // Build table with CTR benchmarks
        const tableHeader = '| # | Query | Clicks | Impressions | CTR | Position | Expected CTR | Performance |';
        const tableSep = '| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |';

        const poorCtrQueries: string[] = [];
        const topClicksSum = rows.reduce((s, r) => s + r.clicks, 0);

        const tableRows = rows.map((row, i) => {
          const query = row.keys[0] ?? '';
          const analysis = analyzeCtr(row.position, row.ctr);

          if (analysis.performance === 'poor' || analysis.performance === 'below_average') {
            poorCtrQueries.push(`"${query}" (position ${formatPosition(row.position)}, CTR ${formatPercent(row.ctr)} vs expected ${formatPercent(analysis.expectedCtr)})`);
          }

          return `| ${i + 1} | ${query} | ${formatNumber(row.clicks)} | ${formatNumber(row.impressions)} | ${formatPercent(row.ctr)} | ${formatPosition(row.position)} | ${formatPercent(analysis.expectedCtr)} | ${performanceEmoji(analysis.performance)} |`;
        });

        const table = [tableHeader, tableSep, ...tableRows].join('\n');

        const topPct = totalClicks > 0 ? ((topClicksSum / totalClicks) * 100).toFixed(1) : '0';
        const summary = `Top ${rows.length} queries drove ${formatNumber(topClicksSum)} clicks (${topPct}% of total ${formatNumber(totalClicks)} clicks) for ${params.siteUrl} during ${params.period}.`;

        const recommendations: string[] = [];
        if (poorCtrQueries.length > 0) {
          recommendations.push('The following queries have below-average CTR and may benefit from improved title tags and meta descriptions:');
          poorCtrQueries.slice(0, 5).forEach(q => recommendations.push(`  - ${q}`));
        }
        if (rows.length > 0 && rows[0]!.position > 3) {
          recommendations.push('Your top query by clicks is not in the top 3 positions. Improving its ranking could significantly increase traffic.');
        }

        const limitations = [
          'GSC data may be delayed by 2-3 days.',
          'CTR benchmarks are industry averages and may vary by query type, SERP features, and industry.',
          'Anonymous or rare queries may be grouped or omitted by Google.',
        ];

        const text = formatToolResponse(createToolResponse(table, summary, recommendations, limitations));
        return { content: [{ type: 'text' as const, text }] };
      } catch (error) {
        return errorResponse(error);
      }
    },
  );

  // ========================================================================
  // Tool 5: get_top_pages
  // ========================================================================
  server.tool(
    'get_top_pages',
    'Get top pages by clicks with CTR analysis',
    {
      siteUrl: siteUrlSchema,
      period: periodSchema.optional().default('last28d'),
      searchType: searchTypeSchema.optional().default('web'),
      device: deviceSchema.optional().describe('Filter by device type'),
      query: z.string().optional().describe('Filter to pages matching a specific query (contains match)'),
      limit: z.number().min(1).max(25000).optional().default(20).describe('Number of top pages to return'),
    },
    async (params) => {
      try {
        const dateRange = getDateRange(params.period);

        // Build dimension filters
        const filters: DimensionFilter[] = [];
        if (params.device) filters.push({ dimension: 'device', operator: 'equals', expression: params.device });
        if (params.query) filters.push({ dimension: 'query', operator: 'contains', expression: params.query });
        const dimensionFilterGroups = filters.length > 0 ? [{ groupType: 'and' as const, filters }] : undefined;

        const [pageResponse, totalsResponse] = await Promise.all([
          api.querySearchAnalytics({
            siteUrl: params.siteUrl,
            startDate: dateRange.startDate,
            endDate: dateRange.endDate,
            dimensions: ['page'],
            searchType: params.searchType,
            dimensionFilterGroups,
            rowLimit: params.limit,
            dataState: 'all',
          }),
          api.querySearchAnalytics({
            siteUrl: params.siteUrl,
            startDate: dateRange.startDate,
            endDate: dateRange.endDate,
            searchType: params.searchType,
            dimensionFilterGroups,
            dataState: 'all',
          }),
        ]);

        const rows = pageResponse.rows;
        const totalClicks = totalsResponse.rows[0]?.clicks ?? 0;

        if (rows.length === 0) {
          const text = formatToolResponse(createToolResponse(
            '_No page data found for the specified parameters._',
            'No pages returned.',
            ['Try broadening your date range or removing filters.'],
            [],
          ));
          return { content: [{ type: 'text' as const, text }] };
        }

        // Build table
        const tableHeader = '| # | Page | Clicks | Impressions | CTR | Position | Expected CTR | Performance |';
        const tableSep = '| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |';

        const topClicksSum = rows.reduce((s, r) => s + r.clicks, 0);

        const tableRows = rows.map((row, i) => {
          const page = row.keys[0] ?? '';
          const analysis = analyzeCtr(row.position, row.ctr);

          return `| ${i + 1} | ${page} | ${formatNumber(row.clicks)} | ${formatNumber(row.impressions)} | ${formatPercent(row.ctr)} | ${formatPosition(row.position)} | ${formatPercent(analysis.expectedCtr)} | ${performanceEmoji(analysis.performance)} |`;
        });

        const table = [tableHeader, tableSep, ...tableRows].join('\n');

        const topPct = totalClicks > 0 ? ((topClicksSum / totalClicks) * 100).toFixed(1) : '0';
        const summary = `Top ${rows.length} pages account for ${formatNumber(topClicksSum)} clicks (${topPct}% of total ${formatNumber(totalClicks)} clicks) for ${params.siteUrl} during ${params.period}.`;

        const recommendations: string[] = [];

        // Find pages with high impressions but low CTR
        const highImpLowCtr = rows.filter(r => r.impressions > 100 && r.ctr < 0.02);
        if (highImpLowCtr.length > 0) {
          recommendations.push('Pages with high impressions but low CTR (<2%) -- improve title tags and meta descriptions:');
          highImpLowCtr.slice(0, 5).forEach(r => {
            recommendations.push(`  - ${r.keys[0]} (${formatNumber(r.impressions)} impressions, ${formatPercent(r.ctr)} CTR)`);
          });
        }

        // Find pages with good position but poor CTR
        const goodPositionPoorCtr = rows.filter(r => r.position <= 5 && r.ctr < getExpectedCtr(r.position) * 0.5);
        if (goodPositionPoorCtr.length > 0) {
          recommendations.push('Pages ranking well (top 5) but underperforming on CTR -- consider rich snippets or better meta descriptions:');
          goodPositionPoorCtr.slice(0, 3).forEach(r => {
            recommendations.push(`  - ${r.keys[0]} (position ${formatPosition(r.position)}, CTR ${formatPercent(r.ctr)})`);
          });
        }

        const limitations = [
          'GSC data may be delayed by 2-3 days.',
          'Page URLs are reported as they appear in the index and may differ from canonical URLs.',
          'CTR benchmarks are industry averages and vary by SERP features present.',
        ];

        const text = formatToolResponse(createToolResponse(table, summary, recommendations, limitations));
        return { content: [{ type: 'text' as const, text }] };
      } catch (error) {
        return errorResponse(error);
      }
    },
  );

  // ========================================================================
  // Tool 6: get_traffic_by_device
  // ========================================================================
  server.tool(
    'get_traffic_by_device',
    'Get traffic breakdown by device type (desktop, mobile, tablet)',
    {
      siteUrl: siteUrlSchema,
      period: periodSchema.optional().default('last28d'),
      searchType: searchTypeSchema.optional().default('web'),
    },
    async (params) => {
      try {
        const dateRange = getDateRange(params.period);

        const response = await api.querySearchAnalytics({
          siteUrl: params.siteUrl,
          startDate: dateRange.startDate,
          endDate: dateRange.endDate,
          dimensions: ['device'],
          searchType: params.searchType,
          dataState: 'all',
        });

        const rows = response.rows;

        if (rows.length === 0) {
          const text = formatToolResponse(createToolResponse(
            '_No device data found for the specified parameters._',
            'No device data returned.',
            ['Try broadening your date range.'],
            [],
          ));
          return { content: [{ type: 'text' as const, text }] };
        }

        const totalClicks = rows.reduce((s, r) => s + r.clicks, 0);
        const totalImpressions = rows.reduce((s, r) => s + r.impressions, 0);

        // Build device breakdown table
        const tableHeader = '| Device | Clicks | % of Clicks | Impressions | % of Impressions | CTR | Avg Position |';
        const tableSep = '| --- | ---: | ---: | ---: | ---: | ---: | ---: |';

        const tableRows = rows
          .sort((a, b) => b.clicks - a.clicks)
          .map((row) => {
            const device = row.keys[0] ?? 'Unknown';
            const clickPct = totalClicks > 0 ? ((row.clicks / totalClicks) * 100).toFixed(1) + '%' : '0%';
            const impPct = totalImpressions > 0 ? ((row.impressions / totalImpressions) * 100).toFixed(1) + '%' : '0%';

            return `| ${device} | ${formatNumber(row.clicks)} | ${clickPct} | ${formatNumber(row.impressions)} | ${impPct} | ${formatPercent(row.ctr)} | ${formatPosition(row.position)} |`;
          });

        // Totals row
        const avgCtr = totalImpressions > 0 ? totalClicks / totalImpressions : 0;
        const avgPosition = rows.length > 0
          ? rows.reduce((s, r) => s + r.position * r.impressions, 0) / totalImpressions
          : 0;

        tableRows.push(`| **Total** | **${formatNumber(totalClicks)}** | **100%** | **${formatNumber(totalImpressions)}** | **100%** | **${formatPercent(avgCtr)}** | **${formatPosition(avgPosition)}** |`);

        const table = [tableHeader, tableSep, ...tableRows].join('\n');

        // Build a device map for easy access
        const deviceMap = new Map<string, SearchAnalyticsRow>();
        for (const row of rows) {
          deviceMap.set((row.keys[0] ?? '').toUpperCase(), row);
        }

        const mobile = deviceMap.get('MOBILE');
        const desktop = deviceMap.get('DESKTOP');
        const tablet = deviceMap.get('TABLET');

        const summary = `Device breakdown for ${params.siteUrl} during ${params.period}: ${rows.map(r => `${r.keys[0]}: ${formatNumber(r.clicks)} clicks`).join(', ')}.`;

        const recommendations: string[] = [];

        // Check for device-specific issues
        if (mobile && desktop) {
          const mobileCtr = mobile.ctr;
          const desktopCtr = desktop.ctr;

          if (mobileCtr < desktopCtr * 0.7) {
            recommendations.push(
              `Mobile CTR (${formatPercent(mobileCtr)}) is significantly lower than desktop CTR (${formatPercent(desktopCtr)}). ` +
              'Check mobile usability: page speed, viewport configuration, tap target sizes, and font readability.',
            );
          }

          if (mobile.position > desktop.position + 3) {
            recommendations.push(
              `Mobile rankings (avg position ${formatPosition(mobile.position)}) are notably worse than desktop (${formatPosition(desktop.position)}). ` +
              'Google uses mobile-first indexing -- ensure mobile page experience is optimized.',
            );
          }

          const mobileClickShare = totalClicks > 0 ? mobile.clicks / totalClicks : 0;
          if (mobileClickShare > 0.6) {
            recommendations.push(
              `Mobile drives ${formatPercent(mobileClickShare)} of clicks. Prioritize mobile UX optimizations for maximum impact.`,
            );
          }
        }

        if (tablet && tablet.clicks > 0 && totalClicks > 0 && tablet.clicks / totalClicks < 0.02) {
          recommendations.push('Tablet traffic is minimal. This is typical for most sites and usually not a concern.');
        }

        if (recommendations.length === 0) {
          recommendations.push('Device performance looks balanced. Continue monitoring for shifts in device distribution.');
        }

        const limitations = [
          'GSC data may be delayed by 2-3 days.',
          'Device categorization is determined by Google and may not perfectly match your analytics tool.',
          'Position is averaged across all queries per device and may not reflect individual query performance.',
        ];

        const text = formatToolResponse(createToolResponse(table, summary, recommendations, limitations));
        return { content: [{ type: 'text' as const, text }] };
      } catch (error) {
        return errorResponse(error);
      }
    },
  );
}
