/**
 * Query analysis tools for Google Search Console MCP server.
 *
 * Provides three tools:
 *   - analyze_query_landscape: Intent distribution, branded split, position buckets
 *   - find_new_queries: Emerging and truly new queries between periods
 *   - find_cannibalization: Multiple pages competing for the same query
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { GscApiClient } from '../../api/client.js';
import type { SearchAnalyticsRow } from '../../api/types.js';
import {
  classifyQuery,
  classifyQueries,
  getIntentDistribution,
  type QueryIntent,
} from '../../analysis/query-classifier.js';
import { getDateRange, getPreviousPeriod } from '../../utils/date-helpers.js';
import {
  formatNumber,
  formatPercent,
  formatPosition,
} from '../../utils/formatting.js';
import {
  siteUrlSchema,
  periodSchema,
  searchTypeSchema,
} from '../schemas.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Extract a brandable name from a GSC site URL.
 * "https://example.com/" -> "example"
 * "sc-domain:example.com" -> "example"
 */
function extractBrandName(siteUrl: string): string {
  const cleaned = siteUrl
    .replace(/^sc-domain:/, '')
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '');
  // Remove TLD (everything after last dot)
  const parts = cleaned.split('.');
  return parts.length > 1 ? parts.slice(0, -1).join('.') : cleaned;
}

function errorResponse(error: unknown) {
  const message =
    error instanceof Error ? error.message : 'An unexpected error occurred.';
  return {
    content: [{ type: 'text' as const, text: `**Error:** ${message}` }],
    isError: true,
  };
}

