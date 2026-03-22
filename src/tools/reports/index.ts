/**
 * Composite Report Tools
 *
 * High-level "wow" tools that aggregate data from multiple GSC API calls
 * and analysis modules into polished, professional markdown reports.
 *
 * - weekly_seo_report: Full weekly SEO performance report
 * - seo_health_check: Comprehensive health check with letter grade
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { GscApiClient } from '../../api/client.js';
import type {
  SearchAnalyticsRow,
  SearchAnalyticsRequest,
  SitemapInfo,
} from '../../api/types.js';
import { siteUrlSchema, searchTypeSchema } from '../schemas.js';
import { GscError } from '../../errors/gsc-error.js';

// Analysis modules
import { getExpectedCtr, analyzeCtr } from '../../analysis/ctr-benchmarks.js';
import { detectTrend, type TrendPoint } from '../../analysis/trend-detector.js';
import { classifyQueries, getIntentDistribution } from '../../analysis/query-classifier.js';
import { scoreOpportunity } from '../../analysis/opportunity-scorer.js';
import { generateRecommendations } from '../../analysis/recommendation-engine.js';

// Utility modules
import { getDateRange, getPreviousPeriod, formatDate, daysBetween } from '../../utils/date-helpers.js';
import { formatNumber, formatPercent, formatPosition, formatChange } from '../../utils/formatting.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

type SearchType = 'web' | 'image' | 'video' | 'news' | 'discover' | 'googleNews';

interface PerformanceTotals {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

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
 * Aggregate rows into performance totals.
 */
function aggregateRows(rows: SearchAnalyticsRow[]): PerformanceTotals {
  if (rows.length === 0) {
    return { clicks: 0, impressions: 0, ctr: 0, position: 0 };
  }

  const totalClicks = rows.reduce((sum, r) => sum + r.clicks, 0);
  const totalImpressions = rows.reduce((sum, r) => sum + r.impressions, 0);
  const ctr = totalImpressions > 0 ? totalClicks / totalImpressions : 0;

  // Weighted average position by impressions
  const weightedPosition = rows.reduce((sum, r) => sum + r.position * r.impressions, 0);
  const position = totalImpressions > 0 ? weightedPosition / totalImpressions : 0;

  return { clicks: totalClicks, impressions: totalImpressions, ctr, position };
}

/**
 * Safely execute a report section, returning the markdown or a failure note.
 */
async function safeSection<T>(
  sectionName: string,
  fn: () => Promise<T>,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const data = await fn();
    return { ok: true, data };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return {
      ok: false,
      error: `> **Note:** The "${sectionName}" section could not be generated. Error: ${msg}`,
    };
  }
}

/**
 * Build a search analytics request for a given date range.
 */
function buildRequest(
  siteUrl: string,
  startDate: string,
  endDate: string,
  searchType: SearchType,
  dimensions: SearchAnalyticsRequest['dimensions'] = [],
  rowLimit: number = 1000,
): SearchAnalyticsRequest {
  return {
    siteUrl,
    startDate,
    endDate,
    searchType,
    dimensions,
    rowLimit,
  };
}

/**
 * Format a report generation timestamp.
 */
