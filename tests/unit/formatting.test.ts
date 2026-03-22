import {
  formatNumber,
  formatPercent,
  formatPosition,
  formatChange,
  truncate,
} from '../../src/utils/formatting.js';

describe('formatting', () => {
  describe('formatNumber', () => {
    it('formats numbers with thousand separators', () => {
      expect(formatNumber(1234)).toBe('1,234');
      expect(formatNumber(1000000)).toBe('1,000,000');
    });

    it('does not add separators for small numbers', () => {
      expect(formatNumber(999)).toBe('999');
      expect(formatNumber(0)).toBe('0');
    });
  });

  describe('formatPercent', () => {
    it('formats a decimal ratio as a percentage', () => {
      expect(formatPercent(0.1234)).toBe('12.34%');
      expect(formatPercent(1)).toBe('100.00%');
    });

    it('respects custom decimal places', () => {
      expect(formatPercent(0.5, 0)).toBe('50%');
      expect(formatPercent(0.12345, 1)).toBe('12.3%');
    });

    it('handles zero', () => {
      expect(formatPercent(0)).toBe('0.00%');
    });
  });

  describe('formatPosition', () => {
    it('formats to one decimal place', () => {
      expect(formatPosition(3.456)).toBe('3.5');
      expect(formatPosition(1)).toBe('1.0');
      expect(formatPosition(10.04)).toBe('10.0');
    });
  });

  describe('formatChange', () => {
    it('formats positive change with + sign', () => {
      expect(formatChange(115.2, 100)).toBe('+15.20%');
    });

    it('formats negative change', () => {
      expect(formatChange(96.9, 100)).toBe('-3.10%');
    });

    it('returns N/A when previous is 0', () => {
      expect(formatChange(100, 0)).toBe('N/A');
    });

    it('formats zero change as +0.00%', () => {
      expect(formatChange(100, 100)).toBe('+0.00%');
    });

    it('respects custom decimal places', () => {
      expect(formatChange(115, 100, 1)).toBe('+15.0%');
    });
  });

  describe('truncate', () => {
    it('does not truncate strings shorter than maxLen', () => {
      expect(truncate('hello', 10)).toBe('hello');
    });

    it('does not truncate strings exactly at maxLen', () => {
      expect(truncate('hello', 5)).toBe('hello');
    });

    it('truncates and appends ellipsis for long strings', () => {
      expect(truncate('hello world', 5)).toBe('hello...');
    });

    it('handles empty string', () => {
      expect(truncate('', 5)).toBe('');
    });
  });
});
