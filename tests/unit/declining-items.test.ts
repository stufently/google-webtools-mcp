import { describe, it, expect } from 'vitest';
import { findDecliningItems, escapeTableCell } from '../../src/tools/opportunities/index.js';
import type { SearchAnalyticsRow } from '../../src/api/types.js';

/** Builds a SearchAnalyticsRow with sane defaults for the fields under test. */
function row(
  key: string,
  clicks: number,
  opts: { impressions?: number; position?: number } = {},
): SearchAnalyticsRow {
  const impressions = opts.impressions ?? clicks * 10;
  return {
    keys: [key],
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : 0,
    position: opts.position ?? 5,
  };
}

describe('findDecliningItems', () => {
  it('finds items whose clicks fell by more than the threshold', () => {
    const current = [row('/a', 40)];
    const previous = [row('/a', 100)];

    const declining = findDecliningItems(current, previous, 10);

    expect(declining).toHaveLength(1);
    expect(declining[0]?.key).toBe('/a');
    expect(declining[0]?.previousClicks).toBe(100);
    expect(declining[0]?.currentClicks).toBe(40);
    expect(declining[0]?.clickChange).toBe(-60);
    expect(declining[0]?.clickChangePct).toBeCloseTo(-60);
    expect(declining[0]?.trafficImpact).toBe(60);
  });

  it('is dimension-agnostic and works on query strings, not just page URLs', () => {
    const current = [row('blue widgets', 5)];
    const previous = [row('blue widgets', 50)];

    const declining = findDecliningItems(current, previous, 10);

    expect(declining).toHaveLength(1);
    expect(declining[0]?.key).toBe('blue widgets');
  });

  it('ignores declines shallower than the 20% default threshold', () => {
    // 100 -> 90 is a 10% drop: not significant.
    const declining = findDecliningItems([row('/a', 90)], [row('/a', 100)], 10);
    expect(declining).toEqual([]);
  });

  it('excludes a decline of exactly the threshold, matching "more than 20%"', () => {
    // 100 -> 80 is exactly -20%, which the threshold comparison excludes.
    expect(findDecliningItems([row('/a', 80)], [row('/a', 100)], 10)).toEqual([]);
    // One click further and it qualifies.
    expect(findDecliningItems([row('/a', 79)], [row('/a', 100)], 10)).toHaveLength(1);
  });

  it('catches items that vanished from the current period entirely', () => {
    // The worst decline of all: previously had traffic, now returns no row.
    // Walking the current rows would miss this completely.
    const declining = findDecliningItems([], [row('/gone', 100)], 10);

    expect(declining).toHaveLength(1);
    expect(declining[0]?.key).toBe('/gone');
    expect(declining[0]?.currentClicks).toBe(0);
    expect(declining[0]?.clickChangePct).toBeCloseTo(-100);
    expect(declining[0]?.trafficImpact).toBe(100);
    expect(declining[0]?.missingFromCurrent).toBe(true);
  });

  it('does not invent position movement for vanished items', () => {
    const declining = findDecliningItems([], [row('/gone', 100, { position: 4 })], 10);

    // Position is unknown, not zero, so no move is claimed.
    expect(declining[0]?.positionChange).toBe(0);
    expect(declining[0]?.currentImpressions).toBe(0);
    expect(declining[0]?.previousPosition).toBe(4);
  });

  it('marks surviving items as present', () => {
    const declining = findDecliningItems([row('/a', 10)], [row('/a', 100)], 10);
    expect(declining[0]?.missingFromCurrent).toBe(false);
  });

  it('honours a custom decline threshold', () => {
    const current = [row('/a', 90)];
    const previous = [row('/a', 100)];

    expect(findDecliningItems(current, previous, 10, -5)).toHaveLength(1);
    expect(findDecliningItems(current, previous, 10, -50)).toHaveLength(0);
  });

  it('skips items below the minimum previous-clicks floor', () => {
    // Fell to zero, but was never big enough to care about.
    const declining = findDecliningItems([row('/a', 0)], [row('/a', 3)], 10);
    expect(declining).toEqual([]);
  });

  it('applies the floor to vanished items too', () => {
    // Disappeared, but only ever had 3 clicks: still noise.
    expect(findDecliningItems([], [row('/a', 3)], 10)).toEqual([]);
  });

  it('excludes items absent from the previous period', () => {
    // A brand new page is not a decline, so /new must not be reported.
    // /old, which had traffic and now has none, must be.
    const declining = findDecliningItems([row('/new', 5)], [row('/old', 100)], 10);

    expect(declining.map((d) => d.key)).toEqual(['/old']);
    expect(declining[0]?.missingFromCurrent).toBe(true);
  });

  it('reports nothing when the only item is brand new', () => {
    expect(findDecliningItems([row('/new', 5)], [], 10)).toEqual([]);
  });

  it('excludes items that grew', () => {
    const declining = findDecliningItems([row('/a', 200)], [row('/a', 100)], 10);
    expect(declining).toEqual([]);
  });

  it('sorts by traffic impact, biggest loss first', () => {
    const current = [row('/small', 1), row('/big', 100), row('/mid', 10)];
    const previous = [row('/small', 20), row('/big', 500), row('/mid', 60)];

    const declining = findDecliningItems(current, previous, 10);

    expect(declining.map((d) => d.key)).toEqual(['/big', '/mid', '/small']);
    expect(declining.map((d) => d.trafficImpact)).toEqual([400, 50, 19]);
  });

  it('reports position movement with positive meaning worse', () => {
    const current = [row('/a', 10, { position: 8 })];
    const previous = [row('/a', 100, { position: 3 })];

    const declining = findDecliningItems(current, previous, 10);

    expect(declining[0]?.positionChange).toBeCloseTo(5);
    expect(declining[0]?.previousPosition).toBe(3);
    expect(declining[0]?.currentPosition).toBe(8);
  });

  it('carries impressions through for downstream categorisation', () => {
    const current = [row('/a', 10, { impressions: 200 })];
    const previous = [row('/a', 100, { impressions: 1000 })];

    const declining = findDecliningItems(current, previous, 10);

    expect(declining[0]?.currentImpressions).toBe(200);
    expect(declining[0]?.previousImpressions).toBe(1000);
  });

  it('returns an empty array when nothing declined', () => {
    expect(findDecliningItems([], [], 10)).toEqual([]);
  });
});

describe('escapeTableCell', () => {
  it('leaves ordinary text alone', () => {
    expect(escapeTableCell('blue widgets')).toBe('blue widgets');
  });

  it('escapes pipes so a query cannot forge extra columns', () => {
    expect(escapeTableCell('alpha | beta')).toBe('alpha \\| beta');
  });

  it('flattens newlines so a query cannot forge new rows or headings', () => {
    expect(escapeTableCell('alpha\n## Injected Heading')).toBe('alpha ## Injected Heading');
    expect(escapeTableCell('alpha\r\nbeta')).toBe('alpha beta');
    expect(escapeTableCell('alpha\tbeta')).toBe('alpha beta');
  });

  it('neutralises HTML angle brackets', () => {
    expect(escapeTableCell('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    );
  });

  it('escapes backslashes before pipes so the escape cannot be escaped', () => {
    // A trailing backslash must not turn our own \| into a literal backslash
    // followed by an active pipe.
    expect(escapeTableCell('a\\|b')).toBe('a\\\\\\|b');
  });

  it('trims surrounding whitespace left by flattening', () => {
    expect(escapeTableCell('  padded  ')).toBe('padded');
    expect(escapeTableCell('\nlead')).toBe('lead');
  });
});
