# Changelog

All notable changes to this project are documented here.

## [Unreleased]

### Added

- **Continuous integration (`.github/workflows/ci.yml`).** The repository had no
  workflows at all: the 162 unit tests only ever ran when someone remembered to
  run them by hand, so a broken push looked exactly like a healthy one. Every
  push and pull request against `main` now runs install → lint (`tsc --noEmit`,
  which is also the typecheck) → test → build on Node 20, 22 and 24. Node 20 is
  past EOL (April 2026) but is still what the project promises — `engines` says
  `>=20`, tsup targets `node20` and the `Dockerfile` runs `node:20-slim` — so it
  is verified until that floor is raised rather than quietly left untested; 22
  and 24 are the supported LTS lines. No ESLint or Prettier exists in this project,
  so there is no separate lint or format-check step, and no Docker workflow was
  added — the image is a local convenience build (its `Dockerfile` copies a
  pre-built `dist/`) and is not published to any registry.

### Fixed

- **`find_declining_content` now actually returns declining queries.** Its tool
  description promised "pages and queries losing traffic", but both API calls
  requested `dimensions: ['page']` — the query side was never fetched, so the
  description misled the calling model about what the tool returns. The tool now
  queries both dimensions for both periods (four parallel calls) and renders a
  `Top Declining Queries` table alongside the existing page table. A page can
  look flat while the individual queries feeding it collapse, which is precisely
  the case the tool previously could not surface.
  - The "nothing declined" early return now fires only when *both* pages and
    queries are clean, instead of suppressing query results whenever no page
    declined.
  - The page-based `Diagnosis Guide` and its three subsection headings are now
    rendered only when there are declining pages, rather than emitting empty
    headings.
  - Output states explicitly that page and query click totals overlap and must
    not be summed, and notes that Google's anonymized low-volume queries keep
    query totals from reconciling with page totals.

- **Total traffic losses are no longer reported as healthy.** Decline detection
  walked the *current* period's rows, so anything that lost all of its traffic —
  deindexed, removed, or fallen below Google's reporting threshold — vanished
  from that set and was silently skipped. The worst possible decline was the one
  case the tool could not see, and it would then claim everything "maintained or
  grew". Detection now walks the *previous* period and looks each value up in
  the current one, so disappearances surface as 100% declines flagged
  `missingFromCurrent`. Their current position renders as `gone` rather than a
  fabricated zero, they get their own "Gone from results entirely" summary row
  instead of polluting the position/CTR buckets, and a recommendation points at
  `inspect_url` for them first.

- **Search queries are escaped before being rendered into markdown tables.**
  Queries and URLs are attacker-influenced — anyone can make a page rank for a
  string they chose. An unescaped `|` corrupted the table, and a newline plus
  `##` let crafted text impersonate the server's own headings to whatever model
  consumed the output. `escapeTableCell()` now flattens CR/LF/tabs and escapes
  backslashes, pipes, and angle brackets. Applied inside `truncateUrl()` and
  `truncateQuery()`, which are used exclusively for table cells, so all five
  opportunity tools are covered.

- Markdown sections no longer render empty or contradictory. The `Diagnosis
  Guide` heading appears only when at least one of its categories is populated
  (previously it could print three empty subsection headings), the page-oriented
  summary table and recommendations are suppressed when only queries declined,
  and the declining-queries blurb no longer refers to a page table that is not
  there.

### Changed

- Decline detection extracted into an exported, dimension-agnostic
  `findDecliningItems()` helper, covered by 23 new unit tests
  (`tests/unit/declining-items.test.ts`). Previously the logic was inlined and
  hardcoded to pages, which is what allowed the dimension mismatch to go
  unnoticed.
- `find_quick_wins` description corrected: it returns query/page **pairs**
  (every output table has both a Query and a Page column), but the description
  called them "pages".

- **README rewritten from scratch against the actual source code.** The previous
  README described a different project entirely: it carried another package's
  name and npm badge, install commands that pulled an unrelated package from
  npm, and an absolute credentials path from someone else's machine. The new
  README documents what this server really does — all 39 tools grouped by
  module with a "when to use" note each, the five Google APIs it calls
  (Search Console `webmasters` v3 and `searchconsole` v1, Analytics Admin
  v1beta, Analytics Data v1beta, Site Verification v1), the real
  authentication precedence and environment variables, copy-paste MCP configs
  for Claude Code / Claude Desktop / Cursor, example prompts, and an honest
  limitations section.
- `package.json`: added `author`, `repository`, `homepage`, and `bugs` pointing
  at `stufently/google-webtools-mcp`; added `url-inspection` and `mcp-server`
  keywords.

### Added

- `LICENSE` — MIT, copyright 2026 stufently. The repository previously declared
  `"license": "MIT"` in `package.json` with no license file present.
