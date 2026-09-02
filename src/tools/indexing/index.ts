import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { GscApiClient } from '../../api/client.js';
import { siteUrlSchema, createToolResponse, formatToolResponse } from '../schemas.js';
import { formatErrorForMcp } from '../../errors/error-handler.js';
import { escapeTableCell } from '../../utils/markdown.js';
import type { RichResultItem } from '../../api/types.js';
import type { InspectionOutcome } from '../../api/url-inspection.js';

// ── Types ────────────────────────────────────────────────────────────────────

interface IndexStatusResult {
  verdict: string;
  coverageState: string;
  robotsTxtState: string;
  indexingState: string;
  lastCrawlTime?: string;
  pageFetchState: string;
  googleCanonical?: string;
  userCanonical?: string;
  sitemap?: string[];
  referringUrls?: string[];
  crawledAs?: string;
}

interface MobileUsabilityIssue {
  issueType: string;
  severity: string;
  message: string;
}

interface MobileUsabilityResult {
  verdict: string;
  issues?: MobileUsabilityIssue[];
}

interface RichResultsResult {
  verdict: string;
  detectedItems?: { richResultType: string; items: RichResultItem[] }[];
}

interface InspectionResult {
  inspectionResultLink: string;
  indexStatusResult?: IndexStatusResult;
  mobileUsabilityResult?: MobileUsabilityResult;
  richResultsResult?: RichResultsResult;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Every external string in this file's tables goes through the shared escaper.
 *
 * Structured-data item names, coverage states and API error strings are all
 * written elsewhere, and HTML entities are now decoded on ingest — so a `&#124;`
 * arrives as a real pipe and would shift every column after it.
 */
const cell = escapeTableCell;

function formatVerdict(verdict: string): string {
  switch (verdict) {
    case 'PASS': return 'PASS';
    case 'PARTIAL': return 'PARTIAL';
    case 'FAIL': return 'FAIL';
    case 'NEUTRAL': return 'NEUTRAL';
    default: return verdict;
  }
}

function getIndexingRecommendations(index: IndexStatusResult): string[] {
  const recommendations: string[] = [];

  if (index.verdict === 'FAIL' || index.verdict === 'NEUTRAL') {
    switch (index.coverageState) {
      case 'Submitted and indexed':
        break;
      case 'Crawled - currently not indexed':
        recommendations.push(
          'Page was crawled but not indexed. Improve content quality, add internal links, and ensure the page provides unique value.',
        );
        break;
      case 'Discovered - currently not indexed':
        recommendations.push(
          'Page was discovered but not yet crawled. Improve crawl budget by reducing low-quality pages and adding internal links to this URL.',
        );
        break;
      case 'Page with redirect':
        recommendations.push(
          'This URL redirects. Ensure internal links and sitemaps point to the final destination URL instead.',
        );
        break;
      case 'URL is unknown to Google':
        recommendations.push(
          'Google has not seen this URL. Submit it via the URL Inspection tool in Search Console, add it to your sitemap, and ensure it has internal links.',
        );
        break;
      case 'Soft 404':
        recommendations.push(
          'Page is treated as a soft 404. Either return proper content with a 200 status or a real 404 status code.',
        );
        break;
      case 'Blocked by robots.txt':
        recommendations.push(
          'Page is blocked by robots.txt. Update your robots.txt to allow Googlebot access if this page should be indexed.',
        );
        break;
      case 'Blocked due to unauthorized request (401)':
      case 'Blocked due to access forbidden (403)':
        recommendations.push(
          'Page returns an authorization error. Ensure Googlebot can access the page without authentication.',
        );
        break;
      case 'Not found (404)':
        recommendations.push(
          'Page returns a 404. If the page should exist, fix the server to return proper content. If removed intentionally, remove references from sitemaps and internal links.',
        );
        break;
      case 'Server error (5xx)':
        recommendations.push(
          'Page returns a server error. Investigate and fix server-side issues, then request recrawl.',
        );
        break;
      case 'Duplicate without user-selected canonical':
        recommendations.push(
          'Google considers this a duplicate. If this is the preferred URL, add a canonical tag pointing to itself. Otherwise, consolidate content to the canonical URL.',
        );
        break;
      case 'Duplicate, Google chose different canonical than user':
        recommendations.push(
          'Google chose a different canonical than what you specified. Review the content to ensure the pages are not too similar, or consolidate them.',
        );
        break;
      default:
        recommendations.push(
          `Coverage state: "${index.coverageState}". Review the URL Inspection report in Search Console for specific guidance.`,
        );
        break;
    }
  }

  if (index.robotsTxtState === 'DISALLOWED') {
    recommendations.push(
      'URL is disallowed by robots.txt. Update robots.txt if this page should be crawled.',
    );
  }

  if (index.pageFetchState !== 'SUCCESSFUL' && index.pageFetchState !== 'SOFT_404') {
    recommendations.push(
      `Page fetch state is "${index.pageFetchState}". Ensure the page is accessible and returns a 200 status.`,
    );
  }

  if (
    index.googleCanonical &&
    index.userCanonical &&
    index.googleCanonical !== index.userCanonical
  ) {
    recommendations.push(
      `Canonical mismatch: you specified "${index.userCanonical}" but Google selected "${index.googleCanonical}". Review whether these pages have substantially different content.`,
    );
  } else if (!index.userCanonical) {
    // A page with no self-referencing canonical leaves the choice entirely to
    // Google. That is exactly how near-duplicate pages end up cannibalising
    // each other, and the mismatch check above cannot see it: with nothing
    // declared there is nothing to mismatch.
    recommendations.push(
      `No user-declared canonical on this page${index.googleCanonical ? ` (Google picked "${index.googleCanonical}")` : ''}. Add a self-referencing canonical tag so the preferred URL is your decision rather than Google's.`,
    );
  }

  return recommendations;
}

/** A rich-result validation problem, flattened for display. */
export interface FlatRichResultIssue {
  richResultType: string;
  itemName: string;
  severity: string;
  message: string;
}

/**
 * Flattens `detectedItems[].items[].issues[]` into printable rows.
 *
 * Errors are listed before warnings: an ERROR is what makes the verdict FAIL,
 * a WARNING only costs an optional enhancement.
 */
export function collectRichResultIssues(
  rich: RichResultsResult | undefined,
): FlatRichResultIssue[] {
  if (!rich?.detectedItems) return [];

  const issues: FlatRichResultIssue[] = [];
  for (const detected of rich.detectedItems) {
    for (const item of detected.items) {
      for (const issue of item.issues ?? []) {
        issues.push({
          richResultType: detected.richResultType,
          itemName: item.name && item.name.length > 0 ? item.name : '(unnamed)',
          severity: issue.severity || 'UNKNOWN',
          message: issue.issueMessage,
        });
      }
    }
  }

  const rank = (severity: string): number => (severity === 'ERROR' ? 0 : severity === 'WARNING' ? 1 : 2);
  issues.sort((a, b) => rank(a.severity) - rank(b.severity));
  return issues;
}

/** The distinct ERROR-severity messages behind a failing rich-result verdict. */
export function richResultErrorSummary(
  rich: RichResultsResult | undefined,
): string[] {
  const errors = collectRichResultIssues(rich).filter((i) => i.severity === 'ERROR');
  return [...new Set(errors.map((i) => `${i.richResultType}: ${i.message}`))];
}

export function formatSingleInspection(url: string, result: InspectionResult): string {
  const parts: string[] = [];
  const index = result.indexStatusResult;
  const mobile = result.mobileUsabilityResult;
  const rich = result.richResultsResult;

  parts.push(`## URL Inspection: ${url}\n`);
  parts.push(`[View in Search Console](${result.inspectionResultLink})\n`);

  // Index Status
  if (index) {
    parts.push('### Index Status\n');
    parts.push('| Field | Value |');
    parts.push('| --- | --- |');
    parts.push(`| **Verdict** | ${formatVerdict(index.verdict)} |`);
    parts.push(`| **Coverage state** | ${cell(index.coverageState)} |`);
    parts.push(`| **Indexing state** | ${cell(index.indexingState)} |`);

    parts.push('\n### Crawl Info\n');
    parts.push('| Field | Value |');
    parts.push('| --- | --- |');
    parts.push(`| **Last crawl time** | ${cell(index.lastCrawlTime ?? 'N/A')} |`);
    parts.push(`| **Crawled as** | ${cell(index.crawledAs ?? 'N/A')} |`);
    parts.push(`| **Page fetch state** | ${cell(index.pageFetchState)} |`);
    parts.push(`| **robots.txt state** | ${cell(index.robotsTxtState)} |`);

    if (index.sitemap && index.sitemap.length > 0) {
      parts.push(`| **Sitemaps** | ${cell(index.sitemap.join(', '))} |`);
    }
    if (index.referringUrls && index.referringUrls.length > 0) {
      parts.push(`| **Referring URLs** | ${cell(index.referringUrls.join(', '))} |`);
    }

    // Canonical
    parts.push('\n### Canonical\n');
    parts.push('| Field | Value |');
    parts.push('| --- | --- |');
    parts.push(`| **User canonical** | ${cell(index.userCanonical ?? 'Not set')} |`);
    parts.push(`| **Google canonical** | ${cell(index.googleCanonical ?? 'Not set')} |`);

    if (
      index.googleCanonical &&
      index.userCanonical &&
      index.googleCanonical !== index.userCanonical
    ) {
      parts.push('\n> **Warning:** Canonical mismatch detected. Google selected a different canonical than what you specified.\n');
    } else if (!index.userCanonical) {
      parts.push('\n> **Warning:** No user canonical declared. Google alone decides which URL represents this page.\n');
    }
  }

  // Mobile Usability
  if (mobile) {
    parts.push('### Mobile Usability\n');
    parts.push(`**Verdict:** ${formatVerdict(mobile.verdict)}\n`);
    if (mobile.issues && mobile.issues.length > 0) {
      parts.push('| Issue | Severity | Message |');
      parts.push('| --- | --- | --- |');
      for (const issue of mobile.issues) {
        parts.push(`| ${cell(issue.issueType)} | ${cell(issue.severity)} | ${cell(issue.message)} |`);
      }
    } else if (mobile.verdict === 'PASS') {
      parts.push('No mobile usability issues detected.\n');
    }
  }

  // Rich Results
  if (rich) {
    parts.push('### Rich Results\n');
    parts.push(`**Verdict:** ${formatVerdict(rich.verdict)}\n`);
    if (rich.detectedItems && rich.detectedItems.length > 0) {
      parts.push('**Detected types:**\n');
      for (const item of rich.detectedItems) {
        parts.push(`- ${item.richResultType} (${item.items.length} item${item.items.length === 1 ? '' : 's'})`);
      }
      parts.push('');

      // Without this the verdict says FAIL and nothing says why -- the reason
      // is only ever carried by the per-item issues.
      const problems = collectRichResultIssues(rich);
      if (problems.length > 0) {
        parts.push('**Rich result issues:**\n');
        parts.push('| Type | Item | Severity | Issue |');
        parts.push('| --- | --- | --- | --- |');
        for (const p of problems) {
          // Item names come from the page's own structured data, so a pipe in
          // one would otherwise shift every cell after it.
          parts.push(
            `| ${cell(p.richResultType)} | ${cell(p.itemName)} | ${cell(p.severity)} | ${cell(p.message)} |`,
          );
        }
        parts.push('');
      } else if (rich.verdict === 'FAIL' || rich.verdict === 'PARTIAL') {
        parts.push('_The API reported no per-item issues for this verdict; open the Search Console report for details._\n');
      }
    } else {
      parts.push('No rich results detected.\n');
    }
  }

  return parts.join('\n');
}

/** Search-analytics numbers carried alongside each inspected page. */
export interface PageAnalytics {
  impressions: number;
  clicks: number;
}

/** One page that came back with something worth reporting. */
export interface AuditedPageIssue {
  url: string;
  impressions: number;
  clicks: number;
  issues: string[];
}

export interface IndexingAudit {
  /** URLs whose inspection succeeded. */
  inspected: number;
  /** URLs whose inspection failed, with the reason for each. */
  failed: { url: string; error: string }[];
  indexedCount: number;
  notIndexedCount: number;
  canonicalMismatchCount: number;
  missingCanonicalCount: number;
  mobileIssueCount: number;
  richResultIssueCount: number;
  issueCounts: Map<string, number>;
  pageIssues: AuditedPageIssue[];
}

/**
 * Turns per-URL inspection outcomes into the audit report's numbers.
 *
 * Failed URLs are carried in `failed` rather than aborting: an audit of 20
 * pages that loses one to a transient API error is still an audit of 19, and
 * the caller can say which one is missing.
 */
export function auditInspections(
  outcomes: readonly InspectionOutcome[],
  analyticsByUrl: ReadonlyMap<string, PageAnalytics>,
): IndexingAudit {
  const audit: IndexingAudit = {
    inspected: 0,
    failed: [],
    indexedCount: 0,
    notIndexedCount: 0,
    canonicalMismatchCount: 0,
    missingCanonicalCount: 0,
    mobileIssueCount: 0,
    richResultIssueCount: 0,
    issueCounts: new Map<string, number>(),
    pageIssues: [],
  };

  const countIssue = (label: string): void => {
    audit.issueCounts.set(label, (audit.issueCounts.get(label) ?? 0) + 1);
  };

  for (const outcome of outcomes) {
    if (!outcome.ok) {
      audit.failed.push({ url: outcome.url, error: outcome.error });
      countIssue('Inspection failed');
      continue;
    }

    audit.inspected++;
    const { url, result } = outcome;
    const analytics = analyticsByUrl.get(url) ?? { impressions: 0, clicks: 0 };
    const issues: string[] = [];
    const index = result.indexStatusResult;
    const mobile = result.mobileUsabilityResult;
    const rich = result.richResultsResult;

    if (index) {
      if (index.verdict === 'PASS') {
        audit.indexedCount++;
      } else {
        audit.notIndexedCount++;
        issues.push(`Not indexed: ${index.coverageState}`);
        countIssue('Not indexed');
      }

      if (index.googleCanonical && index.userCanonical && index.googleCanonical !== index.userCanonical) {
        audit.canonicalMismatchCount++;
        issues.push(`Canonical mismatch: user="${index.userCanonical}", Google="${index.googleCanonical}"`);
        countIssue('Canonical mismatch');
      } else if (!index.userCanonical) {
        // Not a mismatch -- there is nothing to mismatch. The page simply never
        // declared a canonical, so Google alone decides which URL represents
        // it. The old check compared two canonicals and therefore skipped every
        // page missing one, passing the riskiest case as clean.
        audit.missingCanonicalCount++;
        issues.push(
          index.googleCanonical
            ? `No user canonical declared (Google chose "${index.googleCanonical}")`
            : 'No user canonical declared',
        );
        countIssue('Missing canonical');
      }

      if (index.robotsTxtState === 'DISALLOWED') {
        issues.push('Blocked by robots.txt');
        countIssue('Blocked by robots.txt');
      }
    } else {
      issues.push('No index status data available');
      countIssue('No data');
    }

    if (mobile && mobile.verdict === 'FAIL') {
      audit.mobileIssueCount++;
      const mobileProblems = mobile.issues?.map((i) => i.issueType).join(', ') ?? 'Unknown';
      issues.push(`Mobile issues: ${mobileProblems}`);
      countIssue('Mobile usability');
    }

    if (rich && rich.verdict === 'FAIL') {
      audit.richResultIssueCount++;
      const reasons = richResultErrorSummary(rich);
      issues.push(
        reasons.length > 0
          ? `Rich results failing validation -- ${reasons.join('; ')}`
          : 'Rich results failing validation (no per-item detail returned)',
      );
      countIssue('Rich results');
    }

    if (issues.length > 0) {
      audit.pageIssues.push({
        url,
        impressions: analytics.impressions,
        clicks: analytics.clicks,
        issues,
      });
    }
  }

  audit.pageIssues.sort((a, b) => b.impressions - a.impressions);
  return audit;
}

function categorizeResult(result: InspectionResult): 'indexed' | 'not_indexed' | 'error' {
  const index = result.indexStatusResult;
  if (!index) return 'error';
  if (index.verdict === 'PASS' && index.indexingState === 'INDEXING_ALLOWED') return 'indexed';
  if (index.verdict === 'FAIL' || index.verdict === 'NEUTRAL') return 'not_indexed';
  return 'not_indexed';
}

// ── Tool Registration ────────────────────────────────────────────────────────

export function registerIndexingTools(server: McpServer, api: GscApiClient): void {

  // ── inspect_url ──────────────────────────────────────────────────────────

  server.tool(
    'inspect_url',
    'Inspect a single URL for indexing status, mobile usability, and rich results',
    {
      siteUrl: siteUrlSchema,
      url: z.string().url().describe('The fully qualified URL to inspect'),
    },
    async ({ siteUrl, url }) => {
      try {
        const result = await api.inspectUrl(siteUrl, url);
        const formatted = formatSingleInspection(url, result);

        const recommendations = result.indexStatusResult
          ? getIndexingRecommendations(result.indexStatusResult)
          : [];

        const limitations = [
          'URL Inspection API has a quota of 2,000 inspections per day per property',
          'Results reflect the last crawl, not real-time page state',
        ];

        const text = formatToolResponse(
          createToolResponse(formatted, `Inspection complete for ${url}`, recommendations, limitations),
        );

        return { content: [{ type: 'text' as const, text }] };
      } catch (error) {
        return formatErrorForMcp(error);
      }
    },
  );

  // ── batch_inspect_urls ───────────────────────────────────────────────────

  server.tool(
    'batch_inspect_urls',
    'Inspect multiple URLs for indexing status in batch (max 50)',
    {
      siteUrl: siteUrlSchema,
      urls: z.array(z.string().url()).min(1).max(50).describe('Array of URLs to inspect (max 50)'),
    },
    async ({ siteUrl, urls }) => {
      try {
        if (urls.length > 50) {
          return {
            content: [{ type: 'text' as const, text: 'Error: Maximum of 50 URLs can be inspected in a single batch.' }],
            isError: true,
          };
        }

        const results = await api.batchInspectUrls(siteUrl, urls);

        // Categorize results
        const indexed: { url: string; result: InspectionResult }[] = [];
        const notIndexed: { url: string; result: InspectionResult }[] = [];
        const errors: { url: string; result: InspectionResult }[] = [];

        for (let i = 0; i < urls.length; i++) {
          const entry = { url: urls[i]!, result: results[i]! };
          switch (categorizeResult(results[i]!)) {
            case 'indexed': indexed.push(entry); break;
            case 'not_indexed': notIndexed.push(entry); break;
            case 'error': errors.push(entry); break;
          }
        }

        const parts: string[] = [];

        // Summary table
        parts.push('### Overview\n');
        parts.push(`| Status | Count |`);
        parts.push(`| --- | --- |`);
        parts.push(`| Indexed | ${indexed.length} |`);
        parts.push(`| Not indexed | ${notIndexed.length} |`);
        parts.push(`| Errors | ${errors.length} |`);

        // Indexed URLs
        if (indexed.length > 0) {
          parts.push('\n### Indexed URLs\n');
          parts.push('| URL | Coverage State | Last Crawl |');
          parts.push('| --- | --- | --- |');
          for (const { url, result } of indexed) {
            const idx = result.indexStatusResult!;
            parts.push(`| ${cell(url)} | ${cell(idx.coverageState)} | ${cell(idx.lastCrawlTime ?? 'N/A')} |`);
          }
        }

        // Not indexed URLs
        if (notIndexed.length > 0) {
          parts.push('\n### Not Indexed URLs\n');
          parts.push('| URL | Verdict | Coverage State | Robots.txt | Page Fetch |');
          parts.push('| --- | --- | --- | --- | --- |');
          for (const { url, result } of notIndexed) {
            const idx = result.indexStatusResult!;
            parts.push(
              `| ${cell(url)} | ${formatVerdict(idx.verdict)} | ${cell(idx.coverageState)} | ${cell(idx.robotsTxtState)} | ${cell(idx.pageFetchState)} |`,
            );
          }
        }

        // Errors
        if (errors.length > 0) {
          parts.push('\n### Errors\n');
          parts.push('| URL | Details |');
          parts.push('| --- | --- |');
          for (const { url } of errors) {
            parts.push(`| ${cell(url)} | No index status data returned |`);
          }
        }

        // Collect recommendations from common issues
        const recommendations: string[] = [];
        const coverageStates = new Map<string, number>();
        for (const { result } of notIndexed) {
          const state = result.indexStatusResult?.coverageState ?? 'Unknown';
          coverageStates.set(state, (coverageStates.get(state) ?? 0) + 1);
        }

        if (coverageStates.size > 0) {
          const sorted = [...coverageStates.entries()].sort((a, b) => b[1] - a[1]);
          for (const [state, count] of sorted) {
            recommendations.push(
              `${count} URL${count > 1 ? 's' : ''} with "${state}". Review these pages for common patterns.`,
            );
          }
        }

        if (notIndexed.some(({ result }) =>
          result.indexStatusResult?.googleCanonical &&
          result.indexStatusResult?.userCanonical &&
          result.indexStatusResult.googleCanonical !== result.indexStatusResult.userCanonical
        )) {
          recommendations.push(
            'Some URLs have canonical mismatches. Review canonical tags and consolidate duplicate content.',
          );
        }

        const summary = `${indexed.length} of ${urls.length} URLs are indexed, ${notIndexed.length} are not indexed, ${errors.length} returned errors.`;

        const limitations = [
          'URL Inspection API has a quota of 2,000 inspections per day per property',
          'Results reflect the last crawl, not real-time page state',
        ];

        const data = parts.join('\n');
        const text = formatToolResponse(createToolResponse(data, summary, recommendations, limitations));
        return { content: [{ type: 'text' as const, text }] };
      } catch (error) {
        return formatErrorForMcp(error);
      }
    },
  );

  // ── check_indexing_issues ────────────────────────────────────────────────

  server.tool(
    'check_indexing_issues',
    'Audit top pages by traffic for indexing issues, canonical mismatches, and mobile problems',
    {
      siteUrl: siteUrlSchema,
      limit: z.number().min(1).max(100).default(20).describe('Number of top pages to check (default 20, max 100)'),
    },
    async ({ siteUrl, limit }) => {
      try {
        // Step 1: Fetch top pages by impressions
        const analyticsResponse = await api.querySearchAnalytics({
          siteUrl,
          startDate: getDateDaysAgo(28),
          endDate: getDateDaysAgo(1),
          dimensions: ['page'],
          rowLimit: limit,
          searchType: 'web',
        });

        const rows = analyticsResponse.rows ?? [];
        if (rows.length === 0) {
          const text = formatToolResponse(
            createToolResponse(
              'No pages found in search analytics data.',
              'No pages with search impressions found for this property.',
              ['Verify the property has recent search traffic, or try a longer date range.'],
              [],
            ),
          );
          return { content: [{ type: 'text' as const, text }] };
        }

        // Build a map of page -> analytics data for later use
        const pageAnalytics = new Map<string, { impressions: number; clicks: number }>();
        const urls: string[] = [];
        for (const row of rows) {
          const pageUrl = row.keys?.[0] ?? '';
          if (pageUrl) {
            urls.push(pageUrl);
            pageAnalytics.set(pageUrl, {
              impressions: row.impressions ?? 0,
              clicks: row.clicks ?? 0,
            });
          }
        }

        // Step 2: Inspect the URLs. Failures are per URL, never fatal.
        const outcomes = await api.inspectUrlsSettled(siteUrl, urls);

        // Step 3: Categorize issues
        const audit = auditInspections(outcomes, pageAnalytics);
        const {
          pageIssues,
          issueCounts,
          indexedCount,
          notIndexedCount,
          canonicalMismatchCount,
          missingCanonicalCount,
          mobileIssueCount,
          richResultIssueCount,
        } = audit;

        // Step 4: Build output
        const parts: string[] = [];

        parts.push('### Audit Overview\n');
        parts.push('| Metric | Value |');
        parts.push('| --- | --- |');
        parts.push(`| **Pages selected** | ${urls.length} |`);
        parts.push(`| **Pages inspected** | ${audit.inspected} |`);
        parts.push(`| **Not inspected (API error)** | ${audit.failed.length} |`);
        parts.push(`| **Indexed** | ${indexedCount} |`);
        parts.push(`| **Not indexed** | ${notIndexedCount} |`);
        parts.push(`| **Canonical mismatches** | ${canonicalMismatchCount} |`);
        parts.push(`| **Missing canonical** | ${missingCanonicalCount} |`);
        parts.push(`| **Mobile issues** | ${mobileIssueCount} |`);
        parts.push(`| **Rich result issues** | ${richResultIssueCount} |`);
        parts.push(`| **Total pages with issues** | ${pageIssues.length} |`);

        if (audit.failed.length > 0) {
          parts.push('\n### Not Inspected\n');
          parts.push(
            `${audit.failed.length} of ${urls.length} page${audit.failed.length === 1 ? '' : 's'} could not be inspected. The URL Inspection API fails transiently on individual URLs; re-running usually clears it. Everything else below covers the ${audit.inspected} pages that were inspected.\n`,
          );
          parts.push('| URL | Error |');
          parts.push('| --- | --- |');
          for (const failure of audit.failed) {
            parts.push(`| ${cell(failure.url)} | ${cell(failure.error)} |`);
          }
        }

        // Issue breakdown
        if (issueCounts.size > 0) {
          parts.push('\n### Issue Breakdown\n');
          parts.push('| Issue Category | Count |');
          parts.push('| --- | --- |');
          const sortedIssues = [...issueCounts.entries()].sort((a, b) => b[1] - a[1]);
          for (const [issue, count] of sortedIssues) {
            parts.push(`| ${cell(issue)} | ${count} |`);
          }
        }

        // Detailed table of pages with issues
        if (pageIssues.length > 0) {
          parts.push('\n### Pages With Issues (by traffic)\n');
          parts.push('| URL | Impressions | Clicks | Issues |');
          parts.push('| --- | --- | --- | --- |');
          for (const page of pageIssues) {
            const issueList = page.issues.join('; ');
            parts.push(
              `| ${cell(page.url)} | ${page.impressions.toLocaleString()} | ${page.clicks.toLocaleString()} | ${cell(issueList)} |`,
            );
          }
        }

        // Build recommendations
        const recommendations: string[] = [];
        const topIssue = issueCounts.size > 0
          ? [...issueCounts.entries()].sort((a, b) => b[1] - a[1])[0]
          : null;

        if (notIndexedCount > 0) {
          recommendations.push(
            `${notIndexedCount} top page${notIndexedCount > 1 ? 's are' : ' is'} not indexed. Prioritize fixing these as they receive search impressions but may not be serving from your site.`,
          );
        }

        if (canonicalMismatchCount > 0) {
          recommendations.push(
            `${canonicalMismatchCount} page${canonicalMismatchCount > 1 ? 's have' : ' has'} canonical mismatches. Review canonical tags and ensure the preferred URL is consistently specified across internal links, sitemaps, and canonical tags.`,
          );
        }

        if (mobileIssueCount > 0) {
          recommendations.push(
            `${mobileIssueCount} page${mobileIssueCount > 1 ? 's have' : ' has'} mobile usability issues. With mobile-first indexing, fixing these is critical for rankings. Test with Google's Mobile-Friendly Test tool.`,
          );
        }

        if (richResultIssueCount > 0) {
          recommendations.push(
            `${richResultIssueCount} page${richResultIssueCount > 1 ? 's have' : ' has'} rich result validation errors. Fix structured data issues to maintain rich snippet eligibility.`,
          );
        }

        if (missingCanonicalCount > 0) {
          recommendations.push(
            `${missingCanonicalCount} page${missingCanonicalCount > 1 ? 's declare' : ' declares'} no canonical at all, leaving the choice of representative URL entirely to Google. Add a self-referencing canonical tag; a page without one is how near-duplicates end up competing with each other.`,
          );
        }

        if (audit.failed.length > 0) {
          recommendations.push(
            `${audit.failed.length} page${audit.failed.length > 1 ? 's were' : ' was'} not inspected because the API errored on them (see "Not Inspected" above). These pages have not been cleared -- re-run to cover them.`,
          );
        }

        if (pageIssues.length === 0 && audit.inspected > 0) {
          recommendations.push('All inspected pages are properly indexed with no detected issues.');
        }

        const topIssueLabel = topIssue ? topIssue[0] : 'None';
        const summary = audit.failed.length > 0
          ? `Inspected ${audit.inspected} of ${urls.length} top pages (${audit.failed.length} failed to inspect). ${pageIssues.length} have indexing issues. Top issue: ${topIssueLabel}.`
          : `Checked ${urls.length} top pages. ${pageIssues.length} have indexing issues. Top issue: ${topIssueLabel}.`;

        const limitations = [
          'URL Inspection API has a quota of 2,000 inspections per day per property',
          'Results reflect the last crawl, not real-time page state',
          'Only pages with recent search impressions are checked; pages with zero impressions are not included',
          'A page with no declared canonical is reported as an issue in its own right, separately from a canonical mismatch',
        ];

        const data = parts.join('\n');
        const text = formatToolResponse(createToolResponse(data, summary, recommendations, limitations));
        return { content: [{ type: 'text' as const, text }] };
      } catch (error) {
        return formatErrorForMcp(error);
      }
    },
  );
}

// ── Utility ──────────────────────────────────────────────────────────────────

function getDateDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}
