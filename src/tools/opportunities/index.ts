/**
 * Opportunity Tools -- the flagship differentiator of this MCP server.
 *
 * Five high-value tools that transform raw GSC data into actionable SEO
 * opportunities. Each tool fetches data, runs analysis, scores results,
 * and returns rich markdown with specific, prioritized recommendations.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { GscApiClient } from '../../api/client.js';
import type { SearchAnalyticsRow, SearchAnalyticsRequest } from '../../api/types.js';
import { getExpectedCtr, analyzeCtr } from '../../analysis/ctr-benchmarks.js';
import { detectTrend, type TrendPoint } from '../../analysis/trend-detector.js';
import { classifyQuery, classifyQueries } from '../../analysis/query-classifier.js';
import { getDateRange, getPreviousPeriod, type DatePeriod } from '../../utils/date-helpers.js';
import { formatNumber, formatPercent, formatPosition, formatChange } from '../../utils/formatting.js';
import { siteUrlSchema, periodSchema, searchTypeSchema } from '../schemas.js';
import { GscError } from '../../errors/gsc-error.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Safely extract a key from a SearchAnalyticsRow, defaulting to empty string.
 */
function key(row: SearchAnalyticsRow, index: number): string {
  return row.keys[index] ?? '';
}

const SHARED_LIMITATIONS = [
  'Analysis based on sampled data from Google Search Console. Actual traffic may vary.',
  'GSC data is typically delayed by 2-3 days. Very recent changes may not be reflected.',
  'Position values are averages and may not reflect the actual position for every query.',
];

function errorResponse(error: unknown) {
  const message =
    error instanceof GscError
      ? `${error.message}${error.recoveryHint ? `\n\nHint: ${error.recoveryHint}` : ''}`
      : error instanceof Error
        ? error.message
        : 'An unexpected error occurred.';

  return {
    content: [{ type: 'text' as const, text: `**Error:** ${message}` }],
    isError: true,
  };
}

/**
 * Scores an opportunity based on traffic impact potential.
 * Higher scores = more valuable to act on.
 */
function scoreOpportunity(opts: {
  impressions: number;
  currentCtr: number;
  expectedCtr: number;
  position: number;
  clicks: number;
}): number {
  const { impressions, currentCtr, expectedCtr, position, clicks } = opts;

  // Potential additional clicks if CTR matched the benchmark
  const ctrGap = Math.max(0, expectedCtr - currentCtr);
  const additionalClicks = impressions * ctrGap;

  // Position proximity bonus: positions closer to #1 are more valuable
  const positionMultiplier = position <= 3 ? 2.0
    : position <= 5 ? 1.5
    : position <= 10 ? 1.2
    : position <= 20 ? 0.8
    : 0.4;

  // Volume bonus: higher impression queries are more impactful
  const volumeMultiplier = Math.log10(Math.max(impressions, 1) + 1);

  return Math.round(additionalClicks * positionMultiplier * volumeMultiplier);
}

/**
 * Truncates a URL for display in markdown tables.
 */
function truncateUrl(url: string, maxLen: number = 60): string {
  if (url.length <= maxLen) return url;
  try {
    const parsed = new URL(url);
    const path = parsed.pathname + parsed.search;
    if (path.length > maxLen - 3) {
      return path.slice(0, maxLen - 3) + '...';
    }
    return path;
  } catch {
    return url.slice(0, maxLen - 3) + '...';
  }
}

/**
 * Truncates a query string for display in markdown tables.
 */
function truncateQuery(query: string, maxLen: number = 50): string {
  if (query.length <= maxLen) return query;
  return query.slice(0, maxLen - 3) + '...';
}

/**
 * Resolves a period string to a date range.
 */
function resolveDateRange(period: DatePeriod) {
  return getDateRange(period);
}

/**
 * Builds a standard SearchAnalyticsRequest.
 */
