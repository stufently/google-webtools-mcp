import { z } from 'zod';

// Shared schemas used across multiple tool groups

export const siteUrlSchema = z.string().describe(
  'The site URL exactly as it appears in Google Search Console (e.g., "https://example.com/" or "sc-domain:example.com")'
);

export const dateRangeSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Start date in YYYY-MM-DD format'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('End date in YYYY-MM-DD format'),
});

export const periodSchema = z.enum([
  'last7d', 'last28d', 'last3m', 'last6m', 'last12m', 'last16m',
]).describe('Predefined date range period');

export const searchTypeSchema = z.enum([
  'web', 'image', 'video', 'news', 'discover', 'googleNews',
]).default('web').describe('Search type to analyze');

export const deviceSchema = z.enum([
  'DESKTOP', 'MOBILE', 'TABLET',
]).describe('Device type filter');

export const dimensionSchema = z.enum([
  'date', 'query', 'page', 'country', 'device', 'searchAppearance',
]).describe('Dimension to group results by');

export const filterOperatorSchema = z.enum([
  'contains', 'equals', 'notContains', 'notEquals', 'includingRegex', 'excludingRegex',
]);

export const dimensionFilterSchema = z.object({
  dimension: z.string().describe('Dimension to filter on (query, page, country, device, searchAppearance)'),
  operator: filterOperatorSchema.default('contains'),
  expression: z.string().describe('Filter expression value'),
});

export const dataStateSchema = z.enum(['all', 'final']).default('all').describe(
  '"final" = only finalized data (3+ days old), "all" = includes fresh data'
);

export const rowLimitSchema = z.number().min(1).max(25000).default(1000).describe(
  'Maximum rows to return (1-25000)'
);

export const aggregationTypeSchema = z.enum(['auto', 'byPage', 'byProperty']).default('auto');

// Common response wrapper
export interface ToolResponse<T = unknown> {
  data: T;
  summary: string;
  recommendations: string[];
  limitations: string[];
}

export function createToolResponse<T>(
  data: T,
  summary: string,
  recommendations: string[] = [],
  limitations: string[] = [],
): ToolResponse<T> {
  return { data, summary, recommendations, limitations };
}

export function formatToolResponse<T>(response: ToolResponse<T>): string {
  const parts: string[] = [];

  parts.push('## Summary\n' + response.summary);

  if (typeof response.data === 'string') {
    parts.push('\n## Data\n' + response.data);
  } else {
    parts.push('\n## Data\n```json\n' + JSON.stringify(response.data, null, 2) + '\n```');
  }

  if (response.recommendations.length > 0) {
    parts.push('\n## Recommendations\n' + response.recommendations.map((r, i) => `${i + 1}. ${r}`).join('\n'));
  }

  if (response.limitations.length > 0) {
    parts.push('\n## Limitations\n' + response.limitations.map(l => `- ${l}`).join('\n'));
  }

  return parts.join('\n');
}
