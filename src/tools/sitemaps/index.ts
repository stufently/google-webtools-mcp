import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { GscApiClient } from '../../api/client.js';
import { siteUrlSchema, createToolResponse, formatToolResponse } from '../schemas.js';
import { GscError } from '../../errors/gsc-error.js';
import { formatNumber } from '../../utils/formatting.js';

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

const feedpathSchema = z.string().describe(
  'The URL of the sitemap (e.g., "https://example.com/sitemap.xml")',
);

export function registerSitemapTools(server: McpServer, api: GscApiClient): void {
  // ── list_sitemaps ────────────────────────────────────────────────────
  server.tool(
    'list_sitemaps',
    'List all sitemaps submitted for a Google Search Console property',
    { siteUrl: siteUrlSchema },
    async ({ siteUrl }) => {
      try {
        const sitemaps = await api.listSitemaps(siteUrl);

        if (sitemaps.length === 0) {
          const text = formatToolResponse(createToolResponse(
            '_No sitemaps found for this property._',
            `No sitemaps found for ${siteUrl}.`,
            ['Submit a sitemap using submit_sitemap to help Google discover your pages.'],
            [],
          ));
          return { content: [{ type: 'text' as const, text }] };
        }

        const header = `| Path | Type | Status | URLs | Last Submitted |`;
        const separator = `| --- | --- | --- | ---: | --- |`;

        const rows = sitemaps.map((sm) => {
          const status = sm.isPending ? 'Pending' : (sm.errors ? 'Error' : 'Success');
          const urlCount = sm.contents
            ? sm.contents.reduce((sum, c) => sum + parseInt(c.submitted ?? '0', 10), 0)
            : '—';
          const lastSubmitted = sm.lastSubmitted ?? '—';
          return `| ${sm.path} | ${sm.type} | ${status} | ${typeof urlCount === 'number' ? formatNumber(urlCount) : urlCount} | ${lastSubmitted} |`;
        });

        const data = [header, separator, ...rows].join('\n');

        const pendingCount = sitemaps.filter((s) => s.isPending).length;
        const errorCount = sitemaps.filter((s) => s.errors).length;
        const totalUrls = sitemaps.reduce((total, sm) => {
          if (!sm.contents) return total;
          return total + sm.contents.reduce((sum, c) => sum + parseInt(c.submitted ?? '0', 10), 0);
        }, 0);

        const summary = `Found ${sitemaps.length} sitemap${sitemaps.length === 1 ? '' : 's'} for ${siteUrl} containing ${formatNumber(totalUrls)} total URLs.${pendingCount > 0 ? ` ${pendingCount} pending.` : ''}${errorCount > 0 ? ` ${errorCount} with errors.` : ''}`;

        const recommendations: string[] = [];
        if (errorCount > 0) {
          recommendations.push('Some sitemaps have errors. Use get_sitemap_details to investigate specific issues.');
        }
        if (pendingCount > 0) {
          recommendations.push('Some sitemaps are still being processed. Check back later for updated status.');
        }

        const limitations = [
          'URL counts reflect submitted URLs, not necessarily indexed URLs.',
          'Sitemap data may be cached and not reflect the most recent crawl.',
        ];

        const text = formatToolResponse(createToolResponse(data, summary, recommendations, limitations));
        return { content: [{ type: 'text' as const, text }] };
      } catch (error) {
        return errorResponse(error);
      }
    },
  );

  // ── get_sitemap_details ──────────────────────────────────────────────
  server.tool(
    'get_sitemap_details',
    'Get detailed information about a specific sitemap including URL counts by content type',
    { siteUrl: siteUrlSchema, feedpath: feedpathSchema },
    async ({ siteUrl, feedpath }) => {
      try {
        const sm = await api.getSitemap(siteUrl, feedpath);

        const status = sm.isPending ? 'Pending' : (sm.errors ? 'Error' : 'Success');

        const lines = [
          `| Field | Value |`,
          `| --- | --- |`,
          `| **Path** | ${sm.path} |`,
          `| **Type** | ${sm.type} |`,
          `| **Status** | ${status} |`,
          `| **Is sitemap index** | ${sm.isSitemapsIndex ? 'Yes' : 'No'} |`,
          `| **Last submitted** | ${sm.lastSubmitted ?? '—'} |`,
          `| **Last downloaded** | ${sm.lastDownloaded ?? '—'} |`,
        ];

        if (sm.warnings) {
          lines.push(`| **Warnings** | ${sm.warnings} |`);
        }
        if (sm.errors) {
          lines.push(`| **Errors** | ${sm.errors} |`);
        }

        let contentSection = '';
        if (sm.contents && sm.contents.length > 0) {
          const contentHeader = `\n\n### URL Counts by Content Type\n\n| Type | Submitted | Indexed |`;
          const contentSep = `| --- | ---: | ---: |`;
          const contentRows = sm.contents.map((c) => {
            const submitted = c.submitted ?? '—';
            const indexed = c.indexed ?? '—';
            return `| ${c.type} | ${submitted} | ${indexed} |`;
          });
          contentSection = [contentHeader, contentSep, ...contentRows].join('\n');
        }

        const data = lines.join('\n') + contentSection;

        const summary = `Sitemap ${sm.path} — status: ${status}, type: ${sm.type}${sm.isSitemapsIndex ? ' (sitemap index)' : ''}.`;

        const recommendations: string[] = [];
        if (sm.errors) {
          recommendations.push(
            `This sitemap has errors: ${sm.errors}`,
            'Check the sitemap file for XML syntax errors or invalid URLs.',
            'Resubmit the sitemap after fixing issues.',
          );
        }
        if (sm.warnings) {
          recommendations.push(
            `This sitemap has warnings: ${sm.warnings}`,
            'Review the sitemap for potential issues that may affect indexing.',
          );
        }
        if (sm.isPending) {
          recommendations.push('This sitemap is still being processed. Check back later.');
        }

        const limitations = [
          'Indexed counts may lag behind actual indexing status.',
          'Error details are summarized; check Search Console UI for full diagnostics.',
        ];

        const text = formatToolResponse(createToolResponse(data, summary, recommendations, limitations));
        return { content: [{ type: 'text' as const, text }] };
      } catch (error) {
        return errorResponse(error);
      }
    },
  );

  // ── submit_sitemap ───────────────────────────────────────────────────
  server.tool(
    'submit_sitemap',
    'Submit a new sitemap to Google Search Console for a property',
    { siteUrl: siteUrlSchema, feedpath: feedpathSchema },
    async ({ siteUrl, feedpath }) => {
      try {
        await api.submitSitemap(siteUrl, feedpath);

        const summary = `Successfully submitted sitemap ${feedpath} for ${siteUrl}.`;

        const recommendations = [
          'Check back in a few hours to verify processing.',
          'Use get_sitemap_details to monitor the processing status.',
          'Ensure the sitemap is accessible at the submitted URL and returns valid XML.',
        ];

        const limitations = [
          'Submitting a sitemap does not guarantee all URLs will be crawled or indexed.',
          'Google processes sitemaps on its own schedule.',
        ];

        const text = formatToolResponse(createToolResponse(
          `Sitemap **${feedpath}** has been submitted for property **${siteUrl}**.`,
          summary,
          recommendations,
          limitations,
        ));
        return { content: [{ type: 'text' as const, text }] };
      } catch (error) {
        return errorResponse(error);
      }
    },
  );

  // ── delete_sitemap ───────────────────────────────────────────────────
  server.tool(
    'delete_sitemap',
    'Remove a submitted sitemap from Google Search Console',
    { siteUrl: siteUrlSchema, feedpath: feedpathSchema },
    async ({ siteUrl, feedpath }) => {
      try {
        await api.deleteSitemap(siteUrl, feedpath);

        const summary = `Successfully removed sitemap ${feedpath} from ${siteUrl}.`;

        const recommendations = [
          'If removed by mistake, resubmit the sitemap using submit_sitemap.',
          'Removing a sitemap does not remove the URLs from Google\'s index.',
        ];

        const limitations = [
          'Google may continue to crawl URLs that were in the sitemap if they are linked from other pages.',
        ];

        const text = formatToolResponse(createToolResponse(
          `Sitemap **${feedpath}** has been removed from property **${siteUrl}**.`,
          summary,
          recommendations,
          limitations,
        ));
        return { content: [{ type: 'text' as const, text }] };
      } catch (error) {
        return errorResponse(error);
      }
    },
  );
}
