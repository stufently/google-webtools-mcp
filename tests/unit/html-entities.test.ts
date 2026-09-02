import { describe, it, expect } from 'vitest';
import { decodeHtmlEntities } from '../../src/utils/html-entities.js';

describe('decodeHtmlEntities', () => {
  it('decodes the label Google actually sends for a Q&A page', () => {
    // The live output printed "Q&amp;A" as a rich result type, because the API
    // hands the label over HTML-escaped and our output is markdown.
    expect(decodeHtmlEntities('Q&amp;A')).toBe('Q&A');
  });

  it('decodes the other named entities that show up in API strings', () => {
    expect(decodeHtmlEntities('&lt;div&gt; &quot;x&quot; &apos;y&apos;')).toBe('<div> "x" \'y\'');
  });

  it('decodes decimal and hexadecimal references', () => {
    expect(decodeHtmlEntities('&#38;')).toBe('&');
    expect(decodeHtmlEntities('&#x26;')).toBe('&');
  });

  it('does not decode twice', () => {
    // "&amp;lt;" means the literal text "&lt;", not "<".
    expect(decodeHtmlEntities('&amp;lt;')).toBe('&lt;');
  });

  it('leaves unknown entities alone instead of mangling them', () => {
    expect(decodeHtmlEntities('&notanentity;')).toBe('&notanentity;');
  });

  it('leaves a bare ampersand alone', () => {
    expect(decodeHtmlEntities('Q&A')).toBe('Q&A');
  });

  it('leaves out-of-range code points alone', () => {
    expect(decodeHtmlEntities('&#1114112;')).toBe('&#1114112;');
  });

  it('passes plain text through untouched', () => {
    expect(decodeHtmlEntities('Product snippets')).toBe('Product snippets');
  });
});
