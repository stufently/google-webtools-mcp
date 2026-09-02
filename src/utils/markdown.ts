/**
 * Markdown output safety.
 *
 * Every string that reaches a report cell from outside — a search query, a URL,
 * a structured-data item name, an API error message — is written by someone
 * else. Anyone can make a page rank for a query they chose, and a page's own
 * JSON-LD names its own entities.
 */

/**
 * Makes an arbitrary string safe to drop into a markdown table cell.
 *
 * An unescaped `|` silently corrupts the table, and a newline plus `##` lets
 * crafted text pose as our own headings to whatever model reads this output.
 * Collapse the whitespace, neutralise the delimiters.
 *
 * This matters more since inspection strings are HTML-decoded on ingest: what
 * arrives as `&#124;` or `&#10;` becomes a real pipe or newline before it ever
 * reaches a cell.
 */
export function escapeTableCell(value: string): string {
  return value
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/[<>]/g, (c) => (c === '<' ? '&lt;' : '&gt;'))
    .trim();
}
