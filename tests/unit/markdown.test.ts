import { describe, it, expect } from 'vitest';
import { escapeTableCell } from '../../src/utils/markdown.js';
import { escapeTableCell as reExported } from '../../src/tools/opportunities/index.js';
import { decodeHtmlEntities } from '../../src/utils/html-entities.js';

describe('escapeTableCell', () => {
  it('escapes a pipe so external text cannot shift the table', () => {
    expect(escapeTableCell('Widget | Pro')).toBe('Widget \\| Pro');
  });

  it('escapes a backslash before the pipe, so an escape cannot be faked', () => {
    // Without escaping the backslash, "a\|b" would arrive as an already-escaped
    // pipe and the cell boundary would move.
    expect(escapeTableCell('a\\|b')).toBe('a\\\\\\|b');
  });

  it('neutralises angle brackets', () => {
    expect(escapeTableCell('<script>')).toBe('&lt;script&gt;');
  });

  it('collapses newlines that would end the table early', () => {
    expect(escapeTableCell('line one\n## Heading')).toBe('line one ## Heading');
  });

  it('handles the pipe and newline that HTML decoding produces', () => {
    // `&#124;` and `&#10;` are decoded on ingest now, so they reach a cell as a
    // real pipe and a real newline.
    const decoded = decodeHtmlEntities('a&#124;b&#10;c');

    expect(decoded).toBe('a|b\nc');
    expect(escapeTableCell(decoded)).toBe('a\\|b c');
  });

  it('leaves ordinary text alone', () => {
    expect(escapeTableCell('Product snippets')).toBe('Product snippets');
  });

  it('is the same function the opportunity tools use', () => {
    expect(reExported).toBe(escapeTableCell);
  });
});
