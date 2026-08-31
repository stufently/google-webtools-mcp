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

- **A healthy sitemap is no longer reported as broken.** Search Console returns
  the `errors` and `warnings` counters as *strings*, and the string `"0"` is
  truthy in JavaScript. Every sitemap that had ever been fetched successfully
  was therefore labelled `Status: Error` — printed in the same table as
  `Errors: 0` — and `get_sitemap_details` advised checking a perfectly valid
  file for "XML syntax errors". The same truthiness read appeared about ten
  times across the sitemap and report tools, so the fix is at the boundary
  rather than at each site: `SitemapInfo.errors` and `.warnings` are now
  `number`, parsed once in `toSitemapInfo` (blank, non-numeric and infinite
  values become `undefined`), and every read is an explicit `> 0`. This changes
  the type of two fields on `SitemapInfo`; nothing outside this repository
  consumes it, and the text the MCP tools emit is unchanged apart from no
  longer being wrong. Regression tests pin the live thaigid.top response.

- **Reporting windows no longer end inside Search Console's unsettled tail.**
  Every named period (`last7d`, `last28d`, …) ended at *yesterday*, but Search
  Console keeps collecting the most recent days: with `dataState: "final"` —
  the API's own default, which these tools were relying on implicitly — those
  days are simply absent. The current window therefore ran on a partially
  delivered tail while the comparison window was fully settled, and a property
  with dead-flat traffic could be reported as collapsing. On `last7d` the
  missing tail was two to three days of seven, roughly a third of the window;
  a regression test now pins that exact scenario.
  - Windows end at the last day the API itself reports as complete. A probe
    (`dimensions: ['date']`, `dataState: 'all'`, 14-day lookback) reads
    `metadata.first_incomplete_date` — the day Search Console says it is still
    collecting — and anchors at the day before it, so a lag that drifts to four
    or five days is followed rather than assumed away. The three-day constant
    survives only as a fallback for when the API reports no boundary or the
    probe fails; the probe never throws. The boundary is resolved for the same
    `searchType` the data will be read with.
  - Deliberately *not* "the newest date present in a `final` response": Search
    Console omits days with no traffic, so on a quiet property that reads a gap
    in traffic as a gap in publishing and drags every window back to the last
    day that happened to get a click.
  - That metadata is now surfaced by the API layer (`SearchAnalyticsResponse.metadata`),
    read defensively because the `googleapis` typings for webmasters v3 predate
    the field, and carried through the pagination helpers.
  - The anchor moves the current and previous windows together, so they stay
    equal in length — fixing the tail without introducing an unfair comparison.
  - The five opportunity tools, the query tools, the performance tools and both
    report tools all shared the same `getDateRange`, so all of them shift by
    the same 2–3 days. Numbers for a given period will not match figures
    produced before this change: the window is the same length but ends
    earlier. Explicit-date calls (`get_search_analytics`) are untouched.
  - Opportunity queries now send `dataState: 'final'` explicitly instead of
    inheriting it, and the tool `limitations` and README wording no longer
    describe the lag as something the caller must mentally correct for. The
    tools that take explicit dates (`get_search_analytics`, `compare_periods`)
    say what is true for *them* — that dates inside the unsettled range return
    partial numbers — rather than claiming a trimming they do not do.

- **Month-length windows no longer overshoot on month ends.** `getDateRange`
  moved the start date with `Date.setMonth`, which turns May 31 minus three
  months into March 2 and silently shortens the window; the start is now
  clamped to the last day of the target month (February 29 in a leap year).

- **`getPreviousPeriod` counts calendar days, not 24-hour blocks.** Subtracting
  fixed millisecond spans lands on the wrong date in a timezone where a day is
  occasionally 23 or 25 hours long, which would offset the comparison window by
  a day across a daylight-saving change.

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
