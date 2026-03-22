import {
  scoreOpportunity,
  getPriority,
} from '../../src/analysis/opportunity-scorer.js';
import type { OpportunityParams } from '../../src/analysis/opportunity-scorer.js';

describe('opportunity-scorer', () => {
  describe('scoreOpportunity', () => {
    it('returns a score between 0 and 100', () => {
      const result = scoreOpportunity({
        impressions: 5000,
        clicks: 100,
        ctr: 0.02,
        position: 5,
      });

      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
    });

    it('returns a valid priority label', () => {
      const result = scoreOpportunity({
        impressions: 5000,
        clicks: 100,
        ctr: 0.02,
        position: 5,
      });

      expect(['critical', 'high', 'medium', 'low']).toContain(result.priority);
    });

    it('includes all five factors', () => {
      const result = scoreOpportunity({
        impressions: 1000,
        clicks: 50,
        ctr: 0.05,
        position: 3,
      });

      expect(result.factors).toHaveLength(5);
      const names = result.factors.map((f) => f.name);
      expect(names).toContain('impressions');
      expect(names).toContain('ctrGap');
      expect(names).toContain('position');
      expect(names).toContain('trend');
      expect(names).toContain('queryCount');
    });

    it('gives higher score for high-volume, low-CTR, good-position pages', () => {
      const highOpp = scoreOpportunity({
        impressions: 50000,
        clicks: 100,
        ctr: 0.002,
        position: 3,
        trend: -1,
        queryCount: 100,
      });

      const lowOpp = scoreOpportunity({
        impressions: 10,
        clicks: 5,
        ctr: 0.5,
        position: 50,
        trend: 1,
        queryCount: 1,
      });

      expect(highOpp.score).toBeGreaterThan(lowOpp.score);
    });

    it('scores zero impressions very low', () => {
      const result = scoreOpportunity({
        impressions: 0,
        clicks: 0,
        ctr: 0,
        position: 50,
      });

      const impressionsFactor = result.factors.find((f) => f.name === 'impressions');
      expect(impressionsFactor!.value).toBe(0);
    });

    it('uses provided expectedCtr when given', () => {
      const withCustom = scoreOpportunity({
        impressions: 1000,
        clicks: 10,
        ctr: 0.01,
        position: 5,
        expectedCtr: 0.5, // Much higher than default, so large gap
      });

      const withDefault = scoreOpportunity({
        impressions: 1000,
        clicks: 10,
        ctr: 0.01,
        position: 5,
      });

      // Custom expectedCtr of 0.5 creates bigger gap than default 0.095
      const customGap = withCustom.factors.find((f) => f.name === 'ctrGap');
      const defaultGap = withDefault.factors.find((f) => f.name === 'ctrGap');
      expect(customGap!.value).toBeGreaterThan(defaultGap!.value);
    });

    it('declining trend increases the score vs rising trend', () => {
      const declining = scoreOpportunity({
        impressions: 1000,
        clicks: 50,
        ctr: 0.05,
        position: 5,
        trend: -1,
      });

      const rising = scoreOpportunity({
        impressions: 1000,
        clicks: 50,
        ctr: 0.05,
        position: 5,
        trend: 1,
      });

      expect(declining.score).toBeGreaterThan(rising.score);
    });

    it('factor contributions sum to approximately the total score', () => {
      const result = scoreOpportunity({
        impressions: 5000,
        clicks: 200,
        ctr: 0.04,
        position: 7,
        trend: 0,
        queryCount: 50,
      });

      const sumContributions = result.factors.reduce((sum, f) => sum + f.contribution, 0);
      expect(result.score).toBeCloseTo(sumContributions, 0);
    });
  });

  describe('getPriority', () => {
    it('returns critical for score >= 80', () => {
      expect(getPriority(80)).toBe('critical');
      expect(getPriority(100)).toBe('critical');
    });

    it('returns high for score >= 60', () => {
      expect(getPriority(60)).toBe('high');
      expect(getPriority(79)).toBe('high');
    });

    it('returns medium for score >= 40', () => {
      expect(getPriority(40)).toBe('medium');
      expect(getPriority(59)).toBe('medium');
    });

    it('returns low for score < 40', () => {
      expect(getPriority(0)).toBe('low');
      expect(getPriority(39)).toBe('low');
    });
  });
});