function buildRequest(opts: {
  siteUrl: string;
  startDate: string;
  endDate: string;
  dimensions: SearchAnalyticsRequest['dimensions'];
  searchType?: string;
  rowLimit?: number;
}): SearchAnalyticsRequest {
  const req: SearchAnalyticsRequest = {
    siteUrl: opts.siteUrl,
    startDate: opts.startDate,
    endDate: opts.endDate,
    dimensions: opts.dimensions,
    rowLimit: opts.rowLimit ?? 25000,
  };
  if (opts.searchType) {
    req.searchType = opts.searchType as SearchAnalyticsRequest['searchType'];
  }
  return req;
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerOpportunityTools(server: McpServer, api: GscApiClient): void {

  // =========================================================================
  // Tool 1: find_quick_wins
  // =========================================================================
  server.tool(
    'find_quick_wins',
    'Find "money on the table" SEO opportunities: pages ranking well but underperforming on clicks, pages almost on page 1, and positions where a small push yields big gains',
    {
      siteUrl: siteUrlSchema,
      period: periodSchema.default('last28d'),
      searchType: searchTypeSchema.optional(),
      minImpressions: z.number().min(0).default(100).describe('Minimum impressions to consider a query'),
    },
    async ({ siteUrl, period, searchType, minImpressions }) => {
      try {
        const dateRange = resolveDateRange(period as DatePeriod);
        const request = buildRequest({
          siteUrl,
          ...dateRange,
          dimensions: ['query', 'page'],
          searchType,
        });

        const response = await api.querySearchAnalytics(request);
        const rows = response.rows.filter((r) => r.impressions >= minImpressions);

        if (rows.length === 0) {
          return {
            content: [{
              type: 'text' as const,
              text: `No data found for **${siteUrl}** in the selected period with at least ${formatNumber(minImpressions)} impressions. Try lowering the \`minImpressions\` threshold or expanding the period.`,
            }],
          };
        }

        // ── Category A: CTR opportunities (Position 1-3, CTR below expected) ──
        const ctrOpportunities = rows
          .filter((r) => r.position <= 3 && r.position >= 1)
          .map((r) => {
            const expected = getExpectedCtr(r.position);
            const ctrRatio = expected > 0 ? r.ctr / expected : 1;
            const additionalClicks = Math.round(r.impressions * Math.max(0, expected - r.ctr));
            return { ...r, expected, ctrRatio, additionalClicks, category: 'ctr' as const };
          })
          .filter((r) => r.ctrRatio < 0.8) // CTR is 20%+ below expected
          .sort((a, b) => b.additionalClicks - a.additionalClicks);

        // ── Category B: Almost page 1 (Position 8-20, high impressions) ──
        const almostPage1 = rows
          .filter((r) => r.position >= 8 && r.position <= 20)
          .map((r) => {
            const expected = getExpectedCtr(r.position);
            // Estimate value if they moved to position 5
            const targetCtr = getExpectedCtr(5);
            const additionalClicks = Math.round(r.impressions * Math.max(0, targetCtr - r.ctr));
            return { ...r, expected, additionalClicks, category: 'almost_page1' as const };
          })
          .sort((a, b) => b.additionalClicks - a.additionalClicks);

        // ── Category C: Quick position gains (Position 4-10) ──
        const quickGains = rows
          .filter((r) => r.position >= 4 && r.position <= 10)
          .map((r) => {
            const expected = getExpectedCtr(r.position);
            // Estimate value if they moved up 2-3 positions
            const targetPosition = Math.max(1, Math.round(r.position) - 2);
            const targetCtr = getExpectedCtr(targetPosition);
            const additionalClicks = Math.round(r.impressions * Math.max(0, targetCtr - r.ctr));
            return { ...r, expected, additionalClicks, category: 'quick_gain' as const };
          })
          .sort((a, b) => b.additionalClicks - a.additionalClicks);

        // Score and combine all opportunities
        type QuickWinRow = typeof ctrOpportunities[number] | typeof almostPage1[number] | typeof quickGains[number];
        const allOpportunities: (QuickWinRow & { score: number })[] = [
          ...ctrOpportunities,
          ...almostPage1,
          ...quickGains,
        ].map((r) => ({
          ...r,
          score: scoreOpportunity({
            impressions: r.impressions,
            currentCtr: r.ctr,
            expectedCtr: r.expected,
            position: r.position,
            clicks: r.clicks,
          }),
        }));

        allOpportunities.sort((a, b) => b.score - a.score);
        const topOpportunities = allOpportunities.slice(0, 50);

        // Estimate total additional clicks
        const totalAdditionalClicks = allOpportunities.reduce((sum, r) => sum + r.additionalClicks, 0);

        // Build markdown output
        const parts: string[] = [];
        parts.push(`# Quick Wins for ${siteUrl}\n`);
        parts.push(`**Period:** ${dateRange.startDate} to ${dateRange.endDate} | **Min impressions:** ${formatNumber(minImpressions)}\n`);

        parts.push(`## Summary\n`);
        parts.push(`Found **${formatNumber(allOpportunities.length)} quick wins** that could generate an estimated **${formatNumber(totalAdditionalClicks)} additional clicks/month**.\n`);
        parts.push(`| Category | Count | Est. Additional Clicks |`);
        parts.push(`| --- | ---: | ---: |`);
        parts.push(`| CTR below benchmark (pos 1-3) | ${ctrOpportunities.length} | ${formatNumber(ctrOpportunities.reduce((s, r) => s + r.additionalClicks, 0))} |`);
        parts.push(`| Almost page 1 (pos 8-20) | ${almostPage1.length} | ${formatNumber(almostPage1.reduce((s, r) => s + r.additionalClicks, 0))} |`);
        parts.push(`| Quick position gains (pos 4-10) | ${quickGains.length} | ${formatNumber(quickGains.reduce((s, r) => s + r.additionalClicks, 0))} |`);
        parts.push('');

        // ── CTR Opportunities table ──
        if (ctrOpportunities.length > 0) {
          parts.push(`## CTR Opportunities (Position 1-3, Underperforming CTR)\n`);
          parts.push(`These pages rank in top positions but get fewer clicks than expected. Common causes: poor title tags, missing meta descriptions, rich snippets from competitors.\n`);
          parts.push(`| Query | Page | Pos | Impressions | CTR | Expected CTR | Gap | Est. Clicks |`);
          parts.push(`| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |`);
          for (const r of ctrOpportunities.slice(0, 15)) {
            parts.push(`| ${truncateQuery(key(r, 0))} | ${truncateUrl(key(r, 1))} | ${formatPosition(r.position)} | ${formatNumber(r.impressions)} | ${formatPercent(r.ctr)} | ${formatPercent(r.expected)} | ${formatPercent(r.expected - r.ctr)} | +${formatNumber(r.additionalClicks)} |`);
          }
          parts.push('');
          parts.push(`**Action:** Rewrite title tags and meta descriptions for these pages. Consider adding structured data (FAQ, HowTo, Review) to win rich snippets.\n`);
        }

        // ── Almost Page 1 table ──
        if (almostPage1.length > 0) {
          parts.push(`## Almost Page 1 (Position 8-20)\n`);
          parts.push(`These queries have high visibility potential. Moving them to page 1 (top 5) would significantly increase clicks.\n`);
          parts.push(`| Query | Page | Pos | Impressions | Clicks | If Top 5 |`);
          parts.push(`| --- | --- | ---: | ---: | ---: | ---: |`);
          for (const r of almostPage1.slice(0, 15)) {
            parts.push(`| ${truncateQuery(key(r, 0))} | ${truncateUrl(key(r, 1))} | ${formatPosition(r.position)} | ${formatNumber(r.impressions)} | ${formatNumber(r.clicks)} | +${formatNumber(r.additionalClicks)} |`);
          }
          parts.push('');
          parts.push(`**Action:** Strengthen content depth, add internal links, improve page experience, and build topical authority for these queries.\n`);
        }

        // ── Quick Gains table ──
        if (quickGains.length > 0) {
          parts.push(`## Quick Position Gains (Position 4-10)\n`);
          parts.push(`Already visible, a small ranking improvement yields disproportionate click gains due to the steep CTR curve.\n`);
          parts.push(`| Query | Page | Pos | Impressions | Clicks | If +2 Pos |`);
          parts.push(`| --- | --- | ---: | ---: | ---: | ---: |`);
          for (const r of quickGains.slice(0, 15)) {
            parts.push(`| ${truncateQuery(key(r, 0))} | ${truncateUrl(key(r, 1))} | ${formatPosition(r.position)} | ${formatNumber(r.impressions)} | ${formatNumber(r.clicks)} | +${formatNumber(r.additionalClicks)} |`);
          }
          parts.push('');
          parts.push(`**Action:** Optimize on-page SEO, add semantically related content, improve internal linking, and ensure fast Core Web Vitals.\n`);
        }

        // ── Recommendations ──
        parts.push(`## Recommendations\n`);
        parts.push(`1. **Start with CTR opportunities** -- these are the fastest wins. Rewriting title tags takes minutes and can increase clicks immediately.`);
        parts.push(`2. **Prioritize high-impression "almost page 1" queries** -- these represent the largest untapped traffic pools.`);
        parts.push(`3. **Group related queries** and optimize the target page holistically rather than keyword-by-keyword.`);
        parts.push(`4. **Monitor changes** -- re-run this analysis in 2-4 weeks to measure the impact of your optimizations.`);
        parts.push('');

        // ── Limitations ──
        parts.push(`## Limitations\n`);
        for (const limitation of SHARED_LIMITATIONS) {
          parts.push(`- ${limitation}`);
        }
        parts.push(`- "Additional clicks" estimates assume CTR would match industry benchmarks; actual results depend on SERP features, competition, and user intent.`);

        return { content: [{ type: 'text' as const, text: parts.join('\n') }] };
      } catch (error) {
        return errorResponse(error);
      }
    },
  );

  // =========================================================================
  // Tool 2: find_declining_content
  // =========================================================================
  server.tool(
    'find_declining_content',
    'Find pages and queries losing traffic: compares current vs previous period to surface content that needs attention before it drops further',
    {
      siteUrl: siteUrlSchema,
      period: periodSchema.default('last28d'),
      searchType: searchTypeSchema.optional(),
      minClicksInPrevious: z.number().min(0).default(10).describe('Minimum clicks in the previous period to consider a page'),
    },
    async ({ siteUrl, period, searchType, minClicksInPrevious }) => {
      try {
        const currentRange = resolveDateRange(period as DatePeriod);
        const previousRange = getPreviousPeriod(currentRange.startDate, currentRange.endDate);

        // Fetch current and previous period data in parallel
        const [currentResponse, previousResponse] = await Promise.all([
          api.querySearchAnalytics(buildRequest({
            siteUrl,
            ...currentRange,
            dimensions: ['page'],
            searchType,
          })),
          api.querySearchAnalytics(buildRequest({
            siteUrl,
            ...previousRange,
            dimensions: ['page'],
            searchType,
          })),
        ]);

        // Index previous period by page URL
        const previousByPage = new Map<string, SearchAnalyticsRow>();
        for (const row of previousResponse.rows) {
          previousByPage.set(key(row, 0), row);
        }

        // Find declining pages
        interface DecliningPage {
          page: string;
          currentClicks: number;
          previousClicks: number;
          clickChange: number;
          clickChangePct: number;
          currentImpressions: number;
          previousImpressions: number;
          currentPosition: number;
          previousPosition: number;
          positionChange: number;
          trafficImpact: number;
        }

        const decliningPages: DecliningPage[] = [];

        for (const current of currentResponse.rows) {
          const page = key(current, 0);
          const previous = previousByPage.get(page);

          if (!previous || previous.clicks < minClicksInPrevious) continue;

          const clickChangePct = previous.clicks > 0
            ? ((current.clicks - previous.clicks) / previous.clicks) * 100
            : 0;

          // Only include pages with >20% decline
          if (clickChangePct >= -20) continue;

          const lostClicks = previous.clicks - current.clicks;

          decliningPages.push({
            page,
            currentClicks: current.clicks,
            previousClicks: previous.clicks,
            clickChange: current.clicks - previous.clicks,
            clickChangePct,
            currentImpressions: current.impressions,
            previousImpressions: previous.impressions,
            currentPosition: current.position,
            previousPosition: previous.position,
            positionChange: current.position - previous.position, // positive = worse
            trafficImpact: lostClicks,
          });
        }

        // Sort by traffic impact (most lost clicks first)
        decliningPages.sort((a, b) => b.trafficImpact - a.trafficImpact);

        if (decliningPages.length === 0) {
          return {
            content: [{
              type: 'text' as const,
              text: `No significantly declining pages found for **${siteUrl}**. All pages with at least ${minClicksInPrevious} clicks in the previous period maintained or grew their traffic. This is a good sign.`,
            }],
          };
        }

        const totalLostClicks = decliningPages.reduce((sum, p) => sum + p.trafficImpact, 0);
        const topDecliners = decliningPages.slice(0, 30);

        // Categorize declines
        const positionDrops = decliningPages.filter((p) => p.positionChange > 2);
        const ctrDrops = decliningPages.filter((p) => p.positionChange <= 2 && p.positionChange >= -2);
        const impressionDrops = decliningPages.filter((p) => p.currentImpressions < p.previousImpressions * 0.7);

        // Build markdown
        const parts: string[] = [];
        parts.push(`# Declining Content for ${siteUrl}\n`);
        parts.push(`**Current period:** ${currentRange.startDate} to ${currentRange.endDate}`);
        parts.push(`**Previous period:** ${previousRange.startDate} to ${previousRange.endDate}`);
        parts.push(`**Min clicks filter:** ${minClicksInPrevious}\n`);

        parts.push(`## Summary\n`);
        parts.push(`**${formatNumber(decliningPages.length)} pages are declining**, representing **${formatNumber(totalLostClicks)} lost clicks** vs the previous period.\n`);
        parts.push(`| Decline Type | Count | Likely Cause |`);
        parts.push(`| --- | ---: | --- |`);
        parts.push(`| Position dropped (>2 spots) | ${positionDrops.length} | Algorithm update, new competitors, or content freshness |`);
        parts.push(`| CTR dropped (position stable) | ${ctrDrops.length} | SERP feature changes, competitor snippet improvements |`);
        parts.push(`| Impressions dropped (>30%) | ${impressionDrops.length} | Seasonal decline, keyword cannibalization, or indexing issues |`);
        parts.push('');

        // ── Declining pages table ──
        parts.push(`## Top Declining Pages\n`);
        parts.push(`| Page | Prev Clicks | Curr Clicks | Change | Prev Pos | Curr Pos | Pos Change | Lost Clicks |`);
        parts.push(`| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |`);
        for (const p of topDecliners) {
          const posChangeStr = p.positionChange > 0
            ? `+${formatPosition(p.positionChange)} (worse)`
            : p.positionChange < 0
              ? `${formatPosition(p.positionChange)} (better)`
              : '0';
          parts.push(`| ${truncateUrl(p.page)} | ${formatNumber(p.previousClicks)} | ${formatNumber(p.currentClicks)} | ${p.clickChangePct.toFixed(1)}% | ${formatPosition(p.previousPosition)} | ${formatPosition(p.currentPosition)} | ${posChangeStr} | ${formatNumber(p.trafficImpact)} |`);
        }
        parts.push('');

        // ── Diagnosis & actions ──
        parts.push(`## Diagnosis Guide\n`);
        parts.push(`### Pages with Position Drops\n`);
        if (positionDrops.length > 0) {
          parts.push(`These ${positionDrops.length} pages lost ranking positions. Investigate:\n`);
          parts.push(`1. **Content freshness** -- Is the content outdated? Update statistics, dates, and examples.`);
          parts.push(`2. **Competitor analysis** -- Check who ranks above you now. What do they cover that you don't?`);
          parts.push(`3. **Technical issues** -- Verify the page is indexed, loads fast, and has no crawl errors.`);
          parts.push(`4. **Link profile** -- Have you lost any important backlinks recently?\n`);
        }

        parts.push(`### Pages with CTR Drops (Stable Position)\n`);
        if (ctrDrops.length > 0) {
          parts.push(`These ${ctrDrops.length} pages maintained position but get fewer clicks:\n`);
          parts.push(`1. **SERP feature changes** -- New featured snippets, knowledge panels, or "People Also Ask" may be stealing clicks.`);
          parts.push(`2. **Title/description quality** -- A/B test title tags with more compelling language.`);
          parts.push(`3. **Structured data** -- Add or improve schema markup to earn rich snippets.\n`);
        }

        parts.push(`### Pages with Impression Drops\n`);
        if (impressionDrops.length > 0) {
          parts.push(`These ${impressionDrops.length} pages are appearing less often in search results:\n`);
          parts.push(`1. **Seasonality** -- Some topics naturally fluctuate. Check Google Trends for the keywords.`);
          parts.push(`2. **Cannibalization** -- Another page on your site may be competing for the same queries.`);
          parts.push(`3. **Indexing issues** -- Use the URL Inspection tool to verify the page is indexed.\n`);
        }

        // ── Recommendations ──
        parts.push(`## Recommendations\n`);
        parts.push(`1. **Prioritize by traffic impact** -- Focus on pages that lost the most clicks first.`);
        parts.push(`2. **Content refresh** -- Update the top declining pages with fresh data, new sections, and improved formatting.`);
        parts.push(`3. **Monitor recovery** -- After making changes, track these pages for 2-4 weeks to see if traffic recovers.`);
        parts.push(`4. **Check for patterns** -- If many pages declined at the same time, a Google algorithm update may be the cause.`);
        parts.push('');

        // ── Limitations ──
        parts.push(`## Limitations\n`);
        for (const limitation of SHARED_LIMITATIONS) {
          parts.push(`- ${limitation}`);
        }
        parts.push(`- Period-over-period comparison assumes equal-length periods. Seasonal effects are not adjusted for.`);
        parts.push(`- Pages that did not exist in the previous period are excluded from this analysis.`);

        return { content: [{ type: 'text' as const, text: parts.join('\n') }] };
      } catch (error) {
        return errorResponse(error);
      }
    },
  );

  // =========================================================================
  // Tool 3: find_ctr_opportunities
  // =========================================================================
  server.tool(
    'find_ctr_opportunities',
    'Find pages with click-through rates significantly below industry benchmarks for their position, with specific recommendations to improve each one',
    {
      siteUrl: siteUrlSchema,
      period: periodSchema.default('last28d'),
      searchType: searchTypeSchema.optional(),
      minImpressions: z.number().min(0).default(50).describe('Minimum impressions to include a page'),
    },
    async ({ siteUrl, period, searchType, minImpressions }) => {
      try {
        const dateRange = resolveDateRange(period as DatePeriod);
        const request = buildRequest({
          siteUrl,
          ...dateRange,
          dimensions: ['page'],
          searchType,
        });

        const response = await api.querySearchAnalytics(request);
        const rows = response.rows.filter((r) => r.impressions >= minImpressions);

        if (rows.length === 0) {
          return {
            content: [{
              type: 'text' as const,
              text: `No pages found for **${siteUrl}** with at least ${formatNumber(minImpressions)} impressions. Try lowering the threshold.`,
            }],
          };
        }

        // Analyze CTR for each page
        interface CtrOpportunity {
          page: string;
          position: number;
          impressions: number;
          clicks: number;
          actualCtr: number;
          expectedCtr: number;
          ctrGap: number;
          ctrRatio: number;
          additionalClicks: number;
          recommendation: string;
        }

        const opportunities: CtrOpportunity[] = [];

        for (const row of rows) {
          const analysis = analyzeCtr(row.position, row.ctr);

          // Filter: CTR ratio below 0.7 (performing 30%+ below benchmark)
          if (analysis.ctrRatio >= 0.7) continue;

          const additionalClicks = Math.round(row.impressions * Math.max(0, analysis.expectedCtr - row.ctr));

          // Position-specific recommendations
          let recommendation: string;
          const roundedPos = Math.round(row.position);
          if (roundedPos <= 3) {
            recommendation = 'Rewrite title tag and meta description. Consider adding structured data for rich snippets (FAQ, HowTo, Review). Test emotional triggers and numbers in titles.';
          } else if (roundedPos <= 7) {
            recommendation = 'Improve title to be more compelling. Add the current year, numbers, or power words ("Ultimate", "Complete", "Proven"). Ensure meta description includes a clear call-to-action.';
          } else if (roundedPos <= 10) {
            recommendation = 'Focus on moving up in position first (improve content quality and depth), then optimize CTR. Add internal links from high-authority pages.';
          } else {
            recommendation = 'Priority should be improving position to page 1. Strengthen content with comprehensive coverage, better internal linking, and building topical authority.';
          }

          opportunities.push({
            page: key(row, 0),
            position: row.position,
            impressions: row.impressions,
            clicks: row.clicks,
            actualCtr: row.ctr,
            expectedCtr: analysis.expectedCtr,
            ctrGap: analysis.ctrGap,
            ctrRatio: analysis.ctrRatio,
            additionalClicks,
            recommendation,
          });
        }

        // Sort by impact: impressions * ctrGap (biggest opportunity first)
        opportunities.sort((a, b) => {
          const impactA = a.impressions * Math.abs(a.ctrGap);
          const impactB = b.impressions * Math.abs(b.ctrGap);
          return impactB - impactA;
        });

        const topOpportunities = opportunities.slice(0, 30);

        if (opportunities.length === 0) {
          return {
            content: [{
              type: 'text' as const,
              text: `All pages for **${siteUrl}** are performing within acceptable CTR ranges for their positions. Your titles and descriptions appear to be well-optimized.`,
            }],
          };
        }

        const totalAdditionalClicks = opportunities.reduce((sum, o) => sum + o.additionalClicks, 0);

        // Group by position range for summary
        const pos1to3 = opportunities.filter((o) => Math.round(o.position) <= 3);
        const pos4to7 = opportunities.filter((o) => Math.round(o.position) >= 4 && Math.round(o.position) <= 7);
        const pos8to10 = opportunities.filter((o) => Math.round(o.position) >= 8 && Math.round(o.position) <= 10);
        const pos11plus = opportunities.filter((o) => Math.round(o.position) >= 11);

        // Build markdown
        const parts: string[] = [];
        parts.push(`# CTR Opportunities for ${siteUrl}\n`);
        parts.push(`**Period:** ${dateRange.startDate} to ${dateRange.endDate} | **Min impressions:** ${formatNumber(minImpressions)}\n`);

        parts.push(`## Summary\n`);
        parts.push(`**${formatNumber(opportunities.length)} pages** have CTR below benchmark. Fixing these could generate **${formatNumber(totalAdditionalClicks)} additional clicks/month**.\n`);
        parts.push(`| Position Range | Pages | Avg CTR | Avg Expected | Avg Gap | Priority |`);
        parts.push(`| --- | ---: | ---: | ---: | ---: | --- |`);

        function avgField(items: CtrOpportunity[], field: 'actualCtr' | 'expectedCtr' | 'ctrGap'): number {
          if (items.length === 0) return 0;
          return items.reduce((s, o) => s + o[field], 0) / items.length;
        }

        if (pos1to3.length > 0) parts.push(`| Position 1-3 | ${pos1to3.length} | ${formatPercent(avgField(pos1to3, 'actualCtr'))} | ${formatPercent(avgField(pos1to3, 'expectedCtr'))} | ${formatPercent(Math.abs(avgField(pos1to3, 'ctrGap')))} | **Highest** -- fix titles/snippets |`);
        if (pos4to7.length > 0) parts.push(`| Position 4-7 | ${pos4to7.length} | ${formatPercent(avgField(pos4to7, 'actualCtr'))} | ${formatPercent(avgField(pos4to7, 'expectedCtr'))} | ${formatPercent(Math.abs(avgField(pos4to7, 'ctrGap')))} | **High** -- improve titles |`);
        if (pos8to10.length > 0) parts.push(`| Position 8-10 | ${pos8to10.length} | ${formatPercent(avgField(pos8to10, 'actualCtr'))} | ${formatPercent(avgField(pos8to10, 'expectedCtr'))} | ${formatPercent(Math.abs(avgField(pos8to10, 'ctrGap')))} | Medium -- improve position first |`);
        if (pos11plus.length > 0) parts.push(`| Position 11+ | ${pos11plus.length} | ${formatPercent(avgField(pos11plus, 'actualCtr'))} | ${formatPercent(avgField(pos11plus, 'expectedCtr'))} | ${formatPercent(Math.abs(avgField(pos11plus, 'ctrGap')))} | Lower -- focus on rankings |`);
        parts.push('');

        // ── Detailed table ──
        parts.push(`## Pages Below CTR Benchmark\n`);
        parts.push(`| Page | Pos | Impressions | Actual CTR | Expected CTR | Gap | Est. Add'l Clicks |`);
        parts.push(`| --- | ---: | ---: | ---: | ---: | ---: | ---: |`);
        for (const o of topOpportunities) {
          parts.push(`| ${truncateUrl(o.page)} | ${formatPosition(o.position)} | ${formatNumber(o.impressions)} | ${formatPercent(o.actualCtr)} | ${formatPercent(o.expectedCtr)} | ${formatPercent(Math.abs(o.ctrGap))} | +${formatNumber(o.additionalClicks)} |`);
        }
        parts.push('');

        // ── Per-page recommendations ──
        parts.push(`## Action Plan by Position\n`);
        if (pos1to3.length > 0) {
          parts.push(`### Position 1-3: Title & Snippet Optimization (${pos1to3.length} pages)\n`);
          parts.push(`These pages rank at the very top but fail to attract clicks. This is usually a **snippet problem**, not a content problem.\n`);
          parts.push(`- **Rewrite title tags** to be more compelling and specific. Use numbers, current year, and emotional triggers.`);
          parts.push(`- **Craft better meta descriptions** with a clear value proposition and call-to-action.`);
          parts.push(`- **Add structured data** (FAQ, HowTo, Review) to earn rich snippets that stand out.`);
          parts.push(`- **Check for SERP cannibalization** -- another result from your site may be splitting clicks.\n`);
        }
        if (pos4to7.length > 0) {
          parts.push(`### Position 4-7: Compelling Titles (${pos4to7.length} pages)\n`);
          parts.push(`- **Make titles irresistible** -- add power words, specificity, and unique angles.`);
          parts.push(`- **Differentiate from competitors** -- look at what titles rank above you and offer something different.`);
          parts.push(`- **Use descriptive URLs** that reinforce the topic.\n`);
        }
        if (pos8to10.length > 0) {
          parts.push(`### Position 8-10: Content Quality First (${pos8to10.length} pages)\n`);
          parts.push(`- **Improve content quality** to move up before optimizing CTR.`);
          parts.push(`- **Add internal links** from high-authority pages.`);
          parts.push(`- **Expand content depth** to better satisfy search intent.\n`);
        }

        // ── Recommendations ──
        parts.push(`## Recommendations\n`);
        parts.push(`1. **Quick wins first** -- Start with position 1-3 pages. Title tag changes can take effect within days.`);
        parts.push(`2. **A/B test titles** -- Try different approaches and monitor CTR changes over 2-4 weeks.`);
        parts.push(`3. **Audit rich snippets** -- Use the URL Inspection tool to check which pages have structured data.`);
        parts.push(`4. **Benchmark against competitors** -- Search your top queries incognito and compare your snippets to theirs.`);
        parts.push('');

        // ── Limitations ──
        parts.push(`## Limitations\n`);
        for (const limitation of SHARED_LIMITATIONS) {
          parts.push(`- ${limitation}`);
        }
        parts.push(`- CTR benchmarks are industry averages. Some queries naturally have lower CTR due to SERP features (maps, images, knowledge panels).`);
        parts.push(`- Branded queries often have higher CTR than benchmarks; non-branded queries may naturally be lower.`);

        return { content: [{ type: 'text' as const, text: parts.join('\n') }] };
      } catch (error) {
        return errorResponse(error);
      }
    },
  );

  // =========================================================================
  // Tool 4: find_content_gaps
  // =========================================================================
  server.tool(
    'find_content_gaps',
    'Discover content creation opportunities: queries ranking on wrong pages, high-impression zero-click queries, new emerging queries, and topics needing dedicated pages',
    {
      siteUrl: siteUrlSchema,
      period: periodSchema.default('last28d'),
      searchType: searchTypeSchema.optional(),
      minImpressions: z.number().min(0).default(20).describe('Minimum impressions to consider a query'),
    },
    async ({ siteUrl, period, searchType, minImpressions }) => {
      try {
        const currentRange = resolveDateRange(period as DatePeriod);
        const previousRange = getPreviousPeriod(currentRange.startDate, currentRange.endDate);

        // Fetch current query+page data and previous query data in parallel
        const [currentResponse, previousQueryResponse] = await Promise.all([
          api.querySearchAnalytics(buildRequest({
            siteUrl,
            ...currentRange,
            dimensions: ['query', 'page'],
            searchType,
          })),
          api.querySearchAnalytics(buildRequest({
            siteUrl,
            ...previousRange,
            dimensions: ['query'],
            searchType,
          })),
        ]);

        const rows = currentResponse.rows.filter((r) => r.impressions >= minImpressions);

        if (rows.length === 0) {
          return {
            content: [{
              type: 'text' as const,
              text: `No query data found for **${siteUrl}** with at least ${formatNumber(minImpressions)} impressions. Try lowering the threshold.`,
            }],
          };
        }

        // Index previous queries for "new query" detection
        const previousQueries = new Set(previousQueryResponse.rows.map((r) => key(r, 0)));

        // Build page-to-queries mapping
        const pageToQueries = new Map<string, typeof rows>();
        const queryToPages = new Map<string, typeof rows>();

        for (const row of rows) {
          const query = key(row, 0);
          const page = key(row, 1);

          if (!pageToQueries.has(page)) pageToQueries.set(page, []);
          pageToQueries.get(page)!.push(row);

          if (!queryToPages.has(query)) queryToPages.set(query, []);
          queryToPages.get(query)!.push(row);
        }

        // Detect homepage URL (heuristic: shortest URL or ends with just /)
        const allPages = [...pageToQueries.keys()];
        const homepageUrl = allPages.find((p) => {
          try {
            const url = new URL(p);
            return url.pathname === '/' || url.pathname === '';
          } catch {
            return false;
          }
        });

        // ── Category A: Homepage ranking queries ──
        interface ContentGap {
          query: string;
          currentPage: string;
          impressions: number;
          clicks: number;
          position: number;
          category: string;
          action: string;
        }

        const homepageGaps: ContentGap[] = [];
        if (homepageUrl) {
          const homepageQueries = pageToQueries.get(homepageUrl) ?? [];
          for (const row of homepageQueries) {
            const query = key(row, 0);
            // Skip branded/navigational queries (likely intended for homepage)
            const classified = classifyQuery(query);
            if (classified.intent === 'navigational') continue;

            homepageGaps.push({
              query,
              currentPage: homepageUrl,
              impressions: row.impressions,
              clicks: row.clicks,
              position: row.position,
              category: 'Homepage ranking',
              action: 'Create a dedicated page targeting this query for better relevance and rankings.',
            });
          }
        }
        homepageGaps.sort((a, b) => b.impressions - a.impressions);

        // ── Category B: High impression / zero click queries ──
        const zeroClickGaps: ContentGap[] = [];
        for (const [query, pages] of queryToPages) {
          const totalClicks = pages.reduce((s, r) => s + r.clicks, 0);
          const totalImpressions = pages.reduce((s, r) => s + r.impressions, 0);
          if (totalClicks === 0 && totalImpressions >= minImpressions) {
            const bestPage = pages.sort((a, b) => b.impressions - a.impressions)[0]!;
            zeroClickGaps.push({
              query,
              currentPage: key(bestPage, 1),
              impressions: totalImpressions,
              clicks: 0,
              position: bestPage.position,
              category: 'Zero clicks',
              action: 'Content exists but does not satisfy this query. Consider creating targeted content or improving the existing page to better match search intent.',
            });
          }
        }
        zeroClickGaps.sort((a, b) => b.impressions - a.impressions);

        // ── Category C: New queries (not in previous period) ──
        const newQueryGaps: ContentGap[] = [];
        for (const [query, pages] of queryToPages) {
          if (!previousQueries.has(query)) {
            const bestPage = pages.sort((a, b) => b.impressions - a.impressions)[0]!;
            const totalImpressions = pages.reduce((s, r) => s + r.impressions, 0);
            newQueryGaps.push({
              query,
              currentPage: key(bestPage, 1),
              impressions: totalImpressions,
              clicks: pages.reduce((s, r) => s + r.clicks, 0),
              position: bestPage.position,
              category: 'New query',
              action: 'Emerging query. If high impressions, create or optimize content to capture this growing interest.',
            });
          }
        }
        newQueryGaps.sort((a, b) => b.impressions - a.impressions);

        // ── Category D: Single-page queries (opportunity for supporting content) ──
        const singlePageGaps: ContentGap[] = [];
        for (const [query, pages] of queryToPages) {
          if (pages.length === 1) {
            const row = pages[0]!;
            // Only include queries with decent impressions and poor position
            if (row.impressions >= minImpressions * 2 && row.position > 5) {
              singlePageGaps.push({
                query,
                currentPage: key(row, 1),
                impressions: row.impressions,
                clicks: row.clicks,
                position: row.position,
                category: 'Single page',
                action: 'Only one page ranks for this query. Create supporting content (hub-and-spoke model) to build topical authority.',
              });
            }
          }
        }
        singlePageGaps.sort((a, b) => b.impressions - a.impressions);

        // ── Topic clustering (simple: shared 2+ word prefixes) ──
        function getTopicKey(query: string): string {
          const words = query.toLowerCase().trim().split(/\s+/);
          if (words.length >= 2) return words.slice(0, 2).join(' ');
          return words[0] || query;
        }

        const allGaps = [
          ...homepageGaps.slice(0, 20),
          ...zeroClickGaps.slice(0, 20),
          ...newQueryGaps.slice(0, 20),
          ...singlePageGaps.slice(0, 20),
        ];

        const topicClusters = new Map<string, ContentGap[]>();
        for (const gap of allGaps) {
          const topic = getTopicKey(gap.query);
          if (!topicClusters.has(topic)) topicClusters.set(topic, []);
          topicClusters.get(topic)!.push(gap);
        }

        const totalGapImpressions = allGaps.reduce((sum, g) => sum + g.impressions, 0);

        // Build markdown
        const parts: string[] = [];
        parts.push(`# Content Gaps for ${siteUrl}\n`);
        parts.push(`**Period:** ${currentRange.startDate} to ${currentRange.endDate} | **Min impressions:** ${formatNumber(minImpressions)}\n`);

        parts.push(`## Summary\n`);
        parts.push(`Found **${formatNumber(allGaps.length)} content gaps** across **${formatNumber(topicClusters.size)} topic clusters**, representing **${formatNumber(totalGapImpressions)} monthly impressions**.\n`);
        parts.push(`| Gap Type | Count | Total Impressions |`);
        parts.push(`| --- | ---: | ---: |`);
        parts.push(`| Homepage ranking (needs dedicated page) | ${homepageGaps.length} | ${formatNumber(homepageGaps.reduce((s, g) => s + g.impressions, 0))} |`);
        parts.push(`| High impressions, zero clicks | ${zeroClickGaps.length} | ${formatNumber(zeroClickGaps.reduce((s, g) => s + g.impressions, 0))} |`);
        parts.push(`| New emerging queries | ${newQueryGaps.length} | ${formatNumber(newQueryGaps.reduce((s, g) => s + g.impressions, 0))} |`);
        parts.push(`| Single-page queries (needs supporting content) | ${singlePageGaps.length} | ${formatNumber(singlePageGaps.reduce((s, g) => s + g.impressions, 0))} |`);
        parts.push('');

        // ── Homepage ranking queries ──
        if (homepageGaps.length > 0) {
          parts.push(`## Homepage Ranking Queries\n`);
          parts.push(`These non-branded queries rank on your homepage. Creating dedicated pages would improve relevance and rankings.\n`);
          parts.push(`| Query | Impressions | Clicks | Position | Action |`);
          parts.push(`| --- | ---: | ---: | ---: | --- |`);
          for (const g of homepageGaps.slice(0, 15)) {
            parts.push(`| ${truncateQuery(g.query)} | ${formatNumber(g.impressions)} | ${formatNumber(g.clicks)} | ${formatPosition(g.position)} | Create dedicated page |`);
          }
          parts.push('');
        }

        // ── Zero click queries ──
        if (zeroClickGaps.length > 0) {
          parts.push(`## High Impression, Zero Click Queries\n`);
          parts.push(`Users see your site for these queries but never click. The content may not match their intent.\n`);
          parts.push(`| Query | Impressions | Current Page | Position |`);
          parts.push(`| --- | ---: | --- | ---: |`);
          for (const g of zeroClickGaps.slice(0, 15)) {
            parts.push(`| ${truncateQuery(g.query)} | ${formatNumber(g.impressions)} | ${truncateUrl(g.currentPage)} | ${formatPosition(g.position)} |`);
          }
          parts.push('');
        }

        // ── New queries ──
        if (newQueryGaps.length > 0) {
          parts.push(`## New Emerging Queries\n`);
          parts.push(`These queries did not appear in the previous period. They represent growing search interest.\n`);
          parts.push(`| Query | Impressions | Clicks | Position | Current Page |`);
          parts.push(`| --- | ---: | ---: | ---: | --- |`);
          for (const g of newQueryGaps.slice(0, 15)) {
            parts.push(`| ${truncateQuery(g.query)} | ${formatNumber(g.impressions)} | ${formatNumber(g.clicks)} | ${formatPosition(g.position)} | ${truncateUrl(g.currentPage)} |`);
          }
          parts.push('');
        }

        // ── Single-page queries ──
        if (singlePageGaps.length > 0) {
          parts.push(`## Single-Page Queries (Supporting Content Needed)\n`);
          parts.push(`Only one page ranks for these queries. Building a cluster of related content would strengthen topical authority.\n`);
          parts.push(`| Query | Impressions | Position | Current Page |`);
          parts.push(`| --- | ---: | ---: | --- |`);
          for (const g of singlePageGaps.slice(0, 15)) {
            parts.push(`| ${truncateQuery(g.query)} | ${formatNumber(g.impressions)} | ${formatPosition(g.position)} | ${truncateUrl(g.currentPage)} |`);
          }
          parts.push('');
        }

        // ── Topic clusters ──
        const sortedClusters = [...topicClusters.entries()]
          .filter(([, gaps]) => gaps.length >= 2)
          .sort((a, b) => {
            const impA = a[1].reduce((s, g) => s + g.impressions, 0);
            const impB = b[1].reduce((s, g) => s + g.impressions, 0);
            return impB - impA;
          });

        if (sortedClusters.length > 0) {
          parts.push(`## Topic Clusters\n`);
          parts.push(`Queries grouped by shared topic. Consider creating a content hub (pillar page + supporting articles) for high-impression clusters.\n`);
          parts.push(`| Topic | Queries | Total Impressions | Gap Types |`);
          parts.push(`| --- | ---: | ---: | --- |`);
          for (const [topic, gaps] of sortedClusters.slice(0, 20)) {
            const totalImp = gaps.reduce((s, g) => s + g.impressions, 0);
            const categories = [...new Set(gaps.map((g) => g.category))].join(', ');
            parts.push(`| "${topic}..." | ${gaps.length} | ${formatNumber(totalImp)} | ${categories} |`);
          }
          parts.push('');
        }

        // ── Recommendations ──
        parts.push(`## Recommendations\n`);
        parts.push(`1. **Create dedicated pages** for homepage-ranking queries with >100 impressions. Each deserves its own optimized landing page.`);
        parts.push(`2. **Fix zero-click pages** by analyzing search intent. The current content may be too broad or off-topic for these queries.`);
        parts.push(`3. **Capitalize on new queries** by creating targeted content while competition is still low.`);
        parts.push(`4. **Build content clusters** around your strongest topics to establish topical authority.`);
        parts.push(`5. **Prioritize by impressions** -- start with the highest-impression gaps for maximum impact.`);
        parts.push('');

        // ── Limitations ──
        parts.push(`## Limitations\n`);
        for (const limitation of SHARED_LIMITATIONS) {
          parts.push(`- ${limitation}`);
        }
        parts.push(`- "New queries" may include queries that simply fell below the reporting threshold in the previous period.`);
        parts.push(`- Homepage detection uses URL path heuristics and may not be accurate for all site structures.`);
        parts.push(`- Topic clustering uses simple prefix matching. Manual review is recommended for accurate topic grouping.`);

        return { content: [{ type: 'text' as const, text: parts.join('\n') }] };
      } catch (error) {
        return errorResponse(error);
      }
    },
  );

  // =========================================================================
  // Tool 5: find_what_to_build_next
  // =========================================================================
  server.tool(
    'find_what_to_build_next',
    'Intent-based content planning: analyzes search queries by user intent (questions, comparisons, problems, buying signals) and recommends what content to create next, grouped by topic clusters',
    {
      siteUrl: siteUrlSchema,
      period: periodSchema.default('last28d'),
      searchType: searchTypeSchema.optional(),
      minImpressions: z.number().min(0).default(10).describe('Minimum impressions to consider a query'),
    },
    async ({ siteUrl, period, searchType, minImpressions }) => {
      try {
        const dateRange = resolveDateRange(period as DatePeriod);
        const request = buildRequest({
          siteUrl,
          ...dateRange,
          dimensions: ['query', 'page'],
          searchType,
        });

        const response = await api.querySearchAnalytics(request);
        const rows = response.rows.filter((r) => r.impressions >= minImpressions);

        if (rows.length === 0) {
          return {
            content: [{
              type: 'text' as const,
              text: `No query data found for **${siteUrl}** with at least ${formatNumber(minImpressions)} impressions. Try lowering the threshold.`,
            }],
          };
        }

        // Aggregate by query (a query might rank with multiple pages)
        const queryAgg = new Map<string, {
          query: string;
          totalImpressions: number;
          totalClicks: number;
          bestPosition: number;
          pages: string[];
        }>();

        for (const row of rows) {
          const query = key(row, 0);
          const page = key(row, 1);
          const existing = queryAgg.get(query);
          if (existing) {
            existing.totalImpressions += row.impressions;
            existing.totalClicks += row.clicks;
            existing.bestPosition = Math.min(existing.bestPosition, row.position);
            if (!existing.pages.includes(page)) existing.pages.push(page);
          } else {
            queryAgg.set(query, {
              query,
              totalImpressions: row.impressions,
              totalClicks: row.clicks,
              bestPosition: row.position,
              pages: [page],
            });
          }
        }

        // Classify all queries
        const queryList = [...queryAgg.values()];
        const classified = queryList.map((q) => ({
          ...q,
          classification: classifyQuery(q.query),
        }));

        // ── Intent-based content buckets ──

        // A: Question queries (informational, how-to/definition/explanation)
        const questionQueries = classified.filter((q) =>
          q.classification.intent === 'informational' &&
          q.classification.subType &&
          ['how-to', 'definition', 'explanation', 'temporal', 'location', 'identity'].includes(q.classification.subType)
        );

        // B: Comparison queries (investigational, comparison/alternative/best)
        const comparisonQueries = classified.filter((q) =>
          q.classification.intent === 'investigational' &&
          q.classification.subType &&
          ['comparison', 'alternative', 'best', 'review'].includes(q.classification.subType)
        );

        // C: Problem queries (problem_solving intent)
        const problemQueries = classified.filter((q) =>
          q.classification.intent === 'problem_solving'
        );

        // D: Buying queries (transactional intent)
        const buyingQueries = classified.filter((q) =>
          q.classification.intent === 'transactional'
        );

        // ── Topic grouping (shared keyword roots) ──
        interface TopicGroup {
          topic: string;
          queries: typeof classified;
          totalImpressions: number;
          totalClicks: number;
          intentTypes: Set<string>;
          contentRecommendation: string;
        }

        function extractTopicKey(query: string): string {
          // Remove common intent words to find the core topic
          const cleaned = query.toLowerCase()
            .replace(/\b(how to|what is|what are|why does|why is|best|top|review|vs|versus|fix|error|price|buy|cheap)\b/g, '')
            .replace(/\s+/g, ' ')
            .trim();
          const words = cleaned.split(' ').filter((w) => w.length > 2);
          if (words.length >= 2) return words.slice(0, 2).join(' ');
          return words[0] || query.toLowerCase().split(' ')[0] || 'other';
        }

        const topicMap = new Map<string, typeof classified>();
        for (const q of classified) {
          const topic = extractTopicKey(q.query);
          if (!topicMap.has(topic)) topicMap.set(topic, []);
          topicMap.get(topic)!.push(q);
        }

        const topicGroups: TopicGroup[] = [...topicMap.entries()].map(([topic, queries]) => {
          const totalImpressions = queries.reduce((s, q) => s + q.totalImpressions, 0);
          const totalClicks = queries.reduce((s, q) => s + q.totalClicks, 0);
          const intentTypes = new Set(queries.map((q) => q.classification.intent));

          // Generate content recommendation based on dominant intent
          const intentCounts = new Map<string, number>();
          for (const q of queries) {
            intentCounts.set(q.classification.intent, (intentCounts.get(q.classification.intent) ?? 0) + 1);
          }
          const dominantIntent = [...intentCounts.entries()].sort((a, b) => b[1] - a[1])[0]![0];

          let contentRecommendation: string;
          switch (dominantIntent) {
            case 'informational':
              contentRecommendation = 'Create a comprehensive guide or FAQ page covering this topic in depth.';
              break;
            case 'investigational':
              contentRecommendation = 'Create a comparison or review page. Include pros/cons, feature tables, and clear recommendations.';
              break;
            case 'problem_solving':
              contentRecommendation = 'Create a troubleshooting guide with step-by-step solutions. Include common error messages and fixes.';
              break;
            case 'transactional':
              contentRecommendation = 'Create a product/service page with clear pricing, benefits, and CTAs. Consider adding reviews or social proof.';
              break;
            default:
              contentRecommendation = 'Create targeted content matching the dominant search intent for this topic.';
          }

          return {
            topic,
            queries,
            totalImpressions,
            totalClicks,
            intentTypes,
            contentRecommendation,
          };
        });

        topicGroups.sort((a, b) => b.totalImpressions - a.totalImpressions);

        // Build markdown
        const parts: string[] = [];
        parts.push(`# What to Build Next for ${siteUrl}\n`);
        parts.push(`**Period:** ${dateRange.startDate} to ${dateRange.endDate} | **Min impressions:** ${formatNumber(minImpressions)}\n`);

        const totalQueries = classified.length;
        parts.push(`## Summary\n`);
        parts.push(`Analyzed **${formatNumber(totalQueries)} queries** and found content opportunities across **${formatNumber(topicGroups.length)} topic clusters**.\n`);

        // Top priority topic
        const topTopic = topicGroups[0];
        if (topTopic) {
          parts.push(`**Top priority:** "${topTopic.topic}" (${formatNumber(topTopic.totalImpressions)} impressions, ${topTopic.queries.length} queries)\n`);
        }

        parts.push(`| Intent Type | Queries | Total Impressions | Content Type Needed |`);
        parts.push(`| --- | ---: | ---: | --- |`);
        parts.push(`| Questions (how to, what is, why) | ${questionQueries.length} | ${formatNumber(questionQueries.reduce((s, q) => s + q.totalImpressions, 0))} | Guides, FAQs, tutorials |`);
        parts.push(`| Comparisons (vs, alternative, best) | ${comparisonQueries.length} | ${formatNumber(comparisonQueries.reduce((s, q) => s + q.totalImpressions, 0))} | Comparison pages, reviews |`);
        parts.push(`| Problems (fix, error, not working) | ${problemQueries.length} | ${formatNumber(problemQueries.reduce((s, q) => s + q.totalImpressions, 0))} | Troubleshooting guides |`);
        parts.push(`| Buying (price, buy, review, best) | ${buyingQueries.length} | ${formatNumber(buyingQueries.reduce((s, q) => s + q.totalImpressions, 0))} | Product/landing pages |`);
        parts.push('');

        // ── Question queries ──
        if (questionQueries.length > 0) {
          parts.push(`## Question Queries -- Guide & FAQ Opportunities\n`);
          parts.push(`Users are asking questions. Create comprehensive answers.\n`);
          parts.push(`| Query | Impressions | Clicks | Position | Sub-type |`);
          parts.push(`| --- | ---: | ---: | ---: | --- |`);
          for (const q of questionQueries.sort((a, b) => b.totalImpressions - a.totalImpressions).slice(0, 15)) {
            parts.push(`| ${truncateQuery(q.query)} | ${formatNumber(q.totalImpressions)} | ${formatNumber(q.totalClicks)} | ${formatPosition(q.bestPosition)} | ${q.classification.subType ?? 'general'} |`);
          }
          parts.push('');
          parts.push(`**Content format:** Long-form guides with clear headings, step-by-step instructions, and FAQ schema markup.\n`);
        }

        // ── Comparison queries ──
        if (comparisonQueries.length > 0) {
          parts.push(`## Comparison Queries -- Comparison & Review Opportunities\n`);
          parts.push(`Users are evaluating options. Help them decide.\n`);
          parts.push(`| Query | Impressions | Clicks | Position | Sub-type |`);
          parts.push(`| --- | ---: | ---: | ---: | --- |`);
          for (const q of comparisonQueries.sort((a, b) => b.totalImpressions - a.totalImpressions).slice(0, 15)) {
            parts.push(`| ${truncateQuery(q.query)} | ${formatNumber(q.totalImpressions)} | ${formatNumber(q.totalClicks)} | ${formatPosition(q.bestPosition)} | ${q.classification.subType ?? 'general'} |`);
          }
          parts.push('');
          parts.push(`**Content format:** Side-by-side comparisons with feature tables, pros/cons lists, and a clear winner recommendation.\n`);
        }

        // ── Problem queries ──
        if (problemQueries.length > 0) {
          parts.push(`## Problem Queries -- Troubleshooting Opportunities\n`);
          parts.push(`Users have problems. Provide solutions.\n`);
          parts.push(`| Query | Impressions | Clicks | Position | Sub-type |`);
          parts.push(`| --- | ---: | ---: | ---: | --- |`);
          for (const q of problemQueries.sort((a, b) => b.totalImpressions - a.totalImpressions).slice(0, 15)) {
            parts.push(`| ${truncateQuery(q.query)} | ${formatNumber(q.totalImpressions)} | ${formatNumber(q.totalClicks)} | ${formatPosition(q.bestPosition)} | ${q.classification.subType ?? 'general'} |`);
          }
          parts.push('');
          parts.push(`**Content format:** Troubleshooting guides with numbered steps, screenshots, common error messages, and "still not working?" escalation paths.\n`);
        }

        // ── Buying queries ──
        if (buyingQueries.length > 0) {
          parts.push(`## Buying Queries -- Commercial Content Opportunities\n`);
          parts.push(`Users are ready to act. Make it easy.\n`);
          parts.push(`| Query | Impressions | Clicks | Position | Sub-type |`);
          parts.push(`| --- | ---: | ---: | ---: | --- |`);
          for (const q of buyingQueries.sort((a, b) => b.totalImpressions - a.totalImpressions).slice(0, 15)) {
            parts.push(`| ${truncateQuery(q.query)} | ${formatNumber(q.totalImpressions)} | ${formatNumber(q.totalClicks)} | ${formatPosition(q.bestPosition)} | ${q.classification.subType ?? 'general'} |`);
          }
          parts.push('');
          parts.push(`**Content format:** Landing pages with clear pricing, benefit-driven copy, social proof, and prominent CTAs.\n`);
        }

        // ── Topic clusters with recommendations ──
        const meaningfulClusters = topicGroups.filter((t) => t.queries.length >= 2);
        if (meaningfulClusters.length > 0) {
          parts.push(`## Topic Clusters -- Content Planning\n`);
          parts.push(`Group related queries into content hubs for maximum topical authority.\n`);
          parts.push(`| Topic | Queries | Impressions | Clicks | Intent Types | Recommendation |`);
          parts.push(`| --- | ---: | ---: | ---: | --- | --- |`);
          for (const group of meaningfulClusters.slice(0, 25)) {
            const intents = [...group.intentTypes].join(', ');
            parts.push(`| "${group.topic}" | ${group.queries.length} | ${formatNumber(group.totalImpressions)} | ${formatNumber(group.totalClicks)} | ${intents} | ${group.contentRecommendation} |`);
          }
          parts.push('');
        }

        // ── Content calendar suggestion ──
        parts.push(`## Suggested Content Calendar\n`);
        const topPriorities = topicGroups.slice(0, 5);
        if (topPriorities.length > 0) {
          parts.push(`Based on impression volume and intent signals, here is a suggested priority order:\n`);
          topPriorities.forEach((group, i) => {
            const dominantIntents = [...group.intentTypes];
            parts.push(`${i + 1}. **"${group.topic}"** (${formatNumber(group.totalImpressions)} impressions) -- ${group.contentRecommendation}`);
          });
          parts.push('');
        }

        // ── Recommendations ──
        parts.push(`## Recommendations\n`);
        parts.push(`1. **Match content format to intent** -- Do not create a blog post when users want a comparison table. Do not create a product page when users want a tutorial.`);
        parts.push(`2. **Start with high-impression topics** -- These have proven search demand. Creating well-optimized content has the highest ROI.`);
        parts.push(`3. **Build topic clusters** -- For each major topic, create a pillar page and 3-5 supporting articles. Link them together.`);
        parts.push(`4. **Address problems proactively** -- Problem/troubleshooting content builds trust and often converts visitors into customers.`);
        parts.push(`5. **Re-analyze monthly** -- Search demand shifts. Run this tool regularly to catch new opportunities early.`);
        parts.push('');

        // ── Limitations ──
        parts.push(`## Limitations\n`);
        for (const limitation of SHARED_LIMITATIONS) {
          parts.push(`- ${limitation}`);
        }
        parts.push(`- Query intent classification uses pattern-based rules and may misclassify ambiguous queries.`);
        parts.push(`- Topic clustering uses simplified keyword matching. Manual review and refinement of topic groups is recommended.`);
        parts.push(`- This analysis shows what users search for, not what they ultimately need. Complement with customer research and competitor analysis.`);

        return { content: [{ type: 'text' as const, text: parts.join('\n') }] };
      } catch (error) {
        return errorResponse(error);
      }
    },
  );
}
