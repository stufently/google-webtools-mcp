import { describe, it, expect } from 'vitest';
import {
  auditInspections,
  collectRichResultIssues,
  formatSingleInspection,
  richResultErrorSummary,
  type PageAnalytics,
} from '../../src/tools/indexing/index.js';
import type { InspectionOutcome } from '../../src/api/url-inspection.js';
import type { InspectionResult } from '../../src/api/types.js';

function indexed(overrides: Record<string, unknown> = {}): InspectionResult {
  return {
    inspectionResultLink: 'link',
    indexStatusResult: {
      verdict: 'PASS',
      coverageState: 'Submitted and indexed',
      robotsTxtState: 'ALLOWED',
      indexingState: 'INDEXING_ALLOWED',
      pageFetchState: 'SUCCESSFUL',
      userCanonical: 'https://example.com/a',
      googleCanonical: 'https://example.com/a',
      ...overrides,
    },
  };
}

function ok(url: string, result: InspectionResult): InspectionOutcome {
  return { url, ok: true, result };
}

function failed(url: string, error: string): InspectionOutcome {
  return { url, ok: false, error };
}

const analytics: ReadonlyMap<string, PageAnalytics> = new Map([
  ['https://example.com/a', { impressions: 100, clicks: 5 }],
  ['https://example.com/b', { impressions: 50, clicks: 1 }],
]);

describe('auditInspections', () => {
  it('audits the successful URLs when one inspection fails', () => {
    const outcomes = [
      ok('https://example.com/a', indexed()),
      failed('https://example.com/bad', 'Internal error encountered.'),
      ok('https://example.com/b', indexed()),
    ];

    const audit = auditInspections(outcomes, analytics);

    expect(audit.inspected).toBe(2);
    expect(audit.indexedCount).toBe(2);
    expect(audit.failed).toEqual([
      { url: 'https://example.com/bad', error: 'Internal error encountered.' },
    ]);
  });

  it('names the failed URL and its error rather than swallowing them', () => {
    const audit = auditInspections(
      [failed('https://example.com/bad', 'QUOTA_EXCEEDED (HTTP 429): slow down')],
      analytics,
    );

    expect(audit.failed[0]?.url).toBe('https://example.com/bad');
    expect(audit.failed[0]?.error).toContain('429');
    expect(audit.issueCounts.get('Inspection failed')).toBe(1);
  });

  it('does not count a failed inspection as an indexed or clean page', () => {
    const audit = auditInspections([failed('https://example.com/bad', 'boom')], analytics);

    expect(audit.indexedCount).toBe(0);
    expect(audit.notIndexedCount).toBe(0);
    expect(audit.pageIssues).toHaveLength(0);
  });

  it('flags a page with no declared canonical', () => {
    const audit = auditInspections(
      [
        ok(
          'https://example.com/a',
          indexed({ userCanonical: undefined, googleCanonical: 'https://example.com/a' }),
        ),
      ],
      analytics,
    );

    expect(audit.missingCanonicalCount).toBe(1);
    expect(audit.canonicalMismatchCount).toBe(0);
    expect(audit.pageIssues[0]?.issues.join(' ')).toMatch(/No user canonical declared/);
  });

  it('keeps missing canonical separate from a canonical mismatch', () => {
    const audit = auditInspections(
      [
        ok(
          'https://example.com/a',
          indexed({
            userCanonical: 'https://example.com/a',
            googleCanonical: 'https://example.com/other',
          }),
        ),
      ],
      analytics,
    );

    expect(audit.canonicalMismatchCount).toBe(1);
    expect(audit.missingCanonicalCount).toBe(0);
  });

  it('leaves a page with a matching self-canonical clean', () => {
    const audit = auditInspections([ok('https://example.com/a', indexed())], analytics);

    expect(audit.missingCanonicalCount).toBe(0);
    expect(audit.pageIssues).toHaveLength(0);
  });

  it('sorts pages with issues by impressions', () => {
    const audit = auditInspections(
      [
        ok('https://example.com/b', indexed({ userCanonical: undefined })),
        ok('https://example.com/a', indexed({ userCanonical: undefined })),
      ],
      analytics,
    );

    expect(audit.pageIssues.map((p) => p.url)).toEqual([
      'https://example.com/a',
      'https://example.com/b',
    ]);
  });

  it('spells out why rich results failed', () => {
    const audit = auditInspections(
      [
        {
          url: 'https://example.com/a',
          ok: true,
          result: {
            ...indexed(),
            richResultsResult: {
              verdict: 'FAIL',
              detectedItems: [
                {
                  richResultType: 'Q&A',
                  items: [
                    {
                      name: 'Question 1',
                      issues: [{ issueMessage: 'Missing field "acceptedAnswer"', severity: 'ERROR' }],
                    },
                  ],
                },
              ],
            },
          },
        },
      ],
      analytics,
    );

    expect(audit.pageIssues[0]?.issues.join(' ')).toContain('Missing field "acceptedAnswer"');
  });
});

