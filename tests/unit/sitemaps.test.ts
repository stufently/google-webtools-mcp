import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { webmasters_v3 } from 'googleapis';
import type { GscApiClient } from '../../src/api/client.js';
import type { SitemapInfo } from '../../src/api/types.js';
import { toSitemapInfo } from '../../src/api/sitemaps.js';
import { registerSitemapTools } from '../../src/tools/sitemaps/index.js';

const LIVE_SITEMAP_RESPONSE: webmasters_v3.Schema$WmxSitemap = {
  path: 'https://thaigid.top/sitemap.xml',
  isPending: false,
  isSitemapsIndex: false,
  type: 'sitemap',
  lastSubmitted: '2026-08-30T12:37:37.507Z',
  lastDownloaded: '2026-08-30T12:37:38.082Z',
  warnings: '0',
  errors: '0',
  contents: [{ type: 'web', submitted: '5715', indexed: '0' }],
};

type SitemapDetailsHandler = (
  args: { siteUrl: string; feedpath: string },
) => Promise<{ content: Array<{ type: 'text'; text: string }> }>;

async function formatSitemapDetails(sitemap: SitemapInfo): Promise<string> {
  const handlers = new Map<string, SitemapDetailsHandler>();
  const server = {
    tool(
      name: string,
      _description: string,
      _schema: unknown,
      handler: SitemapDetailsHandler,
    ): void {
      handlers.set(name, handler);
    },
  };
  const api = {
    getSitemap: async () => sitemap,
  };

  registerSitemapTools(
    server as unknown as McpServer,
    api as unknown as GscApiClient,
  );

  const handler = handlers.get('get_sitemap_details');
  if (!handler) throw new Error('get_sitemap_details handler was not registered');

  const result = await handler({
    siteUrl: 'https://thaigid.top/',
    feedpath: sitemap.path,
  });
  return result.content[0]?.text ?? '';
}

describe('toSitemapInfo', () => {
  it('normalizes zero counters from the live API response to numbers', () => {
    const sitemap = toSitemapInfo(LIVE_SITEMAP_RESPONSE);

    expect(sitemap.errors).toBe(0);
    expect(sitemap.warnings).toBe(0);
    expect(sitemap.contents).toEqual([
      { type: 'web', submitted: '5715', indexed: '0' },
    ]);
  });

  it('normalizes a positive string counter to a number', () => {
    const sitemap = toSitemapInfo({
      ...LIVE_SITEMAP_RESPONSE,
      errors: '3',
    });

    expect(sitemap.errors).toBe(3);
  });

  it('keeps an API counter that is already numeric', () => {
    const sitemap = toSitemapInfo({
      ...LIVE_SITEMAP_RESPONSE,
      errors: 3,
    } as unknown as webmasters_v3.Schema$WmxSitemap);

    expect(sitemap.errors).toBe(3);
  });

  it('leaves omitted counters undefined', () => {
    const sitemap = toSitemapInfo({ path: LIVE_SITEMAP_RESPONSE.path });

    expect(sitemap.errors).toBeUndefined();
    expect(sitemap.warnings).toBeUndefined();
  });

  it.each([null, '', 'not-a-number', 'Infinity', Number.POSITIVE_INFINITY])(
    'maps the invalid counter %p to undefined',
    (errors) => {
      const sitemap = toSitemapInfo({
        ...LIVE_SITEMAP_RESPONSE,
        errors,
      } as unknown as webmasters_v3.Schema$WmxSitemap);

      expect(sitemap.errors).toBeUndefined();
    },
  );
});

describe('get_sitemap_details formatting', () => {
  it('reports zero counters as Success without issue rows or recommendations', async () => {
    const text = await formatSitemapDetails(toSitemapInfo(LIVE_SITEMAP_RESPONSE));

    expect(text).toContain('| **Status** | Success |');
    expect(text).not.toContain('| **Errors** |');
    expect(text).not.toContain('| **Warnings** |');
    expect(text).not.toContain('This sitemap has errors:');
    expect(text).not.toContain('Check the sitemap file for XML syntax errors');
  });

  it('reports a positive error counter as Error and prints its value', async () => {
    const sitemap = toSitemapInfo({
      ...LIVE_SITEMAP_RESPONSE,
      errors: '3',
    });
    const text = await formatSitemapDetails(sitemap);

    expect(text).toContain('| **Status** | Error |');
    expect(text).toContain('| **Errors** | 3 |');
    expect(text).toContain('This sitemap has errors: 3');
  });
});
