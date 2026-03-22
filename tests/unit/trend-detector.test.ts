import { detectTrend } from '../../src/analysis/trend-detector.js';
import type { TrendPoint } from '../../src/analysis/trend-detector.js';

describe('trend-detector', () => {
  describe('detectTrend', () => {
    it('detects a rising trend', () => {
      const points: TrendPoint[] = [];
      for (let i = 0; i < 30; i++) {
        const day = String(i + 1).padStart(2, '0');
        points.push({ date: `2024-01-${day}`, value: 100 + i * 10 });
      }

      const result = detectTrend(points);
      expect(result.direction).toBe('rising');
      expect(result.slope).toBeGreaterThan(0);
      expect(result.percentChange).toBeGreaterThan(0);
      expect(result.confidence).toBeGreaterThan(0.5);
      expect(result.summary).toContain('upward');
    });

    it('detects a falling trend', () => {
      const points: TrendPoint[] = [];
      for (let i = 0; i < 30; i++) {
        const day = String(i + 1).padStart(2, '0');
        points.push({ date: `2024-01-${day}`, value: 500 - i * 10 });
      }

      const result = detectTrend(points);
      expect(result.direction).toBe('falling');
      expect(result.slope).toBeLessThan(0);
      expect(result.percentChange).toBeLessThan(0);
      expect(result.summary).toContain('downward');
    });

    it('detects a stable trend', () => {
      const points: TrendPoint[] = [];
      for (let i = 0; i < 30; i++) {
        const day = String(i + 1).padStart(2, '0');
        points.push({ date: `2024-01-${day}`, value: 100 });
      }

      const result = detectTrend(points);
      expect(result.direction).toBe('stable');
      expect(result.slope).toBe(0);
      expect(result.percentChange).toBe(0);
      expect(result.summary).toContain('stable');
    });

    it('returns stable for insufficient data (< 2 points)', () => {
      const result = detectTrend([{ date: '2024-01-01', value: 100 }]);
      expect(result.direction).toBe('stable');
      expect(result.slope).toBe(0);
      expect(result.confidence).toBe(0);
      expect(result.breakpoints).toEqual([]);
      expect(result.summary).toContain('Insufficient data');
    });

    it('returns stable for empty input', () => {
      const result = detectTrend([]);
      expect(result.direction).toBe('stable');
    });

    it('works with exactly 2 points', () => {
      const result = detectTrend([
        { date: '2024-01-01', value: 100 },
        { date: '2024-01-10', value: 200 },
      ]);
      expect(result.direction).toBe('rising');
      expect(result.percentChange).toBeCloseTo(100);
    });

    it('sorts data by date regardless of input order', () => {
      const result = detectTrend([
        { date: '2024-01-30', value: 200 },
        { date: '2024-01-01', value: 100 },
        { date: '2024-01-15', value: 150 },
      ]);
      expect(result.direction).toBe('rising');
      expect(result.percentChange).toBeCloseTo(100);
    });

    it('detects breakpoints on sudden changes', () => {
      const points: TrendPoint[] = [
        { date: '2024-01-01', value: 100 },
        { date: '2024-01-02', value: 102 },
        { date: '2024-01-03', value: 101 },
        { date: '2024-01-04', value: 103 },
        { date: '2024-01-05', value: 200 }, // sudden jump
        { date: '2024-01-06', value: 202 },
        { date: '2024-01-07', value: 201 },
      ];

      const result = detectTrend(points);
      expect(result.breakpoints.length).toBeGreaterThanOrEqual(1);

      const bigBreakpoint = result.breakpoints.find((bp) => bp.date === '2024-01-05');
      expect(bigBreakpoint).toBeDefined();
      expect(bigBreakpoint!.direction).toBe('up');
      expect(bigBreakpoint!.changePercent).toBeGreaterThan(0);
    });

    it('measures volatility correctly for noisy data', () => {
      const points: TrendPoint[] = [];
      for (let i = 0; i < 20; i++) {
        const day = String(i + 1).padStart(2, '0');
        // Alternating high/low values = high volatility
        points.push({ date: `2024-01-${day}`, value: i % 2 === 0 ? 200 : 50 });
      }

      const result = detectTrend(points);
      expect(result.volatility).toBeGreaterThan(0.2);
    });

    it('has low volatility for consistent data', () => {
      const points: TrendPoint[] = [];
      for (let i = 0; i < 20; i++) {
        const day = String(i + 1).padStart(2, '0');
        points.push({ date: `2024-01-${day}`, value: 100 + i * 5 });
      }

      const result = detectTrend(points);
      expect(result.volatility).toBeLessThan(0.3);
    });

    it('includes a human-readable summary', () => {
      const points: TrendPoint[] = [];
      for (let i = 0; i < 10; i++) {
        const day = String(i + 1).padStart(2, '0');
        points.push({ date: `2024-01-${day}`, value: 100 + i * 20 });
      }

      const result = detectTrend(points);
      expect(typeof result.summary).toBe('string');
      expect(result.summary.length).toBeGreaterThan(0);
    });
  });
});
