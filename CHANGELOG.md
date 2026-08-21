# Changelog

All notable changes to this project are documented here.

## [Unreleased]

### Changed

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

No server code was changed.
