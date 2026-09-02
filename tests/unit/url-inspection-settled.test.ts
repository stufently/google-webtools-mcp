import { describe, it, expect } from 'vitest';
import type { searchconsole_v1 } from 'googleapis';
import { inspectUrlsSettled, describeInspectionError } from '../../src/api/url-inspection.js';
import { CacheManager } from '../../src/cache/cache-manager.js';
import { RateLimiter } from '../../src/utils/rate-limiter.js';
import { ApiError } from '../../src/errors/gsc-error.js';

/**
 * A Search Console client that fails on the URLs named in `failOn` and returns
 * a minimal PASS result for everything else.
 */
function stubClient(failOn: Set<string>): searchconsole_v1.Searchconsole {
  return {
    urlInspection: {
      index: {
        inspect: async (params: { requestBody: { inspectionUrl: string } }) => {
          const url = params.requestBody.inspectionUrl;
          if (failOn.has(url)) {
            throw new Error('Internal error encountered.');
          }
          return {
            data: {
              inspectionResult: {
                inspectionResultLink: `link:${url}`,
                indexStatusResult: {
                  verdict: 'PASS',
                  coverageState: 'Submitted and indexed',
                  robotsTxtState: 'ALLOWED',
                  indexingState: 'INDEXING_ALLOWED',
                  pageFetchState: 'SUCCESSFUL',
                  userCanonical: url,
                  googleCanonical: url,
                },
                richResultsResult: {
                  verdict: 'FAIL',
                  detectedItems: [
                    {
                      // Exactly how Google sends it: HTML-escaped.
                      richResultType: 'Q&amp;A',
                      items: [
                        {
                          name: 'Question 1',
                          issues: [
                            { issueMessage: 'Missing field &quot;acceptedAnswer&quot;', severity: 'ERROR' },
                          ],
                        },
                      ],
                    },
                  ],
                },
              },
            },
          };
        },
      },
    },
  } as unknown as searchconsole_v1.Searchconsole;
}

function deps() {
  return {
    cache: new CacheManager(),
    // Fast enough that a 20-URL test does not sit in a token bucket.
    limiter: new RateLimiter(1000, 1000),
  };
}

describe('inspectUrlsSettled', () => {
  it('keeps the other URLs when one fails', async () => {
    // The live failure: one transient "Internal error encountered" on a single
    // URL discarded the inspection of the other 19 pages.
    const urls = Array.from({ length: 20 }, (_, i) => `https://example.com/p${i}`);
    const { cache, limiter } = deps();

    const outcomes = await inspectUrlsSettled(
      stubClient(new Set(['https://example.com/p7'])),
      'sc-domain:example.com',
      urls,
      cache,
      limiter,
    );

    expect(outcomes).toHaveLength(20);
    expect(outcomes.filter((o) => o.ok)).toHaveLength(19);
    const failed = outcomes.filter((o) => !o.ok);
    expect(failed).toHaveLength(1);
    expect(failed[0]?.url).toBe('https://example.com/p7');
  });

  it('names the URL and the reason for each failure', async () => {
    const { cache, limiter } = deps();

    const outcomes = await inspectUrlsSettled(
      stubClient(new Set(['https://example.com/bad'])),
      'sc-domain:example.com',
      ['https://example.com/bad'],
      cache,
      limiter,
    );

    const outcome = outcomes[0]!;
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.url).toBe('https://example.com/bad');
      expect(outcome.error).toMatch(/Internal error encountered/);
    }
  });

  it('preserves input order so results line up with the URLs asked for', async () => {
    const urls = ['https://example.com/a', 'https://example.com/b', 'https://example.com/c'];
    const { cache, limiter } = deps();

    const outcomes = await inspectUrlsSettled(
      stubClient(new Set(['https://example.com/b'])),
      'sc-domain:example.com',
      urls,
      cache,
      limiter,
    );

    expect(outcomes.map((o) => o.url)).toEqual(urls);
  });

  it('decodes the HTML entities Google bakes into display strings', async () => {
    const { cache, limiter } = deps();

    const outcomes = await inspectUrlsSettled(
      stubClient(new Set()),
      'sc-domain:example.com',
      ['https://example.com/qa'],
      cache,
      limiter,
    );

    const outcome = outcomes[0]!;
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      const detected = outcome.result.richResultsResult?.detectedItems?.[0];
      expect(detected?.richResultType).toBe('Q&A');
      expect(detected?.items[0]?.issues?.[0]?.issueMessage).toBe('Missing field "acceptedAnswer"');
    }
  });

  it('carries the per-item rich result issues that explain a FAIL verdict', async () => {
    const { cache, limiter } = deps();

    const outcomes = await inspectUrlsSettled(
      stubClient(new Set()),
      'sc-domain:example.com',
      ['https://example.com/qa'],
      cache,
      limiter,
    );

    const outcome = outcomes[0]!;
    if (!outcome.ok) throw new Error('expected a successful inspection');
    const issues = outcome.result.richResultsResult?.detectedItems?.[0]?.items?.[0]?.issues;
    expect(issues).toHaveLength(1);
    expect(issues?.[0]?.severity).toBe('ERROR');
  });

  it('does not throw even when every URL fails', async () => {
    const urls = ['https://example.com/a', 'https://example.com/b'];
    const { cache, limiter } = deps();

    const outcomes = await inspectUrlsSettled(
      stubClient(new Set(urls)),
      'sc-domain:example.com',
      urls,
      cache,
      limiter,
    );

    expect(outcomes.every((o) => !o.ok)).toBe(true);
  });
});

describe('describeInspectionError', () => {
  it('includes the code, status and recovery hint of a GSC error', () => {
    const described = describeInspectionError(
      new ApiError('Internal error encountered.', {
        statusCode: 500,
        recoveryHint: 'Retry the request.',
      }),
    );

    expect(described).toContain('500');
    expect(described).toContain('Internal error encountered.');
    expect(described).toContain('Retry the request.');
  });

  it('falls back to the message of a plain error', () => {
    expect(describeInspectionError(new Error('boom'))).toBe('boom');
  });

  it('stringifies a non-error throw', () => {
    expect(describeInspectionError('odd')).toBe('odd');
  });
});
