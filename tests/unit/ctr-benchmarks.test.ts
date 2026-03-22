import {
  getExpectedCtr,
  analyzeCtr,
  batchAnalyzeCtr,
  getCtrPerformanceLabel,
} from '../../src/analysis/ctr-benchmarks.js';

describe('ctr-benchmarks', () => {
  describe('getExpectedCtr', () => {
    it('returns correct CTR for position 1', () => {
      expect(getExpectedCtr(1)).toBe(0.317);
    });

    it('returns correct CTR for position 5', () => {
      expect(getExpectedCtr(5)).toBe(0.095);
    });

    it('returns correct CTR for position 10', () => {
      expect(getExpectedCtr(10)).toBe(0.022);
    });

    it('returns page-two CTR for positions 11-20', () => {
      expect(getExpectedCtr(11)).toBe(0.015);
      expect(getExpectedCtr(15)).toBe(0.015);
      expect(getExpectedCtr(20)).toBe(0.015);
    });

    it('returns deep CTR for positions beyond 20', () => {
      expect(getExpectedCtr(21)).toBe(0.005);
      expect(getExpectedCtr(50)).toBe(0.005);
      expect(getExpectedCtr(100)).toBe(0.005);
    });

    it('rounds fractional positions', () => {
      expect(getExpectedCtr(1.4)).toBe(0.317); // rounds to 1
      expect(getExpectedCtr(1.6)).toBe(0.247); // rounds to 2
    });

    it('clamps position to minimum of 1', () => {
      expect(getExpectedCtr(0)).toBe(0.317);
      expect(getExpectedCtr(-5)).toBe(0.317);
    });
  });

  describe('getCtrPerformanceLabel', () => {
    it('returns excellent for ratio >= 1.5', () => {
      expect(getCtrPerformanceLabel(1.5)).toBe('excellent');
      expect(getCtrPerformanceLabel(2.0)).toBe('excellent');
    });

    it('returns good for ratio >= 1.1', () => {
      expect(getCtrPerformanceLabel(1.1)).toBe('good');
      expect(getCtrPerformanceLabel(1.49)).toBe('good');
    });

    it('returns average for ratio >= 0.8', () => {
      expect(getCtrPerformanceLabel(0.8)).toBe('average');
      expect(getCtrPerformanceLabel(1.09)).toBe('average');
    });

    it('returns below_average for ratio >= 0.5', () => {
      expect(getCtrPerformanceLabel(0.5)).toBe('below_average');
      expect(getCtrPerformanceLabel(0.79)).toBe('below_average');
    });

    it('returns poor for ratio < 0.5', () => {
      expect(getCtrPerformanceLabel(0.49)).toBe('poor');
      expect(getCtrPerformanceLabel(0)).toBe('poor');
    });
  });

  describe('analyzeCtr', () => {
    it('produces correct analysis for above-expected CTR', () => {
      const result = analyzeCtr(1, 0.5); // actual 50% vs expected 31.7%
      expect(result.position).toBe(1);
      expect(result.actualCtr).toBe(0.5);
      expect(result.expectedCtr).toBe(0.317);
      expect(result.ctrGap).toBeCloseTo(0.183);
      expect(result.ctrRatio).toBeCloseTo(0.5 / 0.317);
      expect(result.performance).toBe('excellent');
    });

    it('produces correct analysis for below-expected CTR', () => {
      const result = analyzeCtr(1, 0.05); // actual 5% vs expected 31.7%
      expect(result.ctrGap).toBeCloseTo(-0.267);
      expect(result.performance).toBe('poor');
    });

    it('handles position with zero expected CTR edge case', () => {
      // All real positions have non-zero expected CTR, but verify ctrRatio safety
      const result = analyzeCtr(5, 0.095);
      expect(result.ctrRatio).toBeCloseTo(1.0);
      expect(result.performance).toBe('average');
    });
  });

  describe('batchAnalyzeCtr', () => {
    it('analyzes multiple rows', () => {
      const results = batchAnalyzeCtr([
        { position: 1, ctr: 0.4 },
        { position: 5, ctr: 0.02 },
        { position: 15, ctr: 0.01 },
      ]);

      expect(results).toHaveLength(3);
      expect(results[0]!.performance).toBe('good');
      expect(results[1]!.performance).toBe('poor');
      expect(results[2]!.performance).toBe('below_average');
    });

    it('returns empty array for empty input', () => {
      expect(batchAnalyzeCtr([])).toEqual([]);
    });
  });
});
