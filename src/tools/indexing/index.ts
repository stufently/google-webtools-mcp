import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { GscApiClient } from '../../api/client.js';
import { siteUrlSchema, createToolResponse, formatToolResponse } from '../schemas.js';
import { GscError } from '../../errors/gsc-error.js';

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
  detectedItems?: { richResultType: string; items: any[] }[];
}

interface InspectionResult {
  inspectionResultLink: string;
  indexStatusResult?: IndexStatusResult;
  mobileUsabilityResult?: MobileUsabilityResult;
  richResultsResult?: RichResultsResult;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

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
  }

  return recommendations;
}

function formatSingleInspection(url: string, result: InspectionResult): string {
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
    parts.push(`| **Coverage state** | ${index.coverageState} |`);
    parts.push(`| **Indexing state** | ${index.indexingState} |`);

    parts.push('\n### Crawl Info\n');
    parts.push('| Field | Value |');
    parts.push('| --- | --- |');
    parts.push(`| **Last crawl time** | ${index.lastCrawlTime ?? 'N/A'} |`);
    parts.push(`| **Crawled as** | ${index.crawledAs ?? 'N/A'} |`);
    parts.push(`| **Page fetch state** | ${index.pageFetchState} |`);
    parts.push(`| **robots.txt state** | ${index.robotsTxtState} |`);

    if (index.sitemap && index.sitemap.length > 0) {
      parts.push(`| **Sitemaps** | ${index.sitemap.join(', ')} |`);
    }
    if (index.referringUrls && index.referringUrls.length > 0) {
      parts.push(`| **Referring URLs** | ${index.referringUrls.join(', ')} |`);
    }

    // Canonical
    parts.push('\n### Canonical\n');
    parts.push('| Field | Value |');
    parts.push('| --- | --- |');
    parts.push(`| **User canonical** | ${index.userCanonical ?? 'Not set'} |`);
    parts.push(`| **Google canonical** | ${index.googleCanonical ?? 'Not set'} |`);

    if (
      index.googleCanonical &&
      index.userCanonical &&
      index.googleCanonical !== index.userCanonical
    ) {
      parts.push('\n> **Warning:** Canonical mismatch detected. Google selected a different canonical than what you specified.\n');
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
        parts.push(`| ${issue.issueType} | ${issue.severity} | ${issue.message} |`);
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
    } else {
      parts.push('No rich results detected.\n');
    }
  }

  return parts.join('\n');
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
        return errorResponse(error);
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
            parts.push(`| ${url} | ${idx.coverageState} | ${idx.lastCrawlTime ?? 'N/A'} |`);
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
              `| ${url} | ${formatVerdict(idx.verdict)} | ${idx.coverageState} | ${idx.robotsTxtState} | ${idx.pageFetchState} |`,
            );
          }
        }

        // Errors
        if (errors.length > 0) {
          parts.push('\n### Errors\n');
          parts.push('| URL | Details |');
          parts.push('| --- | --- |');
          for (const { url } of errors) {
            parts.push(`| ${url} | No index status data returned |`);
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
        return errorResponse(error);
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

        // Step 2: Batch inspect the URLs (in chunks of 50 if needed)
        const allResults: InspectionResult[] = [];
        for (let i = 0; i < urls.length; i += 50) {
          const chunk = urls.slice(i, i + 50);
          const chunkResults = await api.batchInspectUrls(siteUrl, chunk);
          allResults.push(...chunkResults);
        }

        // Step 3: Categorize issues
        interface PageIssue {
          url: string;
          impressions: number;
          clicks: number;
          issues: string[];
          result: InspectionResult;
        }

        const pageIssues: PageIssue[] = [];
        const issueCounts = new Map<string, number>();
        let indexedCount = 0;
        let notIndexedCount = 0;
        let canonicalMismatchCount = 0;
        let mobileIssueCount = 0;
        let richResultIssueCount = 0;

        for (let i = 0; i < urls.length; i++) {
          const url = urls[i]!;
          const result = allResults[i]!;
          const analytics = pageAnalytics.get(url) ?? { impressions: 0, clicks: 0 };
          const issues: string[] = [];
          const index = result.indexStatusResult;
          const mobile = result.mobileUsabilityResult;
          const rich = result.richResultsResult;

          // Check indexing status
          if (index) {
            if (index.verdict === 'PASS') {
              indexedCount++;
            } else {
              notIndexedCount++;
              const issue = `Not indexed: ${index.coverageState}`;
              issues.push(issue);
              issueCounts.set('Not indexed', (issueCounts.get('Not indexed') ?? 0) + 1);
            }

            // Canonical mismatch
            if (
              index.googleCanonical &&
              index.userCanonical &&
              index.googleCanonical !== index.userCanonical
            ) {
              canonicalMismatchCount++;
              issues.push(`Canonical mismatch: user="${index.userCanonical}", Google="${index.googleCanonical}"`);
              issueCounts.set('Canonical mismatch', (issueCounts.get('Canonical mismatch') ?? 0) + 1);
            }

            // Robots.txt blocking
            if (index.robotsTxtState === 'DISALLOWED') {
              issues.push('Blocked by robots.txt');
              issueCounts.set('Blocked by robots.txt', (issueCounts.get('Blocked by robots.txt') ?? 0) + 1);
            }
          } else {
            issues.push('No index status data available');
            issueCounts.set('No data', (issueCounts.get('No data') ?? 0) + 1);
          }

          // Mobile usability
          if (mobile && mobile.verdict === 'FAIL') {
            mobileIssueCount++;
            const mobileProblems = mobile.issues?.map((i) => i.issueType).join(', ') ?? 'Unknown';
            issues.push(`Mobile issues: ${mobileProblems}`);
            issueCounts.set('Mobile usability', (issueCounts.get('Mobile usability') ?? 0) + 1);
          }

          // Rich results
          if (rich && rich.verdict === 'FAIL') {
            richResultIssueCount++;
            issues.push('Rich results failing validation');
            issueCounts.set('Rich results', (issueCounts.get('Rich results') ?? 0) + 1);
          }

          if (issues.length > 0) {
            pageIssues.push({ url, impressions: analytics.impressions, clicks: analytics.clicks, issues, result });
          }
        }

        // Sort by impressions descending (highest-traffic issues first)
        pageIssues.sort((a, b) => b.impressions - a.impressions);

        // Step 4: Build output
        const parts: string[] = [];

        parts.push('### Audit Overview\n');
        parts.push('| Metric | Value |');
        parts.push('| --- | --- |');
        parts.push(`| **Pages checked** | ${urls.length} |`);
        parts.push(`| **Indexed** | ${indexedCount} |`);
        parts.push(`| **Not indexed** | ${notIndexedCount} |`);
        parts.push(`| **Canonical mismatches** | ${canonicalMismatchCount} |`);
        parts.push(`| **Mobile issues** | ${mobileIssueCount} |`);
        parts.push(`| **Rich result issues** | ${richResultIssueCount} |`);
        parts.push(`| **Total pages with issues** | ${pageIssues.length} |`);

        // Issue breakdown
        if (issueCounts.size > 0) {
          parts.push('\n### Issue Breakdown\n');
          parts.push('| Issue Category | Count |');
          parts.push('| --- | --- |');
          const sortedIssues = [...issueCounts.entries()].sort((a, b) => b[1] - a[1]);
          for (const [issue, count] of sortedIssues) {
            parts.push(`| ${issue} | ${count} |`);
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
              `| ${page.url} | ${page.impressions.toLocaleString()} | ${page.clicks.toLocaleString()} | ${issueList} |`,
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

        if (pageIssues.length === 0) {
          recommendations.push('All checked pages are properly indexed with no detected issues.');
        }

        const topIssueLabel = topIssue ? topIssue[0] : 'None';
        const summary = `Checked ${urls.length} top pages. ${pageIssues.length} have indexing issues. Top issue: ${topIssueLabel}.`;

        const limitations = [
          'URL Inspection API has a quota of 2,000 inspections per day per property',
          'Results reflect the last crawl, not real-time page state',
          'Only pages with recent search impressions are checked; pages with zero impressions are not included',
        ];

        const data = parts.join('\n');
        const text = formatToolResponse(createToolResponse(data, summary, recommendations, limitations));
        return { content: [{ type: 'text' as const, text }] };
      } catch (error) {
        return errorResponse(error);
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
