# google-webtools-mcp

An MCP server that gives an AI agent direct access to **Google Search Console** and **Google Analytics 4** — property management, search performance analysis, indexing checks, GA4 reporting, and site verification.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.0.0-green.svg)](https://nodejs.org/)

---

## For AI agents

If an agent is driving this server, point it at **[SKILL.md](SKILL.md)** first
(Russian). It covers the working order — property discovery, verification,
sitemaps, indexing checks, the regular audit path — how to read a URL Inspection
result, what Search Console does *not* expose, which calls burn quota, and which
tools write to live configuration.

---

## What it does

The server exposes **39 tools** built on five Google APIs:

| API | Used for |
| --- | --- |
| Search Console API (`webmasters` v3) | Properties, sitemaps, search analytics |
| Search Console API (`searchconsole` v1) | URL Inspection |
| Google Analytics Admin API (v1beta) | GA4 accounts, properties, data streams |
| Google Analytics Data API (v1beta) | GA4 reports, realtime, metadata |
| Site Verification API (v1) | Verification tokens, ownership verification |

Beyond raw API access, tool responses are post-processed by a local analysis layer:
position-based CTR benchmarks, trend detection, query intent classification,
opportunity scoring, and a recommendation engine. Most tools return a readable
`Summary` and `Data` block rather than bare JSON, plus `Recommendations` and
`Limitations` sections when there is something worth saying.

Infrastructure: an in-memory TTL+LRU cache (search analytics 15 min when the
range ends within the last 2 days and 1 h once it is older, sitemaps 15 min,
site lists 30 min, URL inspections 1 h), a rate limiter (20 req/s, burst 30),
and two transports — stdio (default) and stateless Streamable HTTP.

---

## Tools

### Search Console properties (4)

| Tool | When to use |
| --- | --- |
| `list_properties` | Starting point — see every GSC property you can access and your permission level on each. |
| `get_property_details` | Check the type and permission level of one specific property. |
| `add_property` | Register a new site in Search Console (verification is a separate step). |
| `delete_property` | Drop a property from the authenticated account's Search Console site list. Historical data is not destroyed — the property can be added back. |

### Sitemaps (4)

| Tool | When to use |
| --- | --- |
| `list_sitemaps` | See which sitemaps are submitted and whether Google reports errors or warnings. |
| `get_sitemap_details` | Drill into one sitemap: URL counts by content type, last download time, error and warning counts. |
| `submit_sitemap` | Submit a new sitemap after publishing or moving one. |
| `delete_sitemap` | Withdraw a sitemap that is stale, duplicated, or returning errors. |

### Search performance (6)

| Tool | When to use |
| --- | --- |
| `get_search_analytics` | The raw query — full control over dimensions, filters, search type, row limit, data state, aggregation. Use when the shaped tools below don't fit. |
| `get_performance_summary` | "How are we doing?" — clicks, impressions, CTR, position with period-over-period comparison. Trend advice is withheld when the previous period returned no data at all. |
| `compare_periods` | Compare two explicit date ranges side by side (before/after a release, seasonal comparison). |
| `get_top_queries` | Top queries by clicks, each scored against the CTR benchmark for its position. |
| `get_top_pages` | Top pages by clicks with the same CTR analysis. |
| `get_traffic_by_device` | Split traffic across desktop, mobile, and tablet — spot device-specific problems. |

### Opportunities (5)

| Tool | When to use |
| --- | --- |
| `find_quick_wins` | "Where is money left on the table?" — query/page pairs ranking well but under-clicked, and those sitting just off page 1. Each pair lands in exactly one bucket (CTR 1-3, quick gain >3 to 10, page two >10 to 20), so the counts and click estimates add up over the period you asked for. |
| `find_declining_content` | Catch traffic loss while it is still recoverable — compares the current period against the previous one and reports declining pages and declining queries as two separate rankings. |
| `find_ctr_opportunities` | Find pages whose CTR is far below the benchmark for their position, with per-page fix suggestions. |
| `find_content_gaps` | Queries landing on the wrong page, high-impression zero-click queries, topics that need a dedicated page. |
| `find_what_to_build_next` | Content planning — groups queries by user intent (question, comparison, problem, buying) into topic clusters. |

### Indexing (3)

| Tool | When to use |
| --- | --- |
| `inspect_url` | Why is this one URL not showing up? Indexing status, mobile usability, rich results — including the per-item validation issues behind a FAIL verdict. |
| `batch_inspect_urls` | Same check across a list of URLs (max 50 per call). |
| `check_indexing_issues` | Audit your top traffic pages for indexing failures, canonical mismatches, missing canonicals, and mobile problems. A URL the API errors on is reported as not inspected; the rest of the audit still runs. |

### Query analysis (3)

| Tool | When to use |
| --- | --- |
| `analyze_query_landscape` | Understand the shape of your demand — intent mix, branded vs non-branded, position distribution. |
| `find_new_queries` | Surface genuinely new and fast-rising queries by diffing this period against the previous one. |
| `find_cannibalization` | Detect several of your own pages competing for the same query. The winner is the page with the most clicks, not the best average position, and queries where only one page carries real volume get no consolidation advice. |

### Reports (2)

| Tool | When to use |
| --- | --- |
| `weekly_seo_report` | One-call weekly digest: trends, growers, decliners, quick wins, sitemap health, prioritized actions. |
| `seo_health_check` | Overall A–F grade with sub-scores for traffic trend, CTR efficiency, position distribution, and sitemap health. |

### GA4 administration (7)

| Tool | When to use |
| --- | --- |
| `ga4_list_accounts` | See every GA4 account and property the credentials can reach. |
| `ga4_list_properties` | List properties under one specific account. |
| `ga4_get_property` | Inspect a property's configuration. |
| `ga4_create_property` | Provision a new GA4 property. **Write operation.** |
| `ga4_create_data_stream` | Create a web data stream and get back its measurement ID (for installing the tag). **Write operation.** |
| `ga4_list_data_streams` | List a property's data streams. |
| `ga4_get_data_stream` | Get one data stream's details, including its measurement ID. |

### GA4 reporting (3)

| Tool | When to use |
| --- | --- |
| `ga4_run_report` | Any GA4 report — pick metrics, dimensions, and a date range (absolute or relative like `28daysAgo`). |
| `ga4_run_realtime_report` | Who is on the site right now. |
| `ga4_get_metadata` | Discover which dimensions and metrics (including custom ones) a property supports — run this before guessing metric names. |

### Site verification (2)

| Tool | When to use |
| --- | --- |
| `gsc_get_verification_token` | Get the token to place, plus method-specific instructions. Methods: `FILE`, `DNS_TXT`, `META`, `ANALYTICS`. |
| `gsc_verify_site` | Complete verification once the token is in place. |

---

## Setup

### 1. Get Google credentials

Enable these APIs in your Google Cloud project: **Search Console API**,
**Google Analytics Admin API**, **Google Analytics Data API**, and
**Site Verification API**.

The server requests these OAuth scopes:

```
https://www.googleapis.com/auth/webmasters
https://www.googleapis.com/auth/analytics.readonly
https://www.googleapis.com/auth/analytics.edit
https://www.googleapis.com/auth/siteverification.verify_only
```

**Option A — Service account** (best for servers and automation):

1. Google Cloud Console → IAM & Admin → Service Accounts → create one.
2. Add a key → Create new key → JSON → download it.
3. In Search Console → Settings → Users and permissions → add the service
   account's email address.
4. In GA4 → Admin → Property access management → add the same email.

**Option B — OAuth 2.0** (best for personal, local use):

1. Google Cloud Console → APIs & Services → Credentials → Create credentials →
   OAuth client ID → **Desktop app**.
2. Download the client secrets JSON.
3. On first run, the server prints an authorization URL to stderr and starts a
   temporary local callback listener. Open the URL, consent, done.
4. The token is stored at `~/.google-webtools-mcp/token.json` and refreshed
   automatically, so you authorize only once.

### 2. Environment variables

| Variable | Purpose |
| --- | --- |
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to a service account JSON key file. |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | The service account key as an inline JSON string — for Docker and CI, where mounting a file is awkward. |
| `GSC_OAUTH_CLIENT_SECRETS_FILE` | Path to an OAuth client secrets JSON file. |
| `PORT` | HTTP transport port. Default `3000`. Only read with `--http`. |

Authentication methods are tried in this order, and the first one that yields
usable credentials wins. A method that fails is recorded and the next one is
tried: if `GOOGLE_APPLICATION_CREDENTIALS` points at a missing or malformed
file, the server does not stop there — with OAuth configured (and a saved token)
it starts under the OAuth account instead. Check the `[auth] Authenticated via …`
line on stderr to see which identity was actually used.

1. Service account — `GOOGLE_APPLICATION_CREDENTIALS`, then `GOOGLE_SERVICE_ACCOUNT_KEY`,
   then `./credentials.json` if its `type` is `service_account`.
2. Application Default Credentials (`gcloud auth application-default login`) —
   skipped if `GOOGLE_APPLICATION_CREDENTIALS` is set.
3. OAuth via `GSC_OAUTH_CLIENT_SECRETS_FILE`.
4. `./credentials.json` in the working directory, if it looks like OAuth client
   secrets (has an `installed` or `web` key).

If none succeed, the server prints a setup guide and exits.

### 3. Install

```bash
docker run -i --rm \
  -v /absolute/path/to/service-account.json:/creds/sa.json:ro \
  -e GOOGLE_APPLICATION_CREDENTIALS=/creds/sa.json \
  ghcr.io/stufently/google-webtools-mcp:1.2.0
```

Replace `/absolute/path/to/service-account.json` with the key file from step 1 (Docker needs an absolute path), then paste the command. Docker pulls the image on the first run (amd64 and arm64), so nothing else needs installing. It should print `Server running on stdio` to stderr and wait for a client (Ctrl+C to quit). Every client block below runs this same `docker run`; the key file is mounted read-only and never written into the client config.

The image covers the service account. OAuth does not work in a container on the first run (see [Docker](#docker)); for OAuth, [build from source](#build-from-source).

---

## Connecting it

Each block below starts the server with `docker` and the arguments from the install command above. The only thing to change is `/absolute/path/to/service-account.json`.

### Claude Code

Project file `.mcp.json`, at the root of the project:

```json
{
  "mcpServers": {
    "google-webtools": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "-v",
        "/absolute/path/to/service-account.json:/creds/sa.json:ro",
        "-e",
        "GOOGLE_APPLICATION_CREDENTIALS=/creds/sa.json",
        "ghcr.io/stufently/google-webtools-mcp:1.2.0"
      ]
    }
  }
}
```

The same server can be registered from a terminal:

```bash
claude mcp add google-webtools -- docker run -i --rm \
  -v /absolute/path/to/service-account.json:/creds/sa.json:ro \
  -e GOOGLE_APPLICATION_CREDENTIALS=/creds/sa.json \
  ghcr.io/stufently/google-webtools-mcp:1.2.0
```

Add `--scope user` to make it available in every project.

### Claude Desktop

`claude_desktop_config.json` — macOS `~/Library/Application Support/Claude/claude_desktop_config.json`, Windows `%APPDATA%\Claude\claude_desktop_config.json`, Linux `~/.config/Claude/claude_desktop_config.json`. Restart Claude Desktop after saving.

```json
{
  "mcpServers": {
    "google-webtools": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "-v",
        "/absolute/path/to/service-account.json:/creds/sa.json:ro",
        "-e",
        "GOOGLE_APPLICATION_CREDENTIALS=/creds/sa.json",
        "ghcr.io/stufently/google-webtools-mcp:1.2.0"
      ]
    }
  }
}
```

Claude Desktop can also install this server in one click. Download the `.mcpb` from https://github.com/stufently/google-webtools-mcp/releases/latest and open it. Desktop asks for the service account JSON key, which must belong to an account added in Search Console and GA4.

### Cursor

`~/.cursor/mcp.json`, or `.cursor/mcp.json` in a project:

```json
{
  "mcpServers": {
    "google-webtools": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "-v",
        "/absolute/path/to/service-account.json:/creds/sa.json:ro",
        "-e",
        "GOOGLE_APPLICATION_CREDENTIALS=/creds/sa.json",
        "ghcr.io/stufently/google-webtools-mcp:1.2.0"
      ]
    }
  }
}
```

### Windsurf

`mcp_config.json`. On macOS and Linux that is `~/.config/devin/mcp_config.json` (or `$XDG_CONFIG_HOME/devin/mcp_config.json`). On Windows it is `%APPDATA%\devin\mcp_config.json`. Older builds used `~/.codeium/windsurf/mcp_config.json`.

```json
{
  "mcpServers": {
    "google-webtools": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "-v",
        "/absolute/path/to/service-account.json:/creds/sa.json:ro",
        "-e",
        "GOOGLE_APPLICATION_CREDENTIALS=/creds/sa.json",
        "ghcr.io/stufently/google-webtools-mcp:1.2.0"
      ]
    }
  }
}
```

### Zed

Zed calls MCP servers context servers. The file is `settings.json` (`zed: open settings`):

```json
{
  "context_servers": {
    "google-webtools": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "-v",
        "/absolute/path/to/service-account.json:/creds/sa.json:ro",
        "-e",
        "GOOGLE_APPLICATION_CREDENTIALS=/creds/sa.json",
        "ghcr.io/stufently/google-webtools-mcp:1.2.0"
      ],
      "env": {}
    }
  }
}
```

### Codex

```bash
codex mcp add google-webtools -- docker run -i --rm \
  -v /absolute/path/to/service-account.json:/creds/sa.json:ro \
  -e GOOGLE_APPLICATION_CREDENTIALS=/creds/sa.json \
  ghcr.io/stufently/google-webtools-mcp:1.2.0
```

Or by hand, in `~/.codex/config.toml`:

```toml
[mcp_servers.google-webtools]
command = "docker"
args = [
  "run", "-i", "--rm",
  "-v", "/absolute/path/to/service-account.json:/creds/sa.json:ro",
  "-e", "GOOGLE_APPLICATION_CREDENTIALS=/creds/sa.json",
  "ghcr.io/stufently/google-webtools-mcp:1.2.0",
]
```

### Key as a string instead of a file

Where mounting a file is awkward (CI, a remote runner), pass the whole key JSON
in `GOOGLE_SERVICE_ACCOUNT_KEY` and let Docker forward it from the environment:
replace the `-v …` and `-e GOOGLE_APPLICATION_CREDENTIALS=…` arguments with
`-e GOOGLE_SERVICE_ACCOUNT_KEY`, and set the variable in your shell
(`export GOOGLE_SERVICE_ACCOUNT_KEY="$(cat service-account.json)"`) or in the
client's `env` block. Inside a JSON or TOML config the key must be a single
escaped string, not pasted JSON: `jq -c . service-account.json | jq -R .`
prints it ready to paste. This is
also what the [MCP registry](https://registry.modelcontextprotocol.io) entry
`io.github.stufently/google-webtools-mcp` asks for.

### Build from source

Needed for OAuth, or to run without Docker. Requires Node.js 22 or newer.

```bash
git clone https://github.com/stufently/google-webtools-mcp.git
cd google-webtools-mcp
npm install
npm run build
```

Then use `node` as the command and `/path/to/google-webtools-mcp/dist/cli.js` as its only argument, with the credentials in `env`, for example:

```bash
claude mcp add google-webtools \
  --env GSC_OAUTH_CLIENT_SECRETS_FILE=/path/to/client-secrets.json \
  -- node /path/to/google-webtools-mcp/dist/cli.js
```

### HTTP transport

For a client that talks to the server over the network instead of spawning it. The mode is **stateless**: every `POST /mcp` is handled by a fresh MCP server instance, no `Mcp-Session-Id` is issued, and requests can run in parallel. The Google credentials, cache and rate limiter are shared across requests.

```bash
node dist/cli.js --http           # listens on :3000
PORT=8080 node dist/cli.js --http # or pick a port
```

Endpoints:

- `POST /mcp` — MCP JSON-RPC (Streamable HTTP). Send `Accept: application/json, text/event-stream`.
- `GET /health` — liveness, returns `{"status":"ok","auth":"<method>"}`.
- `GET`/`DELETE /mcp` return 405: there is no server-to-client stream and no session to terminate.

There is no authentication on the HTTP endpoint and it listens on all interfaces, while the tools act with your Google credentials (including write tools). Keep it on localhost or behind an authenticating proxy.

### Docker

The OAuth consent callback listens on a random port on `127.0.0.1` *inside* the container, so a browser on the host cannot reach it and a first OAuth run in Docker times out. Either use a service account (the install command above), or authorize once outside Docker and copy `~/.google-webtools-mcp/token.json` into the token volume.

```bash
docker compose up --build
```

The bundled `docker-compose.yml` mounts `./credentials` read-only and keeps the OAuth token in a named volume so it survives container rebuilds. The `Dockerfile` compiles the TypeScript itself, so no local `dist/` is needed; it is the same build that is published to GHCR.

---

## Example prompts

- Why did my site lose clicks last week?
- Which pages rank close to page one but get almost no clicks?
- Are these URLs indexed, and what is wrong with the ones that are not?
- What should we publish next, based on the queries we already show up for?
- How is search traffic split between phones and desktops?

## More prompts

- Create a GA4 property for example.com with a web stream and give me the measurement id to install.
- Where are my own pages competing for the same query?

---

## Limitations

- **Search Console data lag.** Search analytics data is typically 2–3 days
  behind, and the lag drifts. Every named period (`last7d`, `last28d`, …) is
  therefore anchored to the last day the API reports as complete — read from
  the `first_incomplete_date` the API returns for a `dataState: "all"` query
  grouped by date — rather than to yesterday, so the newest
  days are excluded on purpose and period-over-period comparisons are not
  distorted by a half-collected tail. `get_search_analytics` still takes an
  explicit `dataState` and explicit dates when you want the fresh edge.
- **16 months of history, maximum.** That is a Search Console API limit, not a
  server limit.
- **Row sampling and caps.** Search analytics is capped at 25,000 rows per
  request; GA4 reports at 100,000. Large GA4 date ranges may be sampled by Google.
- **`batch_inspect_urls` handles 50 URLs per call**, and the URL Inspection API
  has its own daily quota per property.
- **Site verification is not one-click.** The server hands you a token and
  instructions; you still have to place the file, DNS record, or meta tag
  yourself before calling `gsc_verify_site`.
- **Domain properties can't use FILE or META verification** — use `DNS_TXT`.
- **No Google Ads, PageSpeed Insights, CrUX, or Indexing API.** This server
  covers Search Console, GA4, and Site Verification only.
- **Cache is in-memory and per-process.** It resets whenever the server restarts
  and is not shared between instances.
- **Write operations are real.** `add_property`, `delete_property`,
  `submit_sitemap`, `delete_sitemap`, `ga4_create_property`,
  `ga4_create_data_stream`, and `gsc_verify_site` change live configuration, and
  there is no dry-run mode. The Search Console ones are reversible by re-adding
  the property or re-submitting the sitemap; a created GA4 property or data
  stream is not something this server can remove.

---

## Development

```bash
npm install
npm run build      # bundle with tsup
npm run dev        # rebuild on change
npm test           # vitest
npm run lint       # tsc --noEmit
```

Requires Node.js 22 or newer.

### Releasing

The version lives in `package.json`. `server.json` (the MCP registry entry) and
every `ghcr.io/stufently/google-webtools-mcp:<tag>` in this README are derived
from it, never edited by hand:

```bash
npm version patch --no-git-tag-version   # or minor / major
# Docker instead of a local Node:
# docker run --rm -u "$(id -u):$(id -g)" -v "$PWD":/app -w /app node:24-slim \
#   npm version patch --no-git-tag-version
```

`npm version` bumps `package.json` and the lockfile, then its `version`
lifecycle script (`scripts/sync-version.mjs`) rewrites `server.json` and the
image tags here (a plain `npm version patch` also stages them, so its own
commit and tag are complete — but tag only after CI is green, as below). Add a
`CHANGELOG.md` section, commit, push to `main` and wait
for CI — its `Versions agree` step (`npm run check:version`) fails if any of
the three disagree. Then tag and push the tag:

```bash
git tag v1.2.3 && git push origin v1.2.3
```

The `Publish` workflow builds and pushes the image (`:<version>` and
`:latest`) and publishes `server.json` to the MCP registry; it refuses a tag
that differs from `package.json`. The `MCPB` workflow, on the same tag,
builds the Desktop Extension with `scripts/build-mcpb.sh` and uploads
`dist-mcpb/*.mcpb` to the GitHub Release. It does not push the image or
the registry entry.

---

## Credits

This project started as a fork of
[awesome-gsc-mcp](https://github.com/Magdoub/awesome-gsc-mcp) by Magdoub, which
provided the Search Console tools, the analysis layer (CTR benchmarks, trend
detection, query classification, opportunity scoring, recommendations), the
cache and the rate limiter. The GA4 Admin/Data and Site Verification tools, the
authentication rework and the later fixes were added here. The original is
published under the MIT license.

---

## License

MIT — see [LICENSE](LICENSE). The copyright notice of the original project is
kept alongside this one.
