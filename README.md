# awesome-gsc-mcp

**The most powerful Google Search Console MCP server -- analyzes data like an SEO professional with benchmarks, recommendations, and actionable insights.**

[![npm version](https://img.shields.io/npm/v/awesome-gsc-mcp.svg)](https://www.npmjs.com/package/awesome-gsc-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.0.0-green.svg)](https://nodejs.org/)

---

## Demo

Just ask it to analyze your Google Search Console.

<table>
<tr><td>
<img width="600" alt="Demo video" src="https://github.com/user-attachments/assets/0e726a66-4f9d-4e7a-b4dc-8956a9d0b535" />
<br><p align="center"><sub>Ask Claude to analyze your Search Console data</sub></p>
</td></tr>
</table>

<table>
<tr><td>
<img width="600" alt="Demo output" src="https://github.com/user-attachments/assets/1ab4a543-a01b-42d9-b512-7b5bdc3e0de0" />
<br><p align="center"><sub>Here's a sample result</sub></p>
</td></tr>
</table>

---

## Features

- **27 tools** across 7 categories covering every aspect of Google Search Console
- **Smart analysis engine** with CTR benchmarks, trend detection, query intent classification, opportunity scoring, and a recommendation engine
- **In-memory caching** for fast repeat queries
- **Rate limiting** (20 req/s with burst of 30) to stay within API quotas
- **Dual transport** -- stdio (default) and HTTP for flexible integration
- **Auto-detecting authentication** -- service account, OAuth, or auto-detect from `credentials.json`

---

## Installation & Setup

### 1. Get Google Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create [a new project](https://console.cloud.google.com/projectcreate) (or select an existing one)

<details>
<summary><strong>3. Enable the Search Console API</strong></summary>

Enable the [Search Console API](https://console.cloud.google.com/apis/library/searchconsole.googleapis.com)

<table><tr><td>
<img width="600" alt="Enable Search Console API" src="https://github.com/user-attachments/assets/8644a873-d40c-4a3f-a8cf-c9f742866623" />
</td></tr></table>

</details>

<details>
<summary><strong>4. Create credentials</strong></summary>

- Go to **the project you created**
- Click on Credentials in the sidebar
- Create a service account, name it anything, click continue

<table><tr><td>
<img width="600" alt="Create service account" src="https://github.com/user-attachments/assets/2474e4a0-51d4-439d-92a2-f30591f6843c" />
</td></tr></table>

- Open the service account

<table><tr><td>
<img width="600" alt="Open service account" src="https://github.com/user-attachments/assets/ccc56f8f-55f3-47c1-bb5d-bf74e2630aa5" />
</td></tr></table>

- Click on the **Keys** tab

<table><tr><td>
<img width="600" alt="Keys tab" src="https://github.com/user-attachments/assets/c517ed72-2f07-46bd-8893-f80ec367b9cd" />
</td></tr></table>

- Click **Add Key > Create New Key** and select JSON. Save it somewhere familiar and try to rename it to something searchable (e.g. `awesome-gsc-service-account.json`)

<table><tr><td>
<img width="600" alt="Add key menu" src="https://github.com/user-attachments/assets/e1d91457-b770-4d3a-83e5-9f9b8d11199c" />
</td></tr></table>

<table><tr><td>
<img width="600" alt="Download JSON key" src="https://github.com/user-attachments/assets/30d4cedf-82c5-4ab7-b624-f9ff3d0b92ce" />
</td></tr></table>

</details>

<details>
<summary><strong>5. Grant access</strong></summary>

- Open [Google Search Console](https://search.google.com/search-console/)
- Go to [**Settings > Users and permissions**](https://search.google.com/search-console/users)
- Add the service account email as an **Owner** or **Full**

<table><tr><td>
<img width="600" alt="Add service account to Search Console" src="https://github.com/user-attachments/assets/a2847ae9-e980-445c-a1ed-26d3c68b4d27" />
</td></tr></table>

</details>

### 2. Configure Your Client

You're almost done. Now we will just refrence the JSON file you downloaded in step 4 (Create credentials).

**Claude Code**

```bash
claude mcp add awesome-gsc -- npx -y awesome-gsc-mcp \
  -e GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account-key.json
```

> **Tip:** Can't find your key file? Run this to locate it:
> ```bash
> claude -p "find the path of most recently downloaded .json file in ~/Desktop, ~/Documents, and ~/Downloads"
> ```

<details>
<summary><strong>Claude Desktop</strong></summary>

Paste this whole block into Terminal, hit Enter, then restart Claude Desktop.

```bash
cat > ~/Library/Application\ Support/Claude/claude_desktop_config.json << 'EOF'
{
  "mcpServers": {
    "awesome-gsc": {
      "command": "npx",
      "args": ["-y", "awesome-gsc-mcp"],
      "env": {
        "GOOGLE_APPLICATION_CREDENTIALS": "{Path to your json file}"
      }
    }
  }
}
EOF
```

Here is an example:
```
"GOOGLE_APPLICATION_CREDENTIALS": "/Users/Magdoub/Desktop/mobilevitals-service.json"
```

</details>

<details>
<summary><strong>Cursor</strong></summary>

Config file: `.cursor/mcp.json` in your project root (or `~/.cursor/mcp.json` globally)

```json
{
  "mcpServers": {
    "awesome-gsc": {
      "command": "npx",
      "args": ["-y", "awesome-gsc-mcp"],
      "env": {
        "GOOGLE_APPLICATION_CREDENTIALS": "/path/to/service-account-key.json"
      }
    }
  }
}
```

</details>

<details>
<summary><strong>Windsurf</strong></summary>

Config file: `~/.codeium/windsurf/mcp_config.json`

```json
{
  "mcpServers": {
    "awesome-gsc": {
      "command": "npx",
      "args": ["-y", "awesome-gsc-mcp"],
      "env": {
        "GOOGLE_APPLICATION_CREDENTIALS": "/path/to/service-account-key.json"
      }
    }
  }
}
```

</details>

<details>
<summary><strong>Troubleshooting</strong></summary>

| Error | Fix |
| --- | --- |
| `401 Token has been expired or revoked` | Delete `~/.awesome-gsc-mcp/token.json` and re-authorize |
| `403 User does not have sufficient permission` | Add the service account email as **Owner** in Search Console > [Settings > Users and permissions](https://search.google.com/search-console/users) |
| `403 Forbidden` with OAuth | Add yourself as a test user in Google Cloud Console > OAuth consent screen, or publish the app |
| `Could not load the default credentials` | Check that `GOOGLE_APPLICATION_CREDENTIALS` points to a valid key file |

</details>

---

## Tool Reference

<details>
<summary><strong>All 27 tools organized by category</strong></summary>

### Property Management (4 tools)

| Tool | Description |
| --- | --- |
| `list_properties` | List all Search Console properties accessible to the authenticated account |
| `get_property_details` | Get detailed information about a specific property |
| `add_property` | Add a new site to Search Console |
| `delete_property` | Remove a site from Search Console |

### Performance & Traffic (6 tools)

| Tool | Description |
| --- | --- |
| `get_search_analytics` | Query raw search analytics data with flexible parameters (dimensions, filters, date ranges) |
| `get_performance_summary` | High-level performance overview with automatic period-over-period comparison |
| `compare_periods` | Compare search performance between two custom date periods side by side |
| `get_top_queries` | Top search queries by clicks with CTR benchmark analysis |
| `get_top_pages` | Top pages by clicks with CTR analysis and recommendations |
| `get_traffic_by_device` | Traffic breakdown by device type (desktop, mobile, tablet) with mobile-first insights |

### Smart Opportunity Analysis (5 tools)

| Tool | Description |
| --- | --- |
| `find_quick_wins` | Find "money on the table" SEO opportunities: CTR gaps, almost-page-1 queries, quick position gains |
| `find_declining_content` | Find pages and queries losing traffic with root cause diagnosis |
| `find_ctr_opportunities` | Pages with CTR significantly below benchmarks, with position-specific recommendations |
| `find_content_gaps` | Content creation opportunities: homepage-ranking queries, zero-click queries, new emerging queries |
| `find_what_to_build_next` | Intent-based content planning: questions, comparisons, problems, buying signals grouped by topic cluster |

### URL Inspection & Indexing (3 tools)

| Tool | Description |
| --- | --- |
| `inspect_url` | Inspect a URL for indexing status, crawl info, mobile usability, and rich results |
| `batch_inspect_urls` | Inspect multiple URLs in one call |
| `check_indexing_issues` | Identify common indexing problems across your site |

### Sitemap Management (4 tools)

| Tool | Description |
| --- | --- |
| `list_sitemaps` | List all sitemaps submitted for a property |
| `get_sitemap_details` | Get detailed information about a specific sitemap |
| `submit_sitemap` | Submit a new sitemap to Search Console |
| `delete_sitemap` | Remove a sitemap from Search Console |

### Query Intelligence (3 tools)

| Tool | Description |
| --- | --- |
| `analyze_query_landscape` | Intent distribution, branded vs non-branded split, position bucket analysis |
| `find_new_queries` | Discover emerging and truly new queries between periods |
| `find_cannibalization` | Find multiple pages competing for the same query |

### Composite Reports (2 tools)

| Tool | Description |
| --- | --- |
| `weekly_seo_report` | Full weekly SEO performance report with trends, top movers, and recommendations |
| `seo_health_check` | Comprehensive health check with a letter grade and prioritized action items |

</details>

---

## Use Cases & Example Prompts

Once connected to Claude, try these natural language prompts. Copy any of them as-is.

### Getting Started

```
List all my Search Console properties
```
```
How is example.com doing this month?
```
```
Give me a performance summary for the last 3 months
```

### Traffic & Performance Analysis

```
What are my top 20 queries by clicks?
```
```
Show me traffic breakdown by device
```
```
Compare this month's performance vs last month
```
```
What are my top pages for mobile traffic?
```
```
Show me search performance for image search
```

### Finding Quick Wins & Opportunities

```
Find quick win SEO opportunities for my site
```
```
Which pages have CTR below benchmarks?
```
```
Find pages that are almost on page 1 of Google
```
```
What queries could I get more clicks from with better titles?
```

### Content Strategy & Planning

```
What content should I create next?
```
```
What questions are people searching that I should answer?
```
```
Find content gaps — queries ranking on my homepage that need dedicated pages
```
```
Show me new and emerging queries in the last month
```
```
What comparison and "best of" queries is my site appearing for?
```

### Diagnosing Problems

```
Which pages are losing traffic and why?
```
```
Find keyword cannibalization issues
```
```
Are there any indexing issues on my top pages?
```
```
Inspect the URL example.com/blog/my-post for indexing problems
```
```
Which of my pages are not indexed?
```

### Sitemaps & Indexing

```
List all my submitted sitemaps
```
```
Submit my new sitemap at example.com/sitemap.xml
```
```
Check indexing status for my top 50 pages
```
```
Batch inspect these URLs: [url1, url2, url3]
```

### Reporting & Health Checks

```
Generate a weekly SEO report
```
```
Run a full SEO health check and give me a grade
```
```
What are the top 5 things I should fix on my site right now?
```

---

## Analysis Engine

<details>
<summary><strong>Built-in SEO analysis beyond raw data</strong></summary>

The server goes beyond raw data with a built-in analysis engine:

- **CTR Benchmarks** -- Compares your click-through rates against industry-average benchmarks by position. Flags pages that underperform and estimates how many additional clicks you could gain.
- **Trend Detection** -- Analyzes time-series data to detect upward, downward, or stable trends across your queries and pages.
- **Query Classification** -- Classifies queries by user intent (informational, investigational, transactional, navigational, problem-solving) and sub-type (how-to, comparison, review, error/fix, and more).
- **Opportunity Scoring** -- Scores every opportunity by traffic impact potential, factoring in impressions, CTR gap, position proximity, and volume.
- **Recommendation Engine** -- Generates specific, prioritized recommendations based on the data patterns found in your property.

</details>

---

## API Limitations

<details>
<summary><strong>What's not available through the API</strong></summary>

The Google Search Console API has known limitations. The following data is **not available** through the API and therefore not provided by this server:

- **Core Web Vitals** -- Page experience and performance metrics
- **Crawl Stats** -- Crawl requests, response times, host status
- **Manual Actions** -- Penalties and security issues
- **Links Report** -- Internal and external link data
- **Removals** -- URL removal requests
- **Rich Results** -- Detailed rich result reports (basic info is available via URL Inspection)

These reports are only available in the Search Console web interface.

</details>

---

## HTTP Transport

<details>
<summary><strong>Using HTTP instead of stdio</strong></summary>

For environments that prefer HTTP over stdio, start the server with the `--http` flag:

```bash
npx awesome-gsc-mcp --http
```

The server listens on port 3000 by default. Override with the `PORT` environment variable:

```bash
PORT=8080 npx awesome-gsc-mcp --http
```

Endpoints:

| Path | Method | Description |
| --- | --- | --- |
| `/mcp` | POST | MCP protocol endpoint (Streamable HTTP transport) |
| `/health` | GET | Health check -- returns `{"status":"ok","auth":"..."}` |

</details>

---

## FAQ

<details>
<summary><strong>Common questions</strong></summary>

**How often does GSC data update?**
Search Console data typically has a 2–3 day delay. For settled, final numbers pass `dataState: 'final'` in your search analytics queries. The most recent 2–3 days may still change as Google processes data.

**What are the rate limits?**
The server has built-in rate limiting at 20 requests/second with a burst allowance of 30. The Google Search Console API also has its own daily quota — check your [Google Cloud Console quotas page](https://console.cloud.google.com/apis/api/searchconsole.googleapis.com/quotas) if you hit limits.

**Can I work with multiple sites?**
Yes. Use `list_properties` to see all accessible sites, then specify the `siteUrl` parameter in any tool to target a specific property.

**How do domain properties work?**
Domain properties use the `sc-domain:example.com` format. This covers all subdomains and protocols. URL-prefix properties use the full URL like `https://www.example.com/`.

**What data is NOT available through the API?**
See the [API Limitations](#api-limitations) section. Core Web Vitals, crawl stats, links, manual actions, and removals are only available in the Search Console web interface.

</details>

---

## Development

<details>
<summary><strong>Build, test, and run locally</strong></summary>

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Development mode (watch + rebuild)
npm run dev

# Type check
npm run lint

# Start locally (stdio)
npm start

# Start locally (HTTP)
npm start -- --http
```

</details>

---

## License

[MIT](LICENSE)
