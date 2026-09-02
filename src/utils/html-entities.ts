/**
 * HTML entity decoding for strings that arrive already escaped.
 *
 * The URL Inspection API hands back display labels with HTML entities baked in
 * -- `richResultType` for a Q&A page comes over the wire as `Q&amp;A`. Our
 * output is markdown, not HTML, so nothing downstream ever decodes it and the
 * literal `&amp;` reaches the reader. Decode on ingest instead, and keep the
 * escaping decisions where the markdown is built.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/**
 * Decodes the named and numeric HTML entities that appear in API display
 * strings. Unknown entities are left untouched rather than mangled.
 *
 * `&amp;` is handled last by construction: the pattern matches whole entities
 * in one pass, so `&amp;lt;` decodes to the literal text `&lt;` rather than
 * being decoded twice into `<`.
 */
export function decodeHtmlEntities(value: string): string {
  return value.replace(
    /&(#\d+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g,
    (match, entity: string) => {
      if (entity.startsWith('#')) {
        const codePoint = entity[1] === 'x' || entity[1] === 'X'
          ? Number.parseInt(entity.slice(2), 16)
          : Number.parseInt(entity.slice(1), 10);
        if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
          return match;
        }
        try {
          return String.fromCodePoint(codePoint);
        } catch {
          return match;
        }
      }
      const named = NAMED_ENTITIES[entity.toLowerCase()];
      return named ?? match;
    },
  );
}
