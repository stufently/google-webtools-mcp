/**
 * Recommendation Engine Module
 *
 * Transforms raw GSC data, CTR analyses, trend information, and opportunity
 * scores into prioritized, actionable SEO recommendations.
 */

import type { CtrAnalysis } from './ctr-benchmarks.js';
import type { TrendAnalysis } from './trend-detector.js';
import type { OpportunityScore } from './opportunity-scorer.js';

/**
 * A single actionable recommendation derived from the analysis data.
 */
export interface Recommendation {
  /** The recommendation category (e.g., "title_optimization", "content_expansion"). */
  type: string;
  /** Urgency/importance level. */
  priority: 'critical' | 'high' | 'medium' | 'low';
  /** Short, descriptive title of the recommendation. */
  title: string;
  /** Detailed explanation of what to do and why. */
  description: string;
  /** Estimated impact description (qualitative). */
  impact: string;
  /** Estimated effort required to implement. */
  effort: 'low' | 'medium' | 'high';
  /** Supporting data that led to this recommendation. */
  data: Record<string, unknown>;
}

/**
 * A row of GSC data for a single query/page combination.
 */
export interface GscRow {
  query: string;
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

/**
 * Input data for generating recommendations.
 */
export interface RecommendationInput {
  /** Raw GSC rows (query/page level data). */
  rows: readonly GscRow[];
  /** CTR analyses for the rows, keyed by query or page. */
  ctrAnalyses?: readonly CtrAnalysis[];
  /** Trend analyses, keyed by query or page. */
  trends?: ReadonlyMap<string, TrendAnalysis>;
  /** Opportunity scores, keyed by query or page. */
  opportunities?: ReadonlyMap<string, OpportunityScore>;
}

/** Impression thresholds for "high" volume classification. */
const HIGH_IMPRESSIONS_THRESHOLD = 1000;
const MEDIUM_IMPRESSIONS_THRESHOLD = 100;

/** Low CTR relative to expected (ratio). */
const LOW_CTR_RATIO = 0.6;

/** Priority ordering for sorting (lower index = higher priority). */
const PRIORITY_ORDER: Record<Recommendation['priority'], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/**
 * Checks whether a query is a question query.
 */
function isQuestionQuery(query: string): boolean {
  const normalized = query.toLowerCase().trim();
  return /^(how|what|why|when|where|who|which|can|does|is|are|do|should|will)\b/.test(normalized);
}

/**
 * Detects rows where the same query ranks on multiple pages (cannibalization).
 */
function findCannibalizingQueries(
  rows: readonly GscRow[]
): Map<string, GscRow[]> {
  const queryPages = new Map<string, GscRow[]>();
  for (const row of rows) {
    const existing = queryPages.get(row.query);
    if (existing) {
      existing.push(row);
    } else {
      queryPages.set(row.query, [row]);
    }
  }

  const cannibalizing = new Map<string, GscRow[]>();
  for (const [query, pageRows] of queryPages) {
    if (pageRows.length > 1) {
      cannibalizing.set(query, pageRows);
    }
  }
  return cannibalizing;
}

/**
 * Rule 1: High impressions + low CTR + position 1-3.
 * The page ranks well but doesn't get clicked -- likely a title/description issue.
 */
function checkTitleOptimization(
  row: GscRow,
  ctrAnalysis?: CtrAnalysis
): Recommendation | null {
  if (row.position > 3) return null;
  if (row.impressions < MEDIUM_IMPRESSIONS_THRESHOLD) return null;

  const isLowCtr = ctrAnalysis
    ? ctrAnalysis.ctrRatio < LOW_CTR_RATIO
    : row.ctr < 0.05;

  if (!isLowCtr) return null;

  return {
    type: 'title_optimization',
    priority: 'high',
    title: 'Rewrite your title tag and meta description',
    description:
      `The page "${row.page}" ranks in position ${row.position.toFixed(1)} for "${row.query}" ` +
      `with ${row.impressions.toLocaleString()} impressions but only a ${(row.ctr * 100).toFixed(1)}% CTR. ` +
      'This is significantly below the expected CTR for this position. ' +
      'Improving the title tag and meta description to be more compelling and relevant could substantially increase clicks.',
    impact: `Could increase clicks by ${Math.round((1 / Math.max(row.ctr, 0.001) - 1) * 30)}%+ by closing the CTR gap.`,
    effort: 'low',
    data: {
      query: row.query,
      page: row.page,
      position: row.position,
      impressions: row.impressions,
      ctr: row.ctr,
      ctrRatio: ctrAnalysis?.ctrRatio,
    },
  };
}

/**
 * Rule 2: Position 4-10 + high impressions.
 * The page is on page 1 but not in the top 3 -- push it up.
 */
function checkContentExpansion(row: GscRow): Recommendation | null {
  if (row.position < 4 || row.position > 10) return null;
  if (row.impressions < HIGH_IMPRESSIONS_THRESHOLD) return null;

  return {
    type: 'content_expansion',
    priority: 'high',
    title: 'Add internal links and expand content to push into top 3',
    description:
      `The page "${row.page}" ranks at position ${row.position.toFixed(1)} for "${row.query}" ` +
      `with ${row.impressions.toLocaleString()} impressions. It is on page 1 but not in the top 3. ` +
      'Adding internal links from related pages, expanding the content depth, and improving on-page SEO ' +
      'signals could push it into the top positions where CTR is significantly higher.',
    impact: 'Moving from position 5 to position 1 can increase CTR by 3-4x.',
    effort: 'medium',
    data: {
      query: row.query,
      page: row.page,
      position: row.position,
      impressions: row.impressions,
    },
  };
}

/**
 * Rule 3: Position 11-20 + high impressions.
 * Page 2 content that has potential with more investment.
 */
function checkPageTwoContent(row: GscRow): Recommendation | null {
  if (row.position < 11 || row.position > 20) return null;
  if (row.impressions < HIGH_IMPRESSIONS_THRESHOLD) return null;

  return {
    type: 'page_two_optimization',
    priority: 'medium',
    title: 'Page 2 keyword needs content refresh and link building',
    description:
      `The page "${row.page}" ranks at position ${row.position.toFixed(1)} for "${row.query}" ` +
      `with ${row.impressions.toLocaleString()} impressions. This keyword is on page 2 of search results. ` +
      'A content refresh (updating information, improving structure, adding media) combined with ' +
      'link building efforts could push this onto page 1 where the vast majority of clicks occur.',
    impact: 'Moving from page 2 to page 1 typically increases traffic by 5-10x.',
    effort: 'high',
    data: {
      query: row.query,
      page: row.page,
      position: row.position,
      impressions: row.impressions,
    },
  };
}

/**
 * Rule 4: Multiple pages ranking for the same query.
 * Keyword cannibalization can dilute ranking signals.
 */
function checkCannibalization(
  query: string,
  rows: readonly GscRow[]
): Recommendation | null {
  if (rows.length < 2) return null;

  const pages = rows.map((r) => r.page);
  const totalImpressions = rows.reduce((sum, r) => sum + r.impressions, 0);

  return {
    type: 'consolidation',
    priority: 'high',
    title: 'Consolidate or canonicalize competing pages',
    description:
      `${rows.length} pages are competing for the query "${query}": ` +
      pages.map((p) => `"${p}"`).join(', ') +
      '. This keyword cannibalization can dilute ranking signals. ' +
      'Consider consolidating content into a single authoritative page and setting up ' +
      '301 redirects or canonical tags for the others.',
    impact: 'Consolidation often leads to a single page ranking higher than any individual competing page.',
    effort: 'medium',
    data: {
      query,
      pages,
      totalImpressions,
      pageCount: rows.length,
    },
  };
}

/**
 * Rule 5: Declining trend + high traffic.
 * Urgent content refresh needed to stop traffic loss.
 */
function checkDecliningTrend(
  key: string,
  trend: TrendAnalysis,
  row?: GscRow
): Recommendation | null {
  if (trend.direction !== 'falling') return null;
  if (row && row.impressions < MEDIUM_IMPRESSIONS_THRESHOLD) return null;

  return {
    type: 'content_refresh',
    priority: 'critical',
    title: 'Urgent: content refresh needed to reverse declining trend',
    description:
      `Traffic for "${key}" is declining (${trend.percentChange.toFixed(1)}% change). ` +
      (trend.confidence >= 0.7 ? 'This is a strong, consistent decline. ' : 'The trend signal is moderate. ') +
      'Immediate action is recommended: update the content with fresh information, ' +
      'improve the user experience, and check for any technical SEO issues. ' +
      'Also verify that competitors have not published superior content.',
    impact: 'Stopping a decline early preserves existing traffic and can reverse losses.',
    effort: 'medium',
    data: {
      key,
      percentChange: trend.percentChange,
      confidence: trend.confidence,
      direction: trend.direction,
      impressions: row?.impressions,
    },
  };
}

/**
 * Rule 7: High position + very low impressions.
 * The keyword may be too niche to justify optimization effort.
 */
function checkNicheKeyword(row: GscRow): Recommendation | null {
  if (row.position > 5) return null;
  if (row.impressions >= 10) return null;

  return {
    type: 'low_value_keyword',
    priority: 'low',
    title: 'Niche keyword with minimal search volume',
    description:
      `The page "${row.page}" ranks at position ${row.position.toFixed(1)} for "${row.query}" ` +
      `but only received ${row.impressions} impressions. This keyword has very low search volume ` +
      'and may not be worth dedicating significant optimization effort to.',
    impact: 'Minimal -- focus effort on higher-volume opportunities instead.',
    effort: 'low',
    data: {
      query: row.query,
      page: row.page,
      position: row.position,
      impressions: row.impressions,
    },
  };
}

/**
 * Rule 8: Question queries without dedicated content.
 * Opportunity to create FAQ or how-to content.
 */
function checkQuestionContent(row: GscRow): Recommendation | null {
  if (!isQuestionQuery(row.query)) return null;
  if (row.impressions < MEDIUM_IMPRESSIONS_THRESHOLD) return null;
  // Only suggest if the page doesn't rank well for the question
  if (row.position <= 3) return null;

  return {
    type: 'question_content',
    priority: 'medium',
    title: 'Create FAQ or how-to content for this question query',
    description:
      `The question "${row.query}" generates ${row.impressions.toLocaleString()} impressions ` +
      `but your page ranks at position ${row.position.toFixed(1)}. ` +
      'Creating dedicated FAQ or how-to content that directly answers this question could ' +
      'significantly improve rankings. Consider adding structured data (FAQ schema) to ' +
      'increase the chance of appearing in featured snippets.',
    impact: 'Question queries often trigger featured snippets, which can dramatically increase CTR.',
    effort: 'medium',
    data: {
      query: row.query,
      page: row.page,
      position: row.position,
      impressions: row.impressions,
    },
  };
}

/**
 * Generates actionable SEO recommendations from analysis data.
 *
 * Applies a set of rules to each row and cross-references CTR analyses,
 * trend data, and opportunity scores. Each rule targets a specific
 * optimization pattern (e.g., title optimization, content expansion,
 * cannibalization).
 *
 * @param data - The input data containing rows, CTR analyses, trends, and opportunities.
 * @returns An array of recommendations, unsorted. Use {@link sortRecommendations}
 *   to order by priority and impact.
 */
export function generateRecommendations(data: RecommendationInput): Recommendation[] {
  const { rows, ctrAnalyses, trends } = data;
  const recommendations: Recommendation[] = [];

  // Build a lookup for CTR analyses by query+page (if available)
  const ctrByKey = new Map<string, CtrAnalysis>();
  if (ctrAnalyses) {
    for (let i = 0; i < rows.length && i < ctrAnalyses.length; i++) {
      const row = rows[i]!;
      const analysis = ctrAnalyses[i]!;
      ctrByKey.set(row.query + '::' + row.page, analysis);
    }
  }

  // Per-row rules
  for (const row of rows) {
    const ctrAnalysis = ctrByKey.get(row.query + '::' + row.page);

    const titleRec = checkTitleOptimization(row, ctrAnalysis);
    if (titleRec) recommendations.push(titleRec);

    const expansionRec = checkContentExpansion(row);
    if (expansionRec) recommendations.push(expansionRec);

    const pageTwoRec = checkPageTwoContent(row);
    if (pageTwoRec) recommendations.push(pageTwoRec);

    const nicheRec = checkNicheKeyword(row);
    if (nicheRec) recommendations.push(nicheRec);

    const questionRec = checkQuestionContent(row);
    if (questionRec) recommendations.push(questionRec);
  }

  // Cannibalization detection (cross-row)
  const cannibalizing = findCannibalizingQueries(rows);
  for (const [query, queryRows] of cannibalizing) {
    const rec = checkCannibalization(query, queryRows);
    if (rec) recommendations.push(rec);
  }

  // Trend-based rules
  if (trends) {
    for (const [key, trend] of trends) {
      // Find the best-matching row for context
      const matchingRow = rows.find(
        (r) => r.query === key || r.page === key
      );
      const rec = checkDecliningTrend(key, trend, matchingRow);
      if (rec) recommendations.push(rec);
    }
  }

  return recommendations;
}

/**
 * Sorts recommendations by priority (critical first), then by estimated
 * impact (based on impressions in the supporting data, descending).
 *
 * @param recommendations - An array of recommendations to sort.
 * @returns A new sorted array (does not mutate the input).
 */
export function sortRecommendations(
  recommendations: readonly Recommendation[]
): Recommendation[] {
  return [...recommendations].sort((a, b) => {
    // Sort by priority first
    const priorityDiff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    if (priorityDiff !== 0) return priorityDiff;

    // Then by impressions (higher = more impactful)
    const aImpressions = (a.data.impressions as number) ?? (a.data.totalImpressions as number) ?? 0;
    const bImpressions = (b.data.impressions as number) ?? (b.data.totalImpressions as number) ?? 0;
    return bImpressions - aImpressions;
  });
}

/**
 * Removes duplicate or overlapping recommendations for the same URL/query.
 *
 * When multiple recommendations target the same page+query combination,
 * only the highest-priority one is kept. Recommendations without a specific
 * query/page (e.g., trend-based) are always retained.
 *
 * @param recommendations - An array of recommendations, potentially with duplicates.
 * @returns A deduplicated array (does not mutate the input).
 */
export function deduplicateRecommendations(
  recommendations: readonly Recommendation[]
): Recommendation[] {
  // Sort first so highest priority comes first
  const sorted = sortRecommendations(recommendations);
  const seen = new Set<string>();
  const result: Recommendation[] = [];

  for (const rec of sorted) {
    const query = rec.data.query as string | undefined;
    const page = rec.data.page as string | undefined;

    if (query && page) {
      const key = `${rec.type}::${query}::${page}`;
      if (seen.has(key)) continue;
      seen.add(key);
    }

    result.push(rec);
  }

  return result;
}
