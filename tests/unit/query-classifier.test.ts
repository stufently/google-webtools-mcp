import {
  classifyQuery,
  classifyQueries,
  getIntentDistribution,
} from '../../src/analysis/query-classifier.js';
import type { QueryIntent, ClassifiedQuery } from '../../src/analysis/query-classifier.js';

describe('query-classifier', () => {
  describe('classifyQuery', () => {
    describe('informational intent', () => {
      it('classifies "how to cook pasta" as informational', () => {
        const result = classifyQuery('how to cook pasta');
        expect(result.intent).toBe('informational');
        expect(result.subType).toBe('how-to');
        expect(result.confidence).toBeGreaterThanOrEqual(0.8);
      });

      it('classifies "what is TypeScript" as informational', () => {
        const result = classifyQuery('what is TypeScript');
        expect(result.intent).toBe('informational');
        expect(result.subType).toBe('definition');
      });

      it('classifies "why is the sky blue" as informational', () => {
        const result = classifyQuery('why is the sky blue');
        expect(result.intent).toBe('informational');
        expect(result.subType).toBe('explanation');
      });

      it('classifies queries with "guide" as informational', () => {
        const result = classifyQuery('kubernetes deployment guide');
        expect(result.intent).toBe('informational');
        expect(result.subType).toBe('guide');
      });
    });

    describe('transactional intent', () => {
      it('classifies "buy iphone" as transactional', () => {
        const result = classifyQuery('buy iphone');
        expect(result.intent).toBe('transactional');
        expect(result.subType).toBe('purchase');
        expect(result.confidence).toBeGreaterThanOrEqual(0.8);
      });

      it('classifies "cheap laptop deals" as transactional', () => {
        const result = classifyQuery('cheap laptop deals');
        expect(result.intent).toBe('transactional');
        expect(result.subType).toBe('deal');
      });

      it('classifies "price of macbook pro" as transactional', () => {
        const result = classifyQuery('price of macbook pro');
        expect(result.intent).toBe('transactional');
        expect(result.subType).toBe('pricing');
      });
    });

    describe('navigational intent', () => {
      it('classifies "facebook login" as navigational', () => {
        const result = classifyQuery('facebook login');
        expect(result.intent).toBe('navigational');
        expect(result.subType).toBe('login');
        expect(result.confidence).toBeGreaterThanOrEqual(0.8);
      });

      it('classifies "gmail sign in" as navigational', () => {
        const result = classifyQuery('gmail sign in');
        expect(result.intent).toBe('navigational');
        expect(result.subType).toBe('login');
      });

      it('classifies single-word brand queries as navigational', () => {
        const result = classifyQuery('github');
        expect(result.intent).toBe('navigational');
        expect(result.subType).toBe('brand');
        expect(result.confidence).toBe(0.4);
      });
    });

    describe('investigational intent', () => {
      it('classifies "best laptop 2024" as investigational', () => {
        const result = classifyQuery('best laptop 2024');
        expect(result.intent).toBe('investigational');
        expect(result.subType).toBe('best');
        expect(result.confidence).toBeGreaterThanOrEqual(0.7);
      });

      it('classifies "react vs angular" as investigational', () => {
        const result = classifyQuery('react vs angular');
        expect(result.intent).toBe('investigational');
        expect(result.subType).toBe('comparison');
      });

      it('classifies "alternatives to photoshop" as investigational', () => {
        const result = classifyQuery('alternatives to photoshop');
        expect(result.intent).toBe('investigational');
        expect(result.subType).toBe('alternative');
      });
    });

    describe('problem_solving intent', () => {
      it('classifies "fix cors error" as problem_solving', () => {
        const result = classifyQuery('fix cors error');
        expect(result.intent).toBe('problem_solving');
        expect(result.confidence).toBeGreaterThanOrEqual(0.8);
      });

      it('classifies "troubleshoot wifi connection" as problem_solving', () => {
        const result = classifyQuery('troubleshoot wifi connection');
        expect(result.intent).toBe('problem_solving');
        expect(result.subType).toBe('troubleshoot');
      });

      it('classifies "debug node memory leak" as problem_solving', () => {
        const result = classifyQuery('debug node memory leak');
        expect(result.intent).toBe('problem_solving');
        expect(result.subType).toBe('debug');
      });

      it('classifies "app not working" as problem_solving', () => {
        const result = classifyQuery('app not working');
        expect(result.intent).toBe('problem_solving');
      });
    });

    describe('default classification', () => {
      it('classifies short ambiguous queries as informational with low confidence', () => {
        const result = classifyQuery('ab');
        expect(result.intent).toBe('informational');
        expect(result.confidence).toBe(0.3);
      });

      it('preserves original query string', () => {
        const result = classifyQuery('How To Cook Pasta');
        expect(result.query).toBe('How To Cook Pasta');
      });
    });
  });

  describe('classifyQueries', () => {
    it('classifies an array of queries', () => {
      const results = classifyQueries(['buy shoes', 'how to cook', 'github']);
      expect(results).toHaveLength(3);
      expect(results[0]!.intent).toBe('transactional');
      expect(results[1]!.intent).toBe('informational');
      expect(results[2]!.intent).toBe('navigational');
    });
  });

  describe('getIntentDistribution', () => {
    it('computes counts for each intent', () => {
      const classified: ClassifiedQuery[] = [
        { query: 'a', intent: 'informational', confidence: 0.9 },
        { query: 'b', intent: 'informational', confidence: 0.8 },
        { query: 'c', intent: 'transactional', confidence: 0.9 },
        { query: 'd', intent: 'navigational', confidence: 0.9 },
        { query: 'e', intent: 'investigational', confidence: 0.8 },
        { query: 'f', intent: 'problem_solving', confidence: 0.9 },
      ];

      const dist = getIntentDistribution(classified);

      expect(dist.informational).toBe(2);
      expect(dist.transactional).toBe(1);
      expect(dist.navigational).toBe(1);
      expect(dist.investigational).toBe(1);
      expect(dist.problem_solving).toBe(1);
    });

    it('returns all zeros for empty input', () => {
      const dist = getIntentDistribution([]);
      expect(dist.informational).toBe(0);
      expect(dist.transactional).toBe(0);
      expect(dist.navigational).toBe(0);
      expect(dist.investigational).toBe(0);
      expect(dist.problem_solving).toBe(0);
    });
  });
});