function reportTimestamp(): string {
  const now = new Date();
  return now.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerReportTools(server: McpServer, api: GscApiClient): void {
  // ========================================================================
  // Tool 1: weekly_seo_report
  // ========================================================================

  server.tool(
    'weekly_seo_report',
    'Generate a comprehensive weekly SEO performance report with trends, growers, decliners, quick wins, sitemap health, and prioritized recommendations',
    {
      siteUrl: siteUrlSchema,
      searchType: searchTypeSchema,
    },
    async ({ siteUrl, searchType }) => {
      try {
        const type = (searchType ?? 'web') as SearchType;
        const sections: string[] = [];

        // Date ranges
        const currentRange = getDateRange('last7d');
        const previousRange = getPreviousPeriod(currentRange.startDate, currentRange.endDate);

        // ── Header ──────────────────────────────────────────────────────
        sections.push(`# Weekly SEO Report`);
        sections.push(`**Property:** ${siteUrl}  `);
        sections.push(`**Period:** ${currentRange.startDate} to ${currentRange.endDate}  `);
        sections.push(`**Search type:** ${type}  `);
        sections.push(`**Generated:** ${reportTimestamp()}`);
        sections.push('---');

        // ── Section 1: Performance vs Last Week ─────────────────────────
        const perfResult = await safeSection('Performance vs Last Week', async () => {
          const [currentRes, previousRes] = await Promise.all([
            api.querySearchAnalytics(buildRequest(siteUrl, currentRange.startDate, currentRange.endDate, type)),
            api.querySearchAnalytics(buildRequest(siteUrl, previousRange.startDate, previousRange.endDate, type)),
          ]);

          const current = aggregateRows(currentRes.rows);
          const previous = aggregateRows(previousRes.rows);

          return { current, previous };
        });

        if (perfResult.ok) {
          const { current, previous } = perfResult.data;

          sections.push(`## Performance vs Last Week`);
          sections.push('');
          sections.push('| Metric | This Week | Last Week | Change |');
          sections.push('| --- | ---: | ---: | ---: |');
          sections.push(`| **Clicks** | ${formatNumber(current.clicks)} | ${formatNumber(previous.clicks)} | ${formatChange(current.clicks, previous.clicks)} |`);
          sections.push(`| **Impressions** | ${formatNumber(current.impressions)} | ${formatNumber(previous.impressions)} | ${formatChange(current.impressions, previous.impressions)} |`);
          sections.push(`| **CTR** | ${formatPercent(current.ctr)} | ${formatPercent(previous.ctr)} | ${formatChange(current.ctr, previous.ctr)} |`);
          sections.push(`| **Avg Position** | ${formatPosition(current.position)} | ${formatPosition(previous.position)} | ${formatChange(previous.position, current.position)} |`);
          sections.push('');
        } else {
          sections.push(`## Performance vs Last Week`);
          sections.push(perfResult.error);
          sections.push('');
        }

        // ── Fetch query-level data for growers / decliners ──────────────
        const queryDataResult = await safeSection('Query Analysis', async () => {
          const [currentQueryRes, previousQueryRes] = await Promise.all([
            api.querySearchAnalytics(buildRequest(
              siteUrl, currentRange.startDate, currentRange.endDate, type, ['query'], 5000,
            )),
            api.querySearchAnalytics(buildRequest(
              siteUrl, previousRange.startDate, previousRange.endDate, type, ['query'], 5000,
            )),
          ]);

          // Build lookup from previous period
          const previousMap = new Map<string, SearchAnalyticsRow>();
          for (const row of previousQueryRes.rows) {
            previousMap.set(row.keys[0]!, row);
          }

          // Calculate changes
          const changes: Array<{
            query: string;
            currentClicks: number;
            previousClicks: number;
            clickChange: number;
            currentImpressions: number;
            currentPosition: number;
            currentCtr: number;
          }> = [];

          for (const row of currentQueryRes.rows) {
            const query = row.keys[0]!;
            const prev = previousMap.get(query);
            const previousClicks = prev?.clicks ?? 0;
            changes.push({
              query,
              currentClicks: row.clicks,
              previousClicks,
              clickChange: row.clicks - previousClicks,
              currentImpressions: row.impressions,
              currentPosition: row.position,
              currentCtr: row.ctr,
            });
          }

          // Also add queries that existed previously but not this week
          for (const [query, prev] of previousMap) {
            if (!currentQueryRes.rows.some((r) => r.keys[0] === query)) {
              changes.push({
                query,
                currentClicks: 0,
                previousClicks: prev.clicks,
                clickChange: -prev.clicks,
                currentImpressions: 0,
                currentPosition: 0,
                currentCtr: 0,
              });
            }
          }

          return { changes, currentQueryRows: currentQueryRes.rows };
        });

        // ── Section 2: Top Growers ──────────────────────────────────────
        if (queryDataResult.ok) {
          const { changes } = queryDataResult.data;
          const growers = [...changes]
            .sort((a, b) => b.clickChange - a.clickChange)
            .slice(0, 5)
            .filter((g) => g.clickChange > 0);

          sections.push(`## Top Growers`);
          if (growers.length > 0) {
            sections.push('');
            sections.push('| # | Query | Clicks (Now) | Clicks (Prev) | Change |');
            sections.push('| ---: | --- | ---: | ---: | ---: |');
            growers.forEach((g, i) => {
              const sign = g.clickChange > 0 ? '+' : '';
              sections.push(
                `| ${i + 1} | ${g.query} | ${formatNumber(g.currentClicks)} | ${formatNumber(g.previousClicks)} | ${sign}${formatNumber(g.clickChange)} |`,
              );
            });
          } else {
            sections.push('_No queries with increasing clicks this week._');
          }
          sections.push('');
        } else {
          sections.push(`## Top Growers`);
          sections.push(queryDataResult.error);
          sections.push('');
        }

        // ── Section 3: Top Decliners ────────────────────────────────────
        if (queryDataResult.ok) {
          const { changes } = queryDataResult.data;
          const decliners = [...changes]
            .sort((a, b) => a.clickChange - b.clickChange)
            .slice(0, 5)
            .filter((d) => d.clickChange < 0);

          sections.push(`## Top Decliners`);
          if (decliners.length > 0) {
            sections.push('');
            sections.push('| # | Query | Clicks (Now) | Clicks (Prev) | Change |');
            sections.push('| ---: | --- | ---: | ---: | ---: |');
            decliners.forEach((d, i) => {
              sections.push(
                `| ${i + 1} | ${d.query} | ${formatNumber(d.currentClicks)} | ${formatNumber(d.previousClicks)} | ${formatNumber(d.clickChange)} |`,
              );
            });
          } else {
            sections.push('_No queries with declining clicks this week._');
          }
          sections.push('');
        } else {
          sections.push(`## Top Decliners`);
          sections.push(queryDataResult.error);
          sections.push('');
        }

        // ── Section 4: Quick Wins ───────────────────────────────────────
        const quickWinsResult = await safeSection('Quick Wins', async () => {
          // Use current period query data if available, otherwise fetch fresh
          let queryRows: SearchAnalyticsRow[];
          if (queryDataResult.ok) {
            queryRows = queryDataResult.data.currentQueryRows;
          } else {
            const res = await api.querySearchAnalytics(buildRequest(
              siteUrl, currentRange.startDate, currentRange.endDate, type, ['query'], 5000,
            ));
            queryRows = res.rows;
          }

          const quickWins: Array<{
            query: string;
            reason: string;
            impressions: number;
            position: number;
            ctr: number;
            score: number;
          }> = [];

          for (const row of queryRows) {
            const query = row.keys[0]!;
            const pos = row.position;
            const expected = getExpectedCtr(pos);

            // Opportunity 1: Position 4-10 with high impressions (almost top 3)
            if (pos >= 4 && pos <= 10 && row.impressions >= 50) {
              const oppScore = scoreOpportunity({
                impressions: row.impressions,
                clicks: row.clicks,
                ctr: row.ctr,
                position: pos,
                expectedCtr: expected,
              });
              quickWins.push({
                query,
                reason: `Position ${formatPosition(pos)} with ${formatNumber(row.impressions)} impressions -- push to top 3`,
                impressions: row.impressions,
                position: pos,
                ctr: row.ctr,
                score: oppScore.score,
              });
            }

            // Opportunity 2: Low CTR at good position (pos 1-5)
            if (pos >= 1 && pos <= 5 && row.ctr < expected * 0.6 && row.impressions >= 20) {
              const oppScore = scoreOpportunity({
                impressions: row.impressions,
                clicks: row.clicks,
                ctr: row.ctr,
                position: pos,
                expectedCtr: expected,
              });
              quickWins.push({
                query,
                reason: `CTR ${formatPercent(row.ctr)} at position ${formatPosition(pos)} (expected ${formatPercent(expected)}) -- improve title/description`,
                impressions: row.impressions,
                position: pos,
                ctr: row.ctr,
                score: oppScore.score,
              });
            }

            // Opportunity 3: Almost page 1 (position 11-15)
            if (pos >= 11 && pos <= 15 && row.impressions >= 30) {
              const oppScore = scoreOpportunity({
                impressions: row.impressions,
                clicks: row.clicks,
                ctr: row.ctr,
                position: pos,
                expectedCtr: expected,
              });
              quickWins.push({
                query,
                reason: `Position ${formatPosition(pos)} -- just off page 1, small push needed`,
                impressions: row.impressions,
                position: pos,
                ctr: row.ctr,
                score: oppScore.score,
              });
            }
          }

          // Deduplicate by query, keeping highest score
          const byQuery = new Map<string, typeof quickWins[number]>();
          for (const win of quickWins) {
            const existing = byQuery.get(win.query);
            if (!existing || win.score > existing.score) {
              byQuery.set(win.query, win);
            }
          }

          return [...byQuery.values()]
            .sort((a, b) => b.score - a.score)
            .slice(0, 3);
        });

        sections.push(`## Quick Wins`);
        if (quickWinsResult.ok) {
          const wins = quickWinsResult.data;
          if (wins.length > 0) {
            sections.push('');
            wins.forEach((win, i) => {
              sections.push(`**${i + 1}. "${win.query}"**  `);
              sections.push(`Position: ${formatPosition(win.position)} | CTR: ${formatPercent(win.ctr)} | Impressions: ${formatNumber(win.impressions)}  `);
              sections.push(`Opportunity: ${win.reason}  `);
              sections.push('');
            });
          } else {
            sections.push('_No quick-win opportunities identified this week._');
          }
        } else {
          sections.push(quickWinsResult.error);
        }
        sections.push('');

        // ── Section 5: Sitemap Health ───────────────────────────────────
        const sitemapResult = await safeSection('Sitemap Health', async () => {
          const sitemaps = await api.listSitemaps(siteUrl);
          return sitemaps;
        });

        sections.push(`## Sitemap Health`);
        if (sitemapResult.ok) {
          const sitemaps = sitemapResult.data;
          if (sitemaps.length === 0) {
            sections.push('');
            sections.push('**No sitemaps submitted.** Consider submitting a sitemap to help Google discover your pages.');
          } else {
            const totalUrls = sitemaps.reduce((total, sm) => {
              if (!sm.contents) return total;
              return total + sm.contents.reduce((sum, c) => sum + parseInt(c.submitted ?? '0', 10), 0);
            }, 0);
            const errorCount = sitemaps.filter((s) => s.errors).length;
            const warningCount = sitemaps.filter((s) => s.warnings).length;
            const pendingCount = sitemaps.filter((s) => s.isPending).length;

            sections.push('');
            sections.push(`| Metric | Value |`);
            sections.push(`| --- | --- |`);
            sections.push(`| **Sitemaps** | ${sitemaps.length} |`);
            sections.push(`| **Total URLs** | ${formatNumber(totalUrls)} |`);
            sections.push(`| **With errors** | ${errorCount} |`);
            sections.push(`| **With warnings** | ${warningCount} |`);
            sections.push(`| **Pending** | ${pendingCount} |`);

            if (errorCount > 0) {
              sections.push('');
              sections.push('**Sitemaps with errors:**');
              for (const sm of sitemaps.filter((s) => s.errors)) {
                sections.push(`- \`${sm.path}\`: ${sm.errors}`);
              }
            }
            if (warningCount > 0) {
              sections.push('');
              sections.push('**Sitemaps with warnings:**');
              for (const sm of sitemaps.filter((s) => s.warnings)) {
                sections.push(`- \`${sm.path}\`: ${sm.warnings}`);
              }
            }

            if (errorCount === 0 && warningCount === 0 && pendingCount === 0) {
              sections.push('');
              sections.push('All sitemaps are healthy with no errors or warnings.');
            }
          }
        } else {
          sections.push(sitemapResult.error);
        }
        sections.push('');

        // ── Section 6: Executive Summary ────────────────────────────────
        // Built after all data is gathered so it can summarize everything
        const summaryParts: string[] = [];

        if (perfResult.ok) {
          const { current, previous } = perfResult.data;
          const clickDirection = current.clicks >= previous.clicks ? 'increased' : 'decreased';
          const clickDelta = Math.abs(current.clicks - previous.clicks);
          summaryParts.push(
            `Clicks ${clickDirection} by ${formatNumber(clickDelta)} (${formatChange(current.clicks, previous.clicks)}) compared to the previous week.`,
          );

          const impressionDirection = current.impressions >= previous.impressions ? 'up' : 'down';
          summaryParts.push(
            `Impressions were ${impressionDirection} at ${formatNumber(current.impressions)} (${formatChange(current.impressions, previous.impressions)}).`,
          );

          if (current.position < previous.position) {
            summaryParts.push(`Average position improved to ${formatPosition(current.position)}.`);
          } else if (current.position > previous.position) {
            summaryParts.push(`Average position slipped to ${formatPosition(current.position)}.`);
          } else {
            summaryParts.push(`Average position held steady at ${formatPosition(current.position)}.`);
          }
        }

        if (quickWinsResult.ok && quickWinsResult.data.length > 0) {
          summaryParts.push(
            `${quickWinsResult.data.length} quick-win opportunit${quickWinsResult.data.length === 1 ? 'y was' : 'ies were'} identified for immediate action.`,
          );
        }

        // Insert executive summary near the top (after the header section)
        const execSummary = [
          `## Executive Summary`,
          '',
          summaryParts.length > 0
            ? summaryParts.join(' ')
            : 'Insufficient data to generate an executive summary for this period.',
          '',
        ];

        // Find the position after '---' to insert executive summary
        const hrIndex = sections.indexOf('---');
        if (hrIndex !== -1) {
          sections.splice(hrIndex + 1, 0, ...execSummary);
        }

        // ── Section 7: Prioritized Recommendations ──────────────────────
        const recsResult = await safeSection('Recommendations', async () => {
          // Gather all available data for the recommendation engine
          const reportData: {
            currentTotals?: PerformanceTotals;
            previousTotals?: PerformanceTotals;
            queryRows?: SearchAnalyticsRow[];
            sitemaps?: SitemapInfo[];
            quickWins?: Array<{ query: string; reason: string; score: number }>;
          } = {};

          if (perfResult.ok) {
            reportData.currentTotals = perfResult.data.current;
            reportData.previousTotals = perfResult.data.previous;
          }
          if (queryDataResult.ok) {
            reportData.queryRows = queryDataResult.data.currentQueryRows;
          }
          if (sitemapResult.ok) {
            reportData.sitemaps = sitemapResult.data;
          }
          if (quickWinsResult.ok) {
            reportData.quickWins = quickWinsResult.data;
          }

          const recommendations = generateRecommendations({ rows: [], ...reportData });
          return recommendations;
        });

        sections.push(`## Prioritized Recommendations`);
        if (recsResult.ok) {
          const recs = recsResult.data as Array<{ priority: string; title: string; description: string; impact: string }>;
          if (recs.length > 0) {
            sections.push('');
            const topRecs = recs.slice(0, 5);
            topRecs.forEach((rec, i) => {
              const priorityBadge =
                rec.priority === 'critical' ? '**[CRITICAL]**' :
                rec.priority === 'high' ? '**[HIGH]**' :
                rec.priority === 'medium' ? '[MEDIUM]' : '[LOW]';
              sections.push(`${i + 1}. ${priorityBadge} **${rec.title}**  `);
              sections.push(`   ${rec.description}  `);
              sections.push(`   _Estimated impact: ${rec.impact}_  `);
              sections.push('');
            });
          } else {
            sections.push('_No specific recommendations at this time. Keep up the good work!_');
          }
        } else {
          sections.push(recsResult.error);
        }
        sections.push('');

        // ── Footer ──────────────────────────────────────────────────────
        sections.push('---');
        sections.push(
          '_This report was generated automatically from Google Search Console data. '
          + 'Metrics may differ slightly from the GSC UI due to data sampling and processing delays._',
        );

        const report = sections.join('\n');
        return { content: [{ type: 'text' as const, text: report }] };
      } catch (error) {
        return errorResponse(error);
      }
    },
  );

  // ========================================================================
  // Tool 2: seo_health_check
  // ========================================================================

  server.tool(
    'seo_health_check',
    'Run a comprehensive SEO health check with an overall A-F letter grade, sub-scores for traffic trends, CTR efficiency, position distribution, and sitemap health, plus prioritized recommendations',
    {
      siteUrl: siteUrlSchema,
      searchType: searchTypeSchema,
    },
    async ({ siteUrl, searchType }) => {
      try {
        const type = (searchType ?? 'web') as SearchType;
        const sections: string[] = [];
        const issues: Array<{ severity: 'critical' | 'high' | 'medium' | 'low'; message: string }> = [];

        const dateRange28d = getDateRange('last28d');

        // ── Score 1: Traffic Trend (0-100, weight: 30%) ─────────────────
        let trafficScore = 50; // default if section fails
        const trafficResult = await safeSection('Traffic Trend', async () => {
          const res = await api.querySearchAnalytics(buildRequest(
            siteUrl, dateRange28d.startDate, dateRange28d.endDate, type, ['date'], 28,
          ));

          const trendPoints: TrendPoint[] = res.rows.map((row) => ({
            date: row.keys[0]!,
            value: row.clicks,
          }));

          const trend = detectTrend(trendPoints);
          return trend;
        });

        if (trafficResult.ok) {
          const trend = trafficResult.data;
          const pctChange = trend.percentChange;

          if (pctChange > 5) {
            trafficScore = 100;
          } else if (pctChange >= -2 && pctChange <= 5) {
            trafficScore = 80;
          } else if (pctChange >= -10 && pctChange < -2) {
            trafficScore = 60;
          } else if (pctChange >= -25 && pctChange < -10) {
            trafficScore = 40;
          } else {
            trafficScore = 20;
          }

          if (trafficScore <= 60) {
            issues.push({
              severity: trafficScore <= 40 ? 'critical' : 'high',
              message: `Traffic is ${trend.direction} (${pctChange >= 0 ? '+' : ''}${pctChange.toFixed(1)}% over 28 days). ${trend.summary}`,
            });
          }
          if (trend.breakpoints.length > 0) {
            const bp = trend.breakpoints[0]!;
            issues.push({
              severity: 'medium',
              message: `Sudden traffic ${bp.direction === 'up' ? 'spike' : 'drop'} detected on ${bp.date} (${bp.changePercent.toFixed(1)}% change). Investigate potential algorithm update or site change.`,
            });
          }
        } else {
          issues.push({
            severity: 'medium',
            message: 'Could not analyze traffic trends. Ensure search analytics data is available for the last 28 days.',
          });
        }

        // ── Score 2: CTR Efficiency (0-100, weight: 25%) ────────────────
        let ctrScore = 50; // default
        const ctrResult = await safeSection('CTR Efficiency', async () => {
          const res = await api.querySearchAnalytics(buildRequest(
            siteUrl, dateRange28d.startDate, dateRange28d.endDate, type, ['query'], 100,
          ));
          return res.rows;
        });

        if (ctrResult.ok) {
          const queryRows = ctrResult.data;
          if (queryRows.length > 0) {
            let atOrAboveBenchmark = 0;
            let belowBenchmarkBadly = 0;

            for (const row of queryRows) {
              const analysis = analyzeCtr(row.position, row.ctr);
              if (analysis.ctrRatio >= 0.8) {
                atOrAboveBenchmark++;
              }
              if (analysis.performance === 'poor') {
                belowBenchmarkBadly++;
              }
            }

            ctrScore = Math.round((atOrAboveBenchmark / queryRows.length) * 100);

            if (belowBenchmarkBadly > queryRows.length * 0.3) {
              issues.push({
                severity: 'high',
                message: `${belowBenchmarkBadly} of your top ${queryRows.length} queries have CTR significantly below benchmark. Consider improving title tags and meta descriptions.`,
              });
            } else if (ctrScore < 50) {
              issues.push({
                severity: 'medium',
                message: `CTR efficiency is at ${ctrScore}%. Many queries underperform their position benchmarks.`,
              });
            }
          }
        } else {
          issues.push({
            severity: 'medium',
            message: 'Could not analyze CTR efficiency. Ensure query data is available.',
          });
        }

        // ── Score 3: Position Distribution (0-100, weight: 25%) ─────────
        let positionScore = 50; // default
        const positionResult = await safeSection('Position Distribution', async () => {
          const res = await api.querySearchAnalytics(buildRequest(
            siteUrl, dateRange28d.startDate, dateRange28d.endDate, type, ['query'], 5000,
          ));
          return res.rows;
        });

        if (positionResult.ok) {
          const allRows = positionResult.data;
          if (allRows.length > 0) {
            const total = allRows.length;
            const pos1to3 = allRows.filter((r) => r.position <= 3).length;
            const pos4to10 = allRows.filter((r) => r.position > 3 && r.position <= 10).length;
            const pos11to20 = allRows.filter((r) => r.position > 10 && r.position <= 20).length;
            const pos20plus = allRows.filter((r) => r.position > 20).length;

            // Weighted: pos 1-3 = 100 pts, pos 4-10 = 70 pts, pos 11-20 = 30 pts, 20+ = 0 pts
            positionScore = Math.round(
              ((pos1to3 * 100 + pos4to10 * 70 + pos11to20 * 30 + pos20plus * 0) / total),
            );

            if (pos20plus > total * 0.5) {
              issues.push({
                severity: 'high',
                message: `${formatPercent(pos20plus / total, 0)} of queries rank beyond position 20. Focus content improvement efforts on these buried pages.`,
              });
            }
            if (pos1to3 < total * 0.05) {
              issues.push({
                severity: 'medium',
                message: `Only ${formatPercent(pos1to3 / total, 0)} of queries rank in positions 1-3. Work on improving top-ranking content authority.`,
              });
            }
          }
        } else {
          issues.push({
            severity: 'medium',
            message: 'Could not analyze position distribution. Ensure query data is available.',
          });
        }

        // ── Score 4: Sitemap Health (0-100, weight: 20%) ────────────────
        let sitemapScore = 50; // default
        const sitemapResult = await safeSection('Sitemap Health', async () => {
          const sitemaps = await api.listSitemaps(siteUrl);
          return sitemaps;
        });

        if (sitemapResult.ok) {
          const sitemaps = sitemapResult.data;

          if (sitemaps.length === 0) {
            sitemapScore = 0;
            issues.push({
              severity: 'critical',
              message: 'No sitemaps submitted. Submit a sitemap to help Google discover and crawl your pages efficiently.',
            });
          } else {
            sitemapScore = 100;

            const errorSitemaps = sitemaps.filter((s) => s.errors);
            const warningSitemaps = sitemaps.filter((s) => s.warnings);
            const pendingSitemaps = sitemaps.filter((s) => s.isPending);

            // Deduct for errors (most severe)
            if (errorSitemaps.length > 0) {
              sitemapScore -= Math.min(40, errorSitemaps.length * 20);
              issues.push({
                severity: 'critical',
                message: `${errorSitemaps.length} sitemap${errorSitemaps.length > 1 ? 's' : ''} ha${errorSitemaps.length > 1 ? 've' : 's'} errors: ${errorSitemaps.map((s) => s.path).join(', ')}`,
              });
            }

            // Deduct for warnings
            if (warningSitemaps.length > 0) {
              sitemapScore -= Math.min(20, warningSitemaps.length * 10);
              issues.push({
                severity: 'high',
                message: `${warningSitemaps.length} sitemap${warningSitemaps.length > 1 ? 's' : ''} ha${warningSitemaps.length > 1 ? 've' : 's'} warnings: ${warningSitemaps.map((s) => s.path).join(', ')}`,
              });
            }

            // Deduct for pending
            if (pendingSitemaps.length > 0) {
              sitemapScore -= Math.min(10, pendingSitemaps.length * 5);
            }

            // Check recency of submission
            const hasRecentSubmission = sitemaps.some((s) => {
              if (!s.lastSubmitted) return false;
              try {
                return daysBetween(s.lastSubmitted.split('T')[0]!, formatDate(new Date())) <= 30;
              } catch {
                return false;
              }
            });

            if (!hasRecentSubmission) {
              sitemapScore -= 15;
              issues.push({
                severity: 'low',
                message: 'No sitemaps have been submitted in the last 30 days. Consider resubmitting to signal fresh content.',
              });
            }

            sitemapScore = Math.max(0, sitemapScore);
          }
        } else {
          issues.push({
            severity: 'medium',
            message: 'Could not check sitemap health.',
          });
        }

        // ── Overall Grade Calculation ───────────────────────────────────
        const overallScore = Math.round(
          trafficScore * 0.30 +
          ctrScore * 0.25 +
          positionScore * 0.25 +
          sitemapScore * 0.20,
        );

        const grade =
          overallScore >= 90 ? 'A' :
          overallScore >= 75 ? 'B' :
          overallScore >= 60 ? 'C' :
          overallScore >= 40 ? 'D' : 'F';

        const gradeDescription: Record<string, string> = {
          A: 'Excellent -- Your site is performing very well across all SEO dimensions.',
          B: 'Good -- Strong performance with a few areas for improvement.',
          C: 'Fair -- Several areas need attention to improve organic performance.',
          D: 'Needs Work -- Significant issues are holding back your organic performance.',
          F: 'Critical -- Urgent action is needed to address fundamental SEO issues.',
        };

        // ── Assemble Report ─────────────────────────────────────────────

        // Header
        sections.push(`# SEO Health Check`);
        sections.push(`**Property:** ${siteUrl}  `);
        sections.push(`**Analysis period:** ${dateRange28d.startDate} to ${dateRange28d.endDate}  `);
        sections.push(`**Search type:** ${type}  `);
        sections.push(`**Generated:** ${reportTimestamp()}`);
        sections.push('');
        sections.push('---');
        sections.push('');

        // Grade card
        sections.push(`## Overall Grade: ${grade}`);
        sections.push('');
        sections.push(`**Score: ${overallScore}/100**  `);
        sections.push(gradeDescription[grade]!);
        sections.push('');

        // Sub-scores
        sections.push(`### Score Breakdown`);
        sections.push('');
        sections.push('| Category | Score | Weight | Status |');
        sections.push('| --- | ---: | ---: | --- |');

        const scoreStatus = (score: number): string => {
          if (score >= 80) return 'Healthy';
          if (score >= 60) return 'Fair';
          if (score >= 40) return 'Needs Attention';
          return 'Critical';
        };

        const scoreIndicator = (score: number): string => {
          if (score >= 80) return `${score} ✓`;
          if (score >= 60) return `${score} ~`;
          return `${score} ✗`;
        };

        sections.push(`| **Traffic Trend** | ${scoreIndicator(trafficScore)} | 30% | ${scoreStatus(trafficScore)} |`);
        sections.push(`| **CTR Efficiency** | ${scoreIndicator(ctrScore)} | 25% | ${scoreStatus(ctrScore)} |`);
        sections.push(`| **Position Distribution** | ${scoreIndicator(positionScore)} | 25% | ${scoreStatus(positionScore)} |`);
        sections.push(`| **Sitemap Health** | ${scoreIndicator(sitemapScore)} | 20% | ${scoreStatus(sitemapScore)} |`);
        sections.push('');

        // ── Detailed Findings ───────────────────────────────────────────
        sections.push(`### Detailed Findings`);
        sections.push('');

        // Traffic Trend details
        sections.push(`#### Traffic Trend (Score: ${trafficScore}/100)`);
        if (trafficResult.ok) {
          const trend = trafficResult.data;
          sections.push(`- Direction: **${trend.direction}** (${trend.percentChange >= 0 ? '+' : ''}${trend.percentChange.toFixed(1)}% over 28 days)`);
          sections.push(`- Confidence: ${formatPercent(trend.confidence, 0)}`);
          sections.push(`- Volatility: ${trend.volatility < 0.2 ? 'Low' : trend.volatility < 0.5 ? 'Moderate' : 'High'}`);
          if (trend.breakpoints.length > 0) {
            sections.push(`- Breakpoints detected:`);
            for (const bp of trend.breakpoints.slice(0, 3)) {
              sections.push(`  - ${bp.date}: ${bp.direction === 'up' ? 'Spike' : 'Drop'} of ${bp.changePercent.toFixed(1)}%`);
            }
          }
        } else {
          sections.push(`- ${trafficResult.error}`);
        }
        sections.push('');

        // CTR Efficiency details
        sections.push(`#### CTR Efficiency (Score: ${ctrScore}/100)`);
        if (ctrResult.ok && ctrResult.data.length > 0) {
          const rows = ctrResult.data;
          const analyses = rows.map((r) => analyzeCtr(r.position, r.ctr));
          const excellent = analyses.filter((a) => a.performance === 'excellent').length;
          const good = analyses.filter((a) => a.performance === 'good').length;
          const avg = analyses.filter((a) => a.performance === 'average').length;
          const belowAvg = analyses.filter((a) => a.performance === 'below_average').length;
          const poor = analyses.filter((a) => a.performance === 'poor').length;

          sections.push(`- Analyzed top ${rows.length} queries against CTR benchmarks:`);
          sections.push(`  - Excellent (>150% of benchmark): ${excellent}`);
          sections.push(`  - Good (>110%): ${good}`);
          sections.push(`  - Average (>80%): ${avg}`);
          sections.push(`  - Below average (>50%): ${belowAvg}`);
          sections.push(`  - Poor (<50%): ${poor}`);

          // Show top underperformers
          const underperformers = rows
            .map((r, i) => ({ query: r.keys[0]!, ...analyses[i]!, impressions: r.impressions }))
            .filter((a) => a.performance === 'poor' && a.impressions > 10)
            .sort((a, b) => b.impressions - a.impressions)
            .slice(0, 3);

          if (underperformers.length > 0) {
            sections.push(`- Top CTR underperformers (high-impression, poor CTR):`);
            for (const u of underperformers) {
              sections.push(`  - "${u.query}": CTR ${formatPercent(u.actualCtr)} vs expected ${formatPercent(u.expectedCtr)} at pos ${formatPosition(u.position)}`);
            }
          }
        } else if (ctrResult.ok) {
          sections.push('- No query data available for CTR analysis.');
        } else {
          sections.push(`- ${ctrResult.error}`);
        }
        sections.push('');

        // Position Distribution details
        sections.push(`#### Position Distribution (Score: ${positionScore}/100)`);
        if (positionResult.ok && positionResult.data.length > 0) {
          const allRows = positionResult.data;
          const total = allRows.length;
          const pos1to3 = allRows.filter((r) => r.position <= 3).length;
          const pos4to10 = allRows.filter((r) => r.position > 3 && r.position <= 10).length;
          const pos11to20 = allRows.filter((r) => r.position > 10 && r.position <= 20).length;
          const pos20plus = allRows.filter((r) => r.position > 20).length;

          sections.push(`- Total queries analyzed: ${formatNumber(total)}`);
          sections.push(`- Positions 1-3 (top results): ${formatNumber(pos1to3)} (${formatPercent(pos1to3 / total, 1)})`);
          sections.push(`- Positions 4-10 (page 1): ${formatNumber(pos4to10)} (${formatPercent(pos4to10 / total, 1)})`);
          sections.push(`- Positions 11-20 (page 2): ${formatNumber(pos11to20)} (${formatPercent(pos11to20 / total, 1)})`);
          sections.push(`- Positions 20+ (buried): ${formatNumber(pos20plus)} (${formatPercent(pos20plus / total, 1)})`);
        } else if (positionResult.ok) {
          sections.push('- No query data available for position analysis.');
        } else {
          sections.push(`- ${positionResult.error}`);
        }
        sections.push('');

        // Sitemap Health details
        sections.push(`#### Sitemap Health (Score: ${sitemapScore}/100)`);
        if (sitemapResult.ok) {
          const sitemaps = sitemapResult.data;
          if (sitemaps.length === 0) {
            sections.push('- No sitemaps found. This is a critical gap in your SEO foundation.');
          } else {
            const totalUrls = sitemaps.reduce((total, sm) => {
              if (!sm.contents) return total;
              return total + sm.contents.reduce((sum, c) => sum + parseInt(c.submitted ?? '0', 10), 0);
            }, 0);
            sections.push(`- ${sitemaps.length} sitemap${sitemaps.length > 1 ? 's' : ''} submitted`);
            sections.push(`- ${formatNumber(totalUrls)} total URLs in sitemaps`);

            const errorCount = sitemaps.filter((s) => s.errors).length;
            const warningCount = sitemaps.filter((s) => s.warnings).length;
            if (errorCount > 0) sections.push(`- ${errorCount} sitemap${errorCount > 1 ? 's' : ''} with errors`);
            if (warningCount > 0) sections.push(`- ${warningCount} sitemap${warningCount > 1 ? 's' : ''} with warnings`);
            if (errorCount === 0 && warningCount === 0) sections.push('- No errors or warnings detected');
          }
        } else {
          sections.push(`- ${sitemapResult.error}`);
        }
        sections.push('');

        // ── Top Issues ──────────────────────────────────────────────────
        sections.push(`### Top Issues`);
        sections.push('');

        if (issues.length > 0) {
          // Sort by severity
          const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
          issues.sort((a, b) => severityOrder[a.severity]! - severityOrder[b.severity]!);

          for (const issue of issues) {
            const indicator =
              issue.severity === 'critical' ? '✗ **CRITICAL:**' :
              issue.severity === 'high' ? '✗ **HIGH:**' :
              issue.severity === 'medium' ? '~ **MEDIUM:**' :
              '**LOW:**';
            sections.push(`- ${indicator} ${issue.message}`);
          }
        } else {
          sections.push('No significant issues detected. Your site is in good shape.');
        }
        sections.push('');

        // ── Prioritized Recommendations ─────────────────────────────────
        const recsResult = await safeSection('Recommendations', async () => {
          const reportData: {
            trafficTrend?: ReturnType<typeof detectTrend>;
            queryRows?: SearchAnalyticsRow[];
            sitemaps?: SitemapInfo[];
            issues?: typeof issues;
          } = {};

          if (trafficResult.ok) reportData.trafficTrend = trafficResult.data;
          if (ctrResult.ok) reportData.queryRows = ctrResult.data;
          if (sitemapResult.ok) reportData.sitemaps = sitemapResult.data;
          reportData.issues = issues;

          return generateRecommendations({ rows: [] });
        });

        sections.push(`### Top 5 Recommendations`);
        sections.push('');

        if (recsResult.ok) {
          const recs = recsResult.data as Array<{ priority: string; title: string; description: string; impact: string }>;
          if (recs.length > 0) {
            const topRecs = recs.slice(0, 5);
            topRecs.forEach((rec, i) => {
              const priorityBadge =
                rec.priority === 'critical' ? '**[CRITICAL]**' :
                rec.priority === 'high' ? '**[HIGH]**' :
                rec.priority === 'medium' ? '[MEDIUM]' : '[LOW]';
              sections.push(`${i + 1}. ${priorityBadge} **${rec.title}**  `);
              sections.push(`   ${rec.description}  `);
              sections.push(`   _Estimated impact: ${rec.impact}_  `);
              sections.push('');
            });
          } else {
            sections.push('No specific recommendations at this time.');
          }
        } else {
          sections.push(recsResult.error);
        }

        // ── Footer ──────────────────────────────────────────────────────
        sections.push('---');
        sections.push(
          '_This health check was generated automatically from Google Search Console data. '
          + 'Scores are based on industry benchmarks and may not reflect all nuances of your specific vertical._',
        );

        const report = sections.join('\n');
        return { content: [{ type: 'text' as const, text: report }] };
      } catch (error) {
        return errorResponse(error);
      }
    },
  );
}
