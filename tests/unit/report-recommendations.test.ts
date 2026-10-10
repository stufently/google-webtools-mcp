import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { GscApiClient } from '../../src/api/client.js';
import type { Ga4ApiClient } from '../../src/api/ga4-client.js';
import type { VerificationApiClient } from '../../src/api/verification-client.js';
import type { SearchAnalyticsRequest, SearchAnalyticsRow } from '../../src/api/types.js';
import { createServer } from '../../src/server.js';
import { buildReportRecommendations, toGscRows } from '../../src/tools/reports/recommendations.js';

// Position 2 with 5000 impressions and a 1% CTR: the engine's
// title-optimization rule fires on exactly this shape.
const LOW_CTR_ROW: SearchAnalyticsRow = {
  keys: ['buy widgets', 'https://example.com/widgets'],
  clicks: 50,
  impressions: 5000,
  ctr: 0.01,
  position: 2,
};

// Answers query+page requests with LOW_CTR_ROW and everything else with no rows.
function fakeGsc(requests: SearchAnalyticsRequest[]): GscApiClient {
  return {
    async querySearchAnalytics(request: SearchAnalyticsRequest) {
      requests.push(request);
      const dims = request.dimensions ?? [];
      const rows = dims.length === 2 && dims[0] === 'query' && dims[1] === 'page' ? [LOW_CTR_ROW] : [];
      return { rows, responseAggregationType: 'auto' };
    },
    async listSitemaps() {
      return [];
    },
  } as unknown as GscApiClient;
}

async function callTool(name: string, requests: SearchAnalyticsRequest[]): Promise<string> {
  const server = createServer(fakeGsc(requests), {} as Ga4ApiClient, {} as VerificationApiClient);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'report-recs-test', version: '1' });
  await server.connect(serverSide);
  await client.connect(clientSide);
  try {
    const result = await client.callTool({ name, arguments: { siteUrl: 'sc-domain:example.com' } });
    const content = result.content as Array<{ type: string; text: string }>;
    return content.map((c) => c.text).join('\n');
  } finally {
    await client.close();
    await server.close();
  }
}

describe('report tools feed real rows to the recommendation engine', () => {
  it('weekly_seo_report lists a recommendation when query+page data warrants one', async () => {
    const requests: SearchAnalyticsRequest[] = [];
    const text = await callTool('weekly_seo_report', requests);
    const section = text.slice(text.indexOf('## Prioritized Recommendations'));
    expect(section).toContain('Rewrite your title tag and meta description');
    expect(section).toContain('https://example.com/widgets');
    expect(section).not.toContain('No specific recommendations');
    expect(requests.some((r) => r.dimensions?.join(',') === 'query,page')).toBe(true);
  });

  it('seo_health_check lists a recommendation when query+page data warrants one', async () => {
    const requests: SearchAnalyticsRequest[] = [];
    const text = await callTool('seo_health_check', requests);
    const section = text.slice(text.indexOf('### Top 5 Recommendations'));
    expect(section).toContain('Rewrite your title tag and meta description');
    expect(section).not.toContain('No specific recommendations');
  });
});

describe('toGscRows', () => {
  it('maps keys[0] to query and keys[1] to page', () => {
    expect(toGscRows([LOW_CTR_ROW])).toEqual([
      { query: 'buy widgets', page: 'https://example.com/widgets', clicks: 50, impressions: 5000, ctr: 0.01, position: 2 },
    ]);
  });

  it('drops rows without a page key instead of recommending about ""', () => {
    expect(toGscRows([{ ...LOW_CTR_ROW, keys: ['buy widgets'] }])).toEqual([]);
  });
});

describe('buildReportRecommendations', () => {
  it('puts high-priority recommendations ahead of low ones', () => {
    const niche: SearchAnalyticsRow = {
      keys: ['tiny', 'https://example.com/tiny'], clicks: 0, impressions: 3, ctr: 0, position: 1,
    };
    const recs = buildReportRecommendations([niche, LOW_CTR_ROW]);
    expect(recs.map((r) => r.priority)).toEqual(['high', 'low']);
  });

  it('judges CTR against the position benchmark, not a flat 5%', () => {
    // 6% at position 1 clears the flat fallback but is far below the benchmark.
    const row: SearchAnalyticsRow = {
      keys: ['brand name', 'https://example.com/'], clicks: 300, impressions: 5000, ctr: 0.06, position: 1,
    };
    expect(buildReportRecommendations([row]).map((r) => r.type)).toContain('title_optimization');
  });

  it('skips consolidation when only one page carries real volume', () => {
    const main: SearchAnalyticsRow = {
      keys: ['red shoes', 'https://example.com/red-shoes'], clicks: 300, impressions: 1399, ctr: 0.21, position: 2,
    };
    const stray: SearchAnalyticsRow = {
      keys: ['red shoes', 'https://example.com/other-product'], clicks: 0, impressions: 10, ctr: 0, position: 30,
    };
    expect(buildReportRecommendations([main, stray]).map((r) => r.type)).not.toContain('consolidation');
  });

  it('keeps consolidation when two pages both carry real volume', () => {
    const a: SearchAnalyticsRow = {
      keys: ['red shoes', 'https://example.com/red-shoes'], clicks: 300, impressions: 1399, ctr: 0.21, position: 2,
    };
    const b: SearchAnalyticsRow = {
      keys: ['red shoes', 'https://example.com/shoes-red'], clicks: 5, impressions: 400, ctr: 0.0125, position: 9,
    };
    expect(buildReportRecommendations([a, b]).map((r) => r.type)).toContain('consolidation');
  });

  it('leaves low-volume pages out of the consolidation advice (1399/400/10)', () => {
    const a: SearchAnalyticsRow = {
      keys: ['red shoes', 'https://example.com/red-shoes'], clicks: 300, impressions: 1399, ctr: 0.21, position: 2,
    };
    const b: SearchAnalyticsRow = {
      keys: ['red shoes', 'https://example.com/shoes-red'], clicks: 5, impressions: 400, ctr: 0.0125, position: 9,
    };
    const stray: SearchAnalyticsRow = {
      keys: ['red shoes', 'https://example.com/other-product'], clicks: 0, impressions: 10, ctr: 0, position: 30,
    };
    const consolidation = buildReportRecommendations([a, b, stray]).filter((r) => r.type === 'consolidation');
    expect(consolidation).toHaveLength(1);
    expect(consolidation[0]!.data.pages).toEqual([
      'https://example.com/red-shoes',
      'https://example.com/shoes-red',
    ]);
    expect(consolidation[0]!.description).not.toContain('other-product');
  });
});