describe('formatSingleInspection', () => {
  /**
   * The rendered report is where escaping either happens or does not. Testing
   * the escaper in isolation proves nothing about whether this file calls it.
   */
  const withHostileNames: InspectionResult = {
    ...indexed(),
    mobileUsabilityResult: {
      verdict: 'FAIL',
      issues: [
        { issueType: 'TAP_TARGETS', severity: 'ERROR', message: 'targets\n## Fake heading' },
      ],
    },
    richResultsResult: {
      verdict: 'FAIL',
      detectedItems: [
        {
          richResultType: 'Product snippets',
          items: [
            {
              name: 'Widget | Pro',
              issues: [{ issueMessage: 'needs <offers>', severity: 'ERROR' }],
            },
          ],
        },
      ],
    },
  };

  it('escapes a pipe in a structured-data item name', () => {
    const out = formatSingleInspection('https://example.com/a', withHostileNames);

    expect(out).toContain('Widget \\| Pro');
    expect(out).not.toContain('| Widget | Pro |');
  });

  it('escapes angle brackets and flattens newlines from API strings', () => {
    const out = formatSingleInspection('https://example.com/a', withHostileNames);

    expect(out).toContain('needs &lt;offers&gt;');
    expect(out).toContain('targets ## Fake heading');
  });
});

describe('collectRichResultIssues', () => {
  const rich = {
    verdict: 'FAIL',
    detectedItems: [
      {
        richResultType: 'Product snippets',
        items: [
          {
            name: 'Widget',
            issues: [
              { issueMessage: 'Optional field "brand" missing', severity: 'WARNING' },
              { issueMessage: 'Either "offers", "review" or "aggregateRating" required', severity: 'ERROR' },
            ],
          },
        ],
      },
    ],
  };

  it('flattens nested items into printable rows', () => {
    const issues = collectRichResultIssues(rich);

    expect(issues).toHaveLength(2);
    expect(issues[0]?.richResultType).toBe('Product snippets');
    expect(issues[0]?.itemName).toBe('Widget');
  });

  it('lists errors before warnings', () => {
    expect(collectRichResultIssues(rich).map((i) => i.severity)).toEqual(['ERROR', 'WARNING']);
  });

  it('names an unnamed item rather than printing an empty cell', () => {
    const issues = collectRichResultIssues({
      verdict: 'FAIL',
      detectedItems: [
        { richResultType: 'Breadcrumbs', items: [{ issues: [{ issueMessage: 'x', severity: 'ERROR' }] }] },
      ],
    });

    expect(issues[0]?.itemName).toBe('(unnamed)');
  });

  it('returns nothing for a verdict with no per-item detail', () => {
    expect(collectRichResultIssues({ verdict: 'FAIL', detectedItems: [] })).toEqual([]);
    expect(collectRichResultIssues(undefined)).toEqual([]);
  });

  it('summarises only the errors, deduplicated', () => {
    expect(richResultErrorSummary(rich)).toEqual([
      'Product snippets: Either "offers", "review" or "aggregateRating" required',
    ]);
  });
});