const LIMITATIONS = [
  'Query data is sampled by Google and may not represent 100% of traffic.',
  'GSC limits query-level data to the top queries by impressions; long-tail queries may be absent.',
  'Data freshness lags by approximately 2-3 days.',
  'Intent classification is pattern-based and may not capture nuanced or ambiguous queries.',
];

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerQueryTools(server: McpServer, api: GscApiClient): void {
  // =========================================================================
  // Tool 1: analyze_query_landscape
  // =========================================================================
  server.tool(
    'analyze_query_landscape',
    'Categorize all queries by user intent, branded vs non-branded split, and position distribution',
    {
      siteUrl: siteUrlSchema,
      period: periodSchema.default('last28d'),
      searchType: searchTypeSchema.optional(),
      minImpressions: z
        .number()
        .int()
        .min(0)
        .default(5)
        .describe('Minimum impressions for a query to be included'),
    },
    async ({ siteUrl, period, searchType, minImpressions }) => {
      try {
        const { startDate, endDate } = getDateRange(period);

        const response = await api.querySearchAnalytics({
          siteUrl,
          startDate,
          endDate,
          dimensions: ['query'],
          searchType: searchType ?? 'web',
          rowLimit: 5000,
        });

        const rows = response.rows.filter(
          (r) => r.impressions >= minImpressions,
        );

        if (rows.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `No queries found for **${siteUrl}** in the **${period}** period with at least ${minImpressions} impressions.`,
              },
            ],
          };
        }

        // --- Classify queries ---
        const queryStrings = rows.map((r) => r.keys[0]!);
        const classified = classifyQueries(queryStrings);
        const distribution = getIntentDistribution(classified);
        const totalQueries = classified.length;

        // Map query -> row for easy lookup
        const rowByQuery = new Map<string, SearchAnalyticsRow>();
        for (const row of rows) {
          rowByQuery.set(row.keys[0]!, row);
        }

        // --- Intent distribution ---
        const intentEntries = (
          Object.entries(distribution) as [QueryIntent, number][]
        ).sort((a, b) => b[1] - a[1]);

        let intentSection = '### Intent Distribution\n\n';
        intentSection += '| Intent | Queries | Share |\n';
        intentSection += '|--------|---------|-------|\n';
        for (const [intent, count] of intentEntries) {
          intentSection += `| ${intent} | ${formatNumber(count)} | ${formatPercent(count / totalQueries, 1)} |\n`;
        }

        // --- Branded vs non-branded ---
        const brandName = extractBrandName(siteUrl).toLowerCase();
        let brandedCount = 0;
        let brandedImpressions = 0;
        let nonBrandedImpressions = 0;

        for (const row of rows) {
          const q = row.keys[0]!.toLowerCase();
          if (q.includes(brandName)) {
            brandedCount++;
            brandedImpressions += row.impressions;
          } else {
            nonBrandedImpressions += row.impressions;
          }
        }

        const brandedPct = brandedCount / totalQueries;
        const totalImpressions = brandedImpressions + nonBrandedImpressions;

        let brandedSection = '### Branded vs Non-Branded\n\n';
        brandedSection += `| Segment | Queries | Impressions | Impression Share |\n`;
        brandedSection += `|---------|---------|-------------|------------------|\n`;
        brandedSection += `| Branded | ${formatNumber(brandedCount)} (${formatPercent(brandedPct, 1)}) | ${formatNumber(brandedImpressions)} | ${totalImpressions > 0 ? formatPercent(brandedImpressions / totalImpressions, 1) : '0%'} |\n`;
        brandedSection += `| Non-branded | ${formatNumber(totalQueries - brandedCount)} (${formatPercent(1 - brandedPct, 1)}) | ${formatNumber(nonBrandedImpressions)} | ${totalImpressions > 0 ? formatPercent(nonBrandedImpressions / totalImpressions, 1) : '0%'} |\n`;

        // --- Position distribution ---
        let pos1to3 = 0;
        let pos4to10 = 0;
        let pos11to20 = 0;
        let pos20plus = 0;

        for (const row of rows) {
          const pos = row.position;
          if (pos <= 3) pos1to3++;
          else if (pos <= 10) pos4to10++;
          else if (pos <= 20) pos11to20++;
          else pos20plus++;
        }

        let posSection = '### Position Distribution\n\n';
        posSection += '| Position Range | Queries | Share |\n';
        posSection += '|----------------|---------|-------|\n';
        posSection += `| 1-3 (Top) | ${formatNumber(pos1to3)} | ${formatPercent(pos1to3 / totalQueries, 1)} |\n`;
        posSection += `| 4-10 (Page 1) | ${formatNumber(pos4to10)} | ${formatPercent(pos4to10 / totalQueries, 1)} |\n`;
        posSection += `| 11-20 (Page 2) | ${formatNumber(pos11to20)} | ${formatPercent(pos11to20 / totalQueries, 1)} |\n`;
        posSection += `| 20+ (Page 3+) | ${formatNumber(pos20plus)} | ${formatPercent(pos20plus / totalQueries, 1)} |\n`;

        // --- Top queries per intent ---
        const classifiedWithRow = classified.map((c) => ({
          ...c,
          row: rowByQuery.get(c.query)!,
        }));

        let topSection = '### Top Queries by Intent\n\n';
        for (const [intent] of intentEntries) {
          const intentQueries = classifiedWithRow
            .filter((c) => c.intent === intent)
            .sort((a, b) => b.row.clicks - a.row.clicks)
            .slice(0, 5);

          if (intentQueries.length === 0) continue;

          topSection += `#### ${intent}\n\n`;
          topSection += '| Query | Clicks | Impressions | CTR | Position |\n';
          topSection += '|-------|--------|-------------|-----|----------|\n';
          for (const q of intentQueries) {
            topSection += `| ${q.query} | ${formatNumber(q.row.clicks)} | ${formatNumber(q.row.impressions)} | ${formatPercent(q.row.ctr)} | ${formatPosition(q.row.position)} |\n`;
          }
          topSection += '\n';
        }

        // --- Average position ---
        const totalClicksAll = rows.reduce((s, r) => s + r.clicks, 0);
        const weightedPos = rows.reduce(
          (s, r) => s + r.position * r.impressions,
          0,
        );
        const avgPos =
          totalImpressions > 0 ? weightedPos / totalImpressions : 0;

        // --- Recommendations ---
        const recommendations: string[] = [];

        const infoPct = distribution.informational / totalQueries;
        const transPct = distribution.transactional / totalQueries;

        if (infoPct > 0.5) {
          recommendations.push(
            'Your traffic is information-driven. Monetize with ads or lead magnets, not direct sales.',
          );
        }
        if (transPct < 0.1) {
          recommendations.push(
            'Consider creating product/pricing pages to capture buying intent.',
          );
        }
        if (brandedPct > 0.3) {
          recommendations.push(
            'Strong brand presence. Focus on non-branded growth for expansion.',
          );
        }
        if (pos20plus / totalQueries > 0.4) {
          recommendations.push(
            'Over 40% of your queries rank on page 3+. Prioritize content improvements for queries on the cusp of page 2/1.',
          );
        }

        // --- Assemble output ---
        const parts: string[] = [];
        parts.push(
          `# Query Landscape Analysis\n\n**Site:** ${siteUrl}  \n**Period:** ${startDate} to ${endDate} (${period})  \n**Queries analyzed:** ${formatNumber(totalQueries)}  \n`,
        );
        parts.push(intentSection);
        parts.push(brandedSection);
        parts.push(posSection);
        parts.push(topSection);

        if (recommendations.length > 0) {
          parts.push('### Recommendations\n');
          for (const rec of recommendations) {
            parts.push(`- ${rec}`);
          }
          parts.push('');
        }

        parts.push('### Limitations\n');
        for (const lim of LIMITATIONS) {
          parts.push(`- ${lim}`);
        }
        parts.push('');

        const infoPctVal = formatPercent(infoPct, 1);
        const transPctVal = formatPercent(transPct, 1);
        const brandedPctVal = formatPercent(brandedPct, 1);

        parts.push(
          `---\n**Summary:** Analyzed ${formatNumber(totalQueries)} queries. ${infoPctVal} informational, ${transPctVal} transactional. ${brandedPctVal} branded. Average position: ${formatPosition(avgPos)}.`,
        );

        return {
          content: [{ type: 'text' as const, text: parts.join('\n') }],
        };
      } catch (err) {
        return errorResponse(err);
      }
    },
  );

  // =========================================================================
  // Tool 2: find_new_queries
  // =========================================================================
  server.tool(
    'find_new_queries',
    'Find truly new and rapidly emerging queries by comparing the current period against the previous period',
    {
      siteUrl: siteUrlSchema,
      period: periodSchema.default('last28d'),
      searchType: searchTypeSchema.optional(),
      minImpressions: z
        .number()
        .int()
        .min(0)
        .default(5)
        .describe('Minimum impressions in the current period to be included'),
    },
    async ({ siteUrl, period, searchType, minImpressions }) => {
      try {
        const currentRange = getDateRange(period);
        const previousRange = getPreviousPeriod(
          currentRange.startDate,
          currentRange.endDate,
        );

        const st = searchType ?? 'web';

        // Fetch both periods concurrently
        const [currentRes, previousRes] = await Promise.all([
          api.querySearchAnalytics({
            siteUrl,
            startDate: currentRange.startDate,
            endDate: currentRange.endDate,
            dimensions: ['query'],
            searchType: st,
            rowLimit: 5000,
          }),
          api.querySearchAnalytics({
            siteUrl,
            startDate: previousRange.startDate,
            endDate: previousRange.endDate,
            dimensions: ['query'],
            searchType: st,
            rowLimit: 5000,
          }),
        ]);

        const currentRows = currentRes.rows.filter(
          (r) => r.impressions >= minImpressions,
        );
        const previousByQuery = new Map<string, SearchAnalyticsRow>();
        for (const row of previousRes.rows) {
          previousByQuery.set(row.keys[0]!, row);
        }

        interface QueryEntry {
          query: string;
          impressions: number;
          clicks: number;
          ctr: number;
          position: number;
          intent: QueryIntent;
          status: 'new' | 'emerging';
          growthPct?: number;
        }

        const results: QueryEntry[] = [];

        for (const row of currentRows) {
          const query = row.keys[0]!;
          const prev = previousByQuery.get(query);
          const classification = classifyQuery(query);

          if (!prev) {
            // Truly new query - not present in previous period
            results.push({
              query,
              impressions: row.impressions,
              clicks: row.clicks,
              ctr: row.ctr,
              position: row.position,
              intent: classification.intent,
              status: 'new',
            });
          } else if (prev.impressions > 0) {
            const growth =
              (row.impressions - prev.impressions) / prev.impressions;
            if (growth > 1.0) {
              // >100% impression growth
              results.push({
                query,
                impressions: row.impressions,
                clicks: row.clicks,
                ctr: row.ctr,
                position: row.position,
                intent: classification.intent,
                status: 'emerging',
                growthPct: growth,
              });
            }
          }
        }

        // Sort by impressions descending
        results.sort((a, b) => b.impressions - a.impressions);

        if (results.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `No new or rapidly emerging queries found for **${siteUrl}** when comparing **${period}** against the previous period (min ${minImpressions} impressions).`,
              },
            ],
          };
        }

        const newQueries = results.filter((r) => r.status === 'new');
        const emergingQueries = results.filter((r) => r.status === 'emerging');
        const combinedImpressions = results.reduce(
          (s, r) => s + r.impressions,
          0,
        );

        // --- Build output ---
        const parts: string[] = [];
        parts.push(
          `# New & Emerging Queries\n\n**Site:** ${siteUrl}  \n**Current period:** ${currentRange.startDate} to ${currentRange.endDate}  \n**Previous period:** ${previousRange.startDate} to ${previousRange.endDate}  \n`,
        );

        // New queries table
        if (newQueries.length > 0) {
          parts.push(`### Truly New Queries (${formatNumber(newQueries.length)})\n`);
          parts.push(
            'Queries that appeared in the current period but had **zero** presence in the previous period.\n',
          );
          parts.push(
            '| Query | Impressions | Clicks | CTR | Position | Intent |',
          );
          parts.push(
            '|-------|-------------|--------|-----|----------|--------|',
          );
          for (const entry of newQueries.slice(0, 50)) {
            parts.push(
              `| ${entry.query} | ${formatNumber(entry.impressions)} | ${formatNumber(entry.clicks)} | ${formatPercent(entry.ctr)} | ${formatPosition(entry.position)} | ${entry.intent} |`,
            );
          }
          if (newQueries.length > 50) {
            parts.push(
              `\n_...and ${formatNumber(newQueries.length - 50)} more new queries._\n`,
            );
          }
          parts.push('');
        }

        // Emerging queries table
        if (emergingQueries.length > 0) {
          parts.push(
            `### Rapidly Emerging Queries (${formatNumber(emergingQueries.length)})\n`,
          );
          parts.push(
            'Queries with **>100% impression growth** compared to the previous period.\n',
          );
          parts.push(
            '| Query | Impressions | Clicks | CTR | Position | Intent | Growth |',
          );
          parts.push(
            '|-------|-------------|--------|-----|----------|--------|--------|',
          );
          for (const entry of emergingQueries.slice(0, 50)) {
            const growthStr =
              entry.growthPct !== undefined
                ? formatPercent(entry.growthPct)
                : 'N/A';
            parts.push(
              `| ${entry.query} | ${formatNumber(entry.impressions)} | ${formatNumber(entry.clicks)} | ${formatPercent(entry.ctr)} | ${formatPosition(entry.position)} | ${entry.intent} | +${growthStr} |`,
            );
          }
          if (emergingQueries.length > 50) {
            parts.push(
              `\n_...and ${formatNumber(emergingQueries.length - 50)} more emerging queries._\n`,
            );
          }
          parts.push('');
        }

        // Recommendations
        parts.push('### Recommendations\n');
        if (newQueries.length > 0) {
          parts.push(
            '- Create dedicated content for high-impression new queries that lack a targeted landing page.',
          );
        }
        if (emergingQueries.length > 0) {
          parts.push(
            '- Optimize existing pages for rapidly emerging queries to capture growing demand early.',
          );
        }
        parts.push(
          '- Monitor these queries weekly to identify trends before competitors react.',
        );
        parts.push('');

        // Limitations
        parts.push('### Limitations\n');
        for (const lim of LIMITATIONS) {
          parts.push(`- ${lim}`);
        }
        parts.push(
          '- "New" means not present in the sampled data for the previous period; the query may have existed at very low volumes.',
        );
        parts.push('');

        parts.push(
          `---\n**Summary:** Found ${formatNumber(newQueries.length)} new queries and ${formatNumber(emergingQueries.length)} rapidly emerging queries. Combined impressions: ${formatNumber(combinedImpressions)}.`,
        );

        return {
          content: [{ type: 'text' as const, text: parts.join('\n') }],
        };
      } catch (err) {
        return errorResponse(err);
      }
    },
  );

  // =========================================================================
  // Tool 3: find_cannibalization
  // =========================================================================
  server.tool(
    'find_cannibalization',
    'Detect keyword cannibalization: multiple pages competing for the same query',
    {
      siteUrl: siteUrlSchema,
      period: periodSchema.default('last28d'),
      searchType: searchTypeSchema.optional(),
      minImpressions: z
        .number()
        .int()
        .min(0)
        .default(20)
        .describe(
          'Minimum total impressions for a query to be evaluated for cannibalization',
        ),
    },
    async ({ siteUrl, period, searchType, minImpressions }) => {
      try {
        const { startDate, endDate } = getDateRange(period);

        const response = await api.querySearchAnalytics({
          siteUrl,
          startDate,
          endDate,
          dimensions: ['query', 'page'],
          searchType: searchType ?? 'web',
          rowLimit: 10000,
        });

        // Group rows by query
        const queryPages = new Map<string, SearchAnalyticsRow[]>();
        for (const row of response.rows) {
          const query = row.keys[0]!;
          const existing = queryPages.get(query);
          if (existing) {
            existing.push(row);
          } else {
            queryPages.set(query, [row]);
          }
        }

        interface CompetingPage {
          url: string;
          position: number;
          clicks: number;
          impressions: number;
          ctr: number;
        }

        interface CannibalizationCase {
          query: string;
          pages: CompetingPage[];
          totalImpressions: number;
          totalClicks: number;
          severity: 'critical' | 'high' | 'medium';
          winner: CompetingPage;
          losers: CompetingPage[];
        }

        const cases: CannibalizationCase[] = [];

        for (const [query, rows] of queryPages) {
          if (rows.length < 2) continue;

          const totalImpressions = rows.reduce(
            (s, r) => s + r.impressions,
            0,
          );
          if (totalImpressions < minImpressions) continue;

          // Sort by position ascending (best first)
          const sorted = [...rows].sort((a, b) => a.position - b.position);

          const pages: CompetingPage[] = sorted.map((r) => ({
            url: r.keys[1]!,
            position: r.position,
            clicks: r.clicks,
            impressions: r.impressions,
            ctr: r.ctr,
          }));

          const winner = pages[0]!;
          const losers = pages.slice(1);
          const totalClicks = rows.reduce((s, r) => s + r.clicks, 0);

          // Determine severity
          let severity: 'critical' | 'high' | 'medium';
          const bestPos = winner.position;
          const secondBestPos = losers[0]!.position;

          if (bestPos <= 10 && secondBestPos <= 10) {
            // Both on page 1 - actively hurting each other
            severity = 'critical';
          } else if (bestPos <= 10 && secondBestPos <= 20) {
            // One page 1, one page 2 - confused signals
            severity = 'high';
          } else {
            severity = 'medium';
          }

          cases.push({
            query,
            pages,
            totalImpressions,
            totalClicks,
            severity,
            winner: winner,
            losers,
          });
        }

        if (cases.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `No keyword cannibalization detected for **${siteUrl}** in the **${period}** period (min ${minImpressions} impressions per query).`,
              },
            ],
          };
        }

        // Sort by severity (critical > high > medium), then by impressions desc
        const severityOrder = { critical: 0, high: 1, medium: 2 };
        cases.sort(
          (a, b) =>
            severityOrder[a.severity] - severityOrder[b.severity] ||
            b.totalImpressions - a.totalImpressions,
        );

        // Count severity levels
        const criticalCount = cases.filter(
          (c) => c.severity === 'critical',
        ).length;
        const highCount = cases.filter((c) => c.severity === 'high').length;
        const mediumCount = cases.filter((c) => c.severity === 'medium').length;

        // Collect affected pages
        const affectedPages = new Set<string>();
        for (const c of cases) {
          for (const p of c.pages) {
            affectedPages.add(p.url);
          }
        }

        const wastedImpressions = cases.reduce((sum, c) => {
          // Wasted = impressions going to losers instead of the winner
          const loserImpressions = c.losers.reduce(
            (s, l) => s + l.impressions,
            0,
          );
          return sum + loserImpressions;
        }, 0);

        // --- Build output ---
        const parts: string[] = [];
        parts.push(
          `# Keyword Cannibalization Report\n\n**Site:** ${siteUrl}  \n**Period:** ${startDate} to ${endDate} (${period})  \n**Cannibalized queries:** ${formatNumber(cases.length)}  \n**Severity breakdown:** ${criticalCount} critical, ${highCount} high, ${mediumCount} medium  \n`,
        );

        // Severity legend
        parts.push('### Severity Levels\n');
        parts.push(
          '- **Critical:** Both pages on page 1 (positions 1-10) -- actively splitting clicks',
        );
        parts.push(
          '- **High:** One page on page 1, one on page 2 -- sending mixed ranking signals',
        );
        parts.push(
          '- **Medium:** Both pages on page 2+ -- lower impact but still diluting authority',
        );
        parts.push('');

        // Detail per case (limit output to top 30 to avoid excessive length)
        const displayCases = cases.slice(0, 30);

        for (const c of displayCases) {
          const severityEmoji =
            c.severity === 'critical'
              ? '[CRITICAL]'
              : c.severity === 'high'
                ? '[HIGH]'
                : '[MEDIUM]';

          parts.push(
            `### ${severityEmoji} "${c.query}"\n`,
          );
          parts.push(
            `Total impressions: ${formatNumber(c.totalImpressions)} | Total clicks: ${formatNumber(c.totalClicks)}\n`,
          );
          parts.push('| Page | Position | Clicks | Impressions | CTR | Role |');
          parts.push(
            '|------|----------|--------|-------------|-----|------|',
          );

          parts.push(
            `| ${c.winner.url} | ${formatPosition(c.winner.position)} | ${formatNumber(c.winner.clicks)} | ${formatNumber(c.winner.impressions)} | ${formatPercent(c.winner.ctr)} | Winner |`,
          );
          for (const loser of c.losers) {
            parts.push(
              `| ${loser.url} | ${formatPosition(loser.position)} | ${formatNumber(loser.clicks)} | ${formatNumber(loser.impressions)} | ${formatPercent(loser.ctr)} | Loser |`,
            );
          }

          // Per-case recommendation
          parts.push('');
          parts.push('**Recommended action:**');
          if (c.severity === 'critical') {
            parts.push(
              `- Consolidate content from ${c.losers[0]!.url} into ${c.winner.url} and set up a 301 redirect.`,
            );
            parts.push(
              `- Alternatively, add a canonical tag from ${c.losers[0]!.url} pointing to ${c.winner.url}.`,
            );
          } else if (c.severity === 'high') {
            parts.push(
              `- Add a canonical tag from ${c.losers[0]!.url} to ${c.winner.url}.`,
            );
            parts.push(
              `- Differentiate the content: make ${c.winner.url} target the primary intent and ${c.losers[0]!.url} target a distinct sub-topic.`,
            );
          } else {
            parts.push(
              `- Differentiate the content: make ${c.winner.url} target one intent and ${c.losers[0]!.url} target another.`,
            );
            parts.push(
              `- If the pages serve the same purpose, consolidate into ${c.winner.url} and 301 redirect.`,
            );
          }
          parts.push('');
        }

        if (cases.length > 30) {
          parts.push(
            `_...and ${formatNumber(cases.length - 30)} more cannibalized queries not shown._\n`,
          );
        }

        // Limitations
        parts.push('### Limitations\n');
        for (const lim of LIMITATIONS) {
          parts.push(`- ${lim}`);
        }
        parts.push(
          '- Cannibalization detection is based on multiple pages appearing for the same query in GSC data. Some cases may be intentional (e.g., site links, different page types).',
        );
        parts.push('');

        parts.push(
          `---\n**Summary:** Found ${formatNumber(cases.length)} cannibalized queries affecting ${formatNumber(affectedPages.size)} pages. Estimated wasted impressions: ${formatNumber(wastedImpressions)}.`,
        );

        return {
          content: [{ type: 'text' as const, text: parts.join('\n') }],
        };
      } catch (err) {
        return errorResponse(err);
      }
    },
  );
}
