import {
  generateRecommendations,
  sortRecommendations,
  deduplicateRecommendations,
} from '../../src/analysis/recommendation-engine.js';
import type {
  Recommendation,
  GscRow,
  RecommendationInput,
} from '../../src/analysis/recommendation-engine.js';
import type { CtrAnalysis } from '../../src/analysis/ctr-benchmarks.js';
import type { TrendAnalysis } from '../../src/analysis/trend-detector.js';

describe('recommendation-engine', () => {
  describe('generateRecommendations', () => {
    it('generates title optimization recommendation for high-position low-CTR', () => {
      const rows: GscRow[] = [
        {
          query: 'seo guide',
          page: 'https://example.com/seo',
          clicks: 10,
          impressions: 5000,
          ctr: 0.002, // very low
          position: 2,
        },
      ];

      const recs = generateRecommendations({ rows });

      const titleRec = recs.find((r) => r.type === 'title_optimization');
      expect(titleRec).toBeDefined();
      expect(titleRec!.priority).toBe('high');
      expect(titleRec!.effort).toBe('low');
    });

    it('generates title optimization when ctrAnalysis ratio is low', () => {
      const rows: GscRow[] = [
        {
          query: 'test query',
          page: 'https://example.com/page',
          clicks: 50,
          impressions: 2000,
          ctr: 0.025,
          position: 1,
        },
      ];

      const ctrAnalyses: CtrAnalysis[] = [
        {
          position: 1,
          actualCtr: 0.025,
          expectedCtr: 0.317,
          ctrGap: -0.292,
          ctrRatio: 0.025 / 0.317, // ~0.079, well below 0.6
          performance: 'poor',
        },
      ];

      const recs = generateRecommendations({ rows, ctrAnalyses });
      const titleRec = recs.find((r) => r.type === 'title_optimization');
      expect(titleRec).toBeDefined();
    });

    it('does NOT generate title optimization for position > 3', () => {
      const rows: GscRow[] = [
        {
          query: 'test',
          page: 'https://example.com/page',
          clicks: 10,
          impressions: 5000,
          ctr: 0.002,
          position: 5,
        },
      ];

      const recs = generateRecommendations({ rows });
      const titleRec = recs.find((r) => r.type === 'title_optimization');
      expect(titleRec).toBeUndefined();
    });

    it('generates content expansion recommendation for position 4-10 with high impressions', () => {
      const rows: GscRow[] = [
        {
          query: 'web development',
          page: 'https://example.com/webdev',
          clicks: 50,
          impressions: 5000,
          ctr: 0.01,
          position: 6,
        },
      ];

      const recs = generateRecommendations({ rows });

      const expansionRec = recs.find((r) => r.type === 'content_expansion');
      expect(expansionRec).toBeDefined();
      expect(expansionRec!.priority).toBe('high');
      expect(expansionRec!.effort).toBe('medium');
    });

    it('does NOT generate content expansion for low impressions', () => {
      const rows: GscRow[] = [
        {
          query: 'niche topic',
          page: 'https://example.com/niche',
          clicks: 5,
          impressions: 50, // below 1000 threshold
          ctr: 0.1,
          position: 6,
        },
      ];

      const recs = generateRecommendations({ rows });
      const expansionRec = recs.find((r) => r.type === 'content_expansion');
      expect(expansionRec).toBeUndefined();
    });

    it('generates content refresh recommendation for declining trend', () => {
      const rows: GscRow[] = [
        {
          query: 'outdated topic',
          page: 'https://example.com/old',
          clicks: 50,
          impressions: 2000,
          ctr: 0.025,
          position: 3,
        },
      ];

      const trends = new Map<string, TrendAnalysis>();
      trends.set('outdated topic', {
        direction: 'falling',
        slope: -5,
        percentChange: -40,
        volatility: 0.2,
        confidence: 0.8,
        breakpoints: [],
        summary: 'Declining trend.',
      });

      const recs = generateRecommendations({ rows, trends });

      const refreshRec = recs.find((r) => r.type === 'content_refresh');
      expect(refreshRec).toBeDefined();
      expect(refreshRec!.priority).toBe('critical');
      expect(refreshRec!.effort).toBe('medium');
    });

    it('does NOT generate content refresh for rising trend', () => {
      const rows: GscRow[] = [
        {
          query: 'trending topic',
          page: 'https://example.com/trending',
          clicks: 200,
          impressions: 5000,
          ctr: 0.04,
          position: 3,
        },
      ];

      const trends = new Map<string, TrendAnalysis>();
      trends.set('trending topic', {
        direction: 'rising',
        slope: 10,
        percentChange: 50,
        volatility: 0.1,
        confidence: 0.9,
        breakpoints: [],
        summary: 'Rising trend.',
      });

      const recs = generateRecommendations({ rows, trends });
      const refreshRec = recs.find((r) => r.type === 'content_refresh');
      expect(refreshRec).toBeUndefined();
    });

    it('detects keyword cannibalization', () => {
      const rows: GscRow[] = [
        {
          query: 'duplicate query',
          page: 'https://example.com/page1',
          clicks: 30,
          impressions: 1000,
          ctr: 0.03,
          position: 5,
        },
        {
          query: 'duplicate query',
          page: 'https://example.com/page2',
          clicks: 20,
          impressions: 800,
          ctr: 0.025,
          position: 8,
        },
      ];

      const recs = generateRecommendations({ rows });
      const consolidationRec = recs.find((r) => r.type === 'consolidation');
      expect(consolidationRec).toBeDefined();
      expect(consolidationRec!.priority).toBe('high');
    });

    it('generates question content recommendation for question queries with low position', () => {
      const rows: GscRow[] = [
        {
          query: 'how to deploy docker',
          page: 'https://example.com/docker',
          clicks: 20,
          impressions: 500,
          ctr: 0.04,
          position: 8,
        },
      ];

      const recs = generateRecommendations({ rows });
      const questionRec = recs.find((r) => r.type === 'question_content');
      expect(questionRec).toBeDefined();
      expect(questionRec!.priority).toBe('medium');
    });

    it('generates niche keyword recommendation for high position with very low impressions', () => {
      const rows: GscRow[] = [
        {
          query: 'ultra specific niche keyword',
          page: 'https://example.com/niche',
          clicks: 1,
          impressions: 5,
          ctr: 0.2,
          position: 2,
        },
      ];

      const recs = generateRecommendations({ rows });
      const nicheRec = recs.find((r) => r.type === 'low_value_keyword');
      expect(nicheRec).toBeDefined();
      expect(nicheRec!.priority).toBe('low');
    });

    it('returns empty array when no rules match', () => {
      const rows: GscRow[] = [
        {
          query: 'normal query',
          page: 'https://example.com/page',
          clicks: 50,
          impressions: 50, // too low for most rules
          ctr: 0.5,
          position: 25, // too deep for most rules
        },
      ];

      const recs = generateRecommendations({ rows });
      expect(recs).toEqual([]);
    });
  });

  describe('sortRecommendations', () => {
    it('sorts by priority (critical first)', () => {
      const recs: Recommendation[] = [
        makeRec('low', 'type_a', 100),
        makeRec('critical', 'type_b', 50),
        makeRec('high', 'type_c', 200),
        makeRec('medium', 'type_d', 150),
      ];

      const sorted = sortRecommendations(recs);

      expect(sorted[0]!.priority).toBe('critical');
      expect(sorted[1]!.priority).toBe('high');
      expect(sorted[2]!.priority).toBe('medium');
      expect(sorted[3]!.priority).toBe('low');
    });

    it('sorts by impressions within the same priority', () => {
      const recs: Recommendation[] = [
        makeRec('high', 'type_a', 100),
        makeRec('high', 'type_b', 500),
        makeRec('high', 'type_c', 300),
      ];

      const sorted = sortRecommendations(recs);

      expect((sorted[0]!.data.impressions as number)).toBe(500);
      expect((sorted[1]!.data.impressions as number)).toBe(300);
      expect((sorted[2]!.data.impressions as number)).toBe(100);
    });

    it('does not mutate the input array', () => {
      const recs: Recommendation[] = [
        makeRec('low', 'a', 100),
        makeRec('high', 'b', 200),
      ];
      const original = [...recs];
      sortRecommendations(recs);
      expect(recs[0]!.priority).toBe(original[0]!.priority);
    });
  });

  describe('deduplicateRecommendations', () => {
    it('removes duplicate recommendations for the same type+query+page', () => {
      const recs: Recommendation[] = [
        makeRecWithQueryPage('high', 'title_optimization', 'query1', '/page1', 1000),
        makeRecWithQueryPage('medium', 'title_optimization', 'query1', '/page1', 500),
      ];

      const deduped = deduplicateRecommendations(recs);
      expect(deduped).toHaveLength(1);
      expect(deduped[0]!.priority).toBe('high'); // keeps highest priority
    });

    it('keeps recommendations with different types for the same query+page', () => {
      const recs: Recommendation[] = [
        makeRecWithQueryPage('high', 'title_optimization', 'q1', '/p1', 1000),
        makeRecWithQueryPage('high', 'content_expansion', 'q1', '/p1', 1000),
      ];

      const deduped = deduplicateRecommendations(recs);
      expect(deduped).toHaveLength(2);
    });

    it('always retains recommendations without query/page', () => {
      const recs: Recommendation[] = [
        {
          type: 'content_refresh',
          priority: 'critical',
          title: 'Refresh',
          description: 'desc',
          impact: 'high',
          effort: 'medium',
          data: { key: 'some-page', percentChange: -30 },
        },
        {
          type: 'content_refresh',
          priority: 'high',
          title: 'Refresh 2',
          description: 'desc',
          impact: 'medium',
          effort: 'medium',
          data: { key: 'another-page', percentChange: -20 },
        },
      ];

      const deduped = deduplicateRecommendations(recs);
      expect(deduped).toHaveLength(2);
    });

    it('does not mutate the input', () => {
      const recs: Recommendation[] = [
        makeRecWithQueryPage('low', 'a', 'q', '/p', 100),
        makeRecWithQueryPage('high', 'a', 'q', '/p', 200),
      ];
      const origLen = recs.length;
      deduplicateRecommendations(recs);
      expect(recs).toHaveLength(origLen);
    });
  });
});

// --- Helpers ---

function makeRec(
  priority: Recommendation['priority'],
  type: string,
  impressions: number,
): Recommendation {
  return {
    type,
    priority,
    title: `Test recommendation (${type})`,
    description: 'Test description',
    impact: 'Test impact',
    effort: 'low',
    data: { impressions },
  };
}

function makeRecWithQueryPage(
  priority: Recommendation['priority'],
  type: string,
  query: string,
  page: string,
  impressions: number,
): Recommendation {
  return {
    type,
    priority,
    title: `Test recommendation (${type})`,
    description: 'Test description',
    impact: 'Test impact',
    effort: 'low',
    data: { query, page, impressions },
  };
}
