import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { VerificationApiClient } from '../../api/verification-client.js';
import { createToolResponse, formatToolResponse } from '../schemas.js';
import { formatErrorForMcp } from '../../errors/error-handler.js';

/**
 * Get human-readable instructions for a verification method and token.
 */
function getVerificationInstructions(method: string, token: string, siteUrl: string): string[] {
  switch (method) {
    case 'FILE':
      return [
        `Download or create a verification file named "${token}" at the root of your site.`,
        `The file should be accessible at: ${siteUrl.replace(/\/$/, '')}/${token}`,
        'The file content should be: `google-site-verification: ' + token + '`',
        'Once placed, use gsc_verify_site with method FILE to complete verification.',
      ];
    case 'DNS_TXT':
      return [
        `Add the following TXT record to your domain's DNS configuration:`,
        `\`${token}\``,
        'The TXT record should be added to the root domain (@ or empty host).',
        'DNS propagation may take up to 72 hours, but usually completes within minutes.',
        'Once the DNS record is live, use gsc_verify_site with method DNS_TXT to complete verification.',
      ];
    case 'META':
      return [
        `Add the following meta tag to the <head> section of your homepage:`,
        `\`${token}\``,
        'The tag must appear in the HTML source (not dynamically injected by JavaScript).',
        'Once added, use gsc_verify_site with method META to complete verification.',
      ];
    case 'ANALYTICS':
      return [
        'Verification via Google Analytics uses the existing GA tracking code on your site.',
        `Token: ${token}`,
        'Ensure that the Google Analytics tracking snippet is in the <head> section of your homepage.',
        'The authenticated account must have edit access to the Analytics property.',
        'Once confirmed, use gsc_verify_site with method ANALYTICS to complete verification.',
      ];
    default:
      return [`Token: ${token}`, 'Use gsc_verify_site to complete the verification process.'];
  }
}

export function registerVerificationTools(server: McpServer, verification: VerificationApiClient): void {
  // ── gsc_get_verification_token ────────────────────────────────────────
  server.tool(
    'gsc_get_verification_token',
    'Get a verification token for a site using the specified verification method (FILE, DNS_TXT, META, or ANALYTICS)',
    {
      site_url: z.string().describe('Site URL or domain to verify (e.g., "https://example.com/" or "example.com" for domain verification)'),
      method: z.enum(['FILE', 'DNS_TXT', 'META', 'ANALYTICS']).describe('Verification method to use'),
    },
    async ({ site_url, method }) => {
      try {
        const result = await verification.getToken(site_url, method);

        const isDomain = !site_url.startsWith('http');
        const verificationType = isDomain ? 'Domain' : 'URL-prefix';
        const instructions = getVerificationInstructions(method, result.token, site_url);

        const data = [
          `**Verification token for ${site_url}**`,
          '',
          `| Field | Value |`,
          `| --- | --- |`,
          `| **Site** | ${site_url} |`,
          `| **Type** | ${verificationType} |`,
          `| **Method** | ${method} |`,
          `| **Token** | \`${result.token}\` |`,
        ].join('\n');

        const summary = `Generated ${method} verification token for ${site_url} (${verificationType} verification).`;

        const limitations: string[] = [];
        if (isDomain && method === 'FILE') {
          limitations.push('FILE verification is not available for domain-level verification. Use DNS_TXT instead.');
        }
        if (isDomain && method === 'META') {
          limitations.push('META verification is not available for domain-level verification. Use DNS_TXT instead.');
        }

        const text = formatToolResponse(createToolResponse(data, summary, instructions, limitations));
        return { content: [{ type: 'text' as const, text }] };
      } catch (error) {
        return formatErrorForMcp(error);
      }
    },
  );

  // ── gsc_verify_site ───────────────────────────────────────────────────
  server.tool(
    'gsc_verify_site',
    'Verify site ownership using a previously configured verification method',
    {
      site_url: z.string().describe('Site URL or domain to verify (e.g., "https://example.com/" or "example.com")'),
      method: z.enum(['FILE', 'DNS_TXT', 'META', 'ANALYTICS']).describe('Verification method that was configured'),
    },
    async ({ site_url, method }) => {
      try {
        const result = await verification.verifySite(site_url, method);

        const data = [
          `**Verification successful for ${site_url}**`,
          '',
          `| Field | Value |`,
          `| --- | --- |`,
          `| **Site** | ${site_url} |`,
          `| **Method** | ${method} |`,
          `| **Status** | Verified |`,
          `| **Owners** | ${(result.owners ?? []).join(', ') || 'N/A'} |`,
        ].join('\n');

        const summary = `Successfully verified ownership of ${site_url} using ${method} method.`;

        const recommendations = [
          'The site is now verified. You can access its data in Google Search Console.',
          'Use list_properties to see the verified site in your property list.',
          'Search analytics data will become available within 24-48 hours.',
        ];

        const limitations = [
          'Keep the verification token in place (DNS record, meta tag, or file) to maintain verification status.',
          'Removing the verification proof may cause the site to become unverified.',
        ];

        const text = formatToolResponse(createToolResponse(data, summary, recommendations, limitations));
        return { content: [{ type: 'text' as const, text }] };
      } catch (error) {
        return formatErrorForMcp(error);
      }
    },
  );
}
