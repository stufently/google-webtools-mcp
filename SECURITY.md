# Security

## Reporting a vulnerability

Please report it privately, not in a public issue. Open the
[Security tab](https://github.com/stufently/google-webtools-mcp/security) of this repository
and use **Report a vulnerability**
([direct link](https://github.com/stufently/google-webtools-mcp/security/advisories/new)). If
that button is not available, open an issue asking for a private channel — without any details
of the problem.

## What the server touches

The server acts on Google with whatever identity it authenticates as, and sends requests only
to Google APIs through the official `googleapis` client: Search Console (`webmasters` v3,
`searchconsole` v1), Google Analytics Admin and Data, and Site Verification. Responses are
cached in memory only and are gone when the process exits.

Credentials, in the order the server tries them (see the README's
[Environment variables](README.md#2-environment-variables)):

- **Service account key** — the file named by `GOOGLE_APPLICATION_CREDENTIALS`, the JSON in
  `GOOGLE_SERVICE_ACCOUNT_KEY`, or `./credentials.json`. The server only reads it.
- **Application Default Credentials** from `gcloud auth application-default login`.
- **OAuth (Desktop app client)** — `GSC_OAUTH_CLIENT_SECRETS_FILE` or `./credentials.json`. The
  first run opens a callback listener on `127.0.0.1` on a random port, and the resulting
  token, including the refresh token, is saved to `~/.google-webtools-mcp/token.json`. The
  file is written with your default umask; restrict it yourself:
  `chmod 600 ~/.google-webtools-mcp/token.json`. Deleting it makes the next start authorize
  again, but a running server keeps its tokens in memory until it exits; to revoke the grant
  itself, remove the app's access in your Google account.

The first method whose credentials load wins, and one that fails to load falls through to the
next. The `[auth] Authenticated via …` line on stderr tells you which method was picked.

**HTTP transport (`--http`)** has no authentication and listens on all interfaces, while the
tools act with your Google credentials, including the write tools. Keep it on localhost or
behind an authenticating proxy.

## Least privilege

The OAuth scopes are fixed in code and include write access:

```
https://www.googleapis.com/auth/webmasters
https://www.googleapis.com/auth/analytics.readonly
https://www.googleapis.com/auth/analytics.edit
https://www.googleapis.com/auth/siteverification.verify_only
```

So what the server can actually do is limited by what the identity is granted, not by the
scopes. Prefer a dedicated **service account** over your personal Google account, and add it in
Search Console and GA4 only to the properties you want the agent to see, at the lowest
permission level that covers the tools you use.

The write tools — `add_property`, `delete_property`, `submit_sitemap`, `delete_sitemap`,
`ga4_create_property`, `ga4_create_data_stream`, `gsc_verify_site` — change live configuration
with no dry-run. A created GA4 property or data stream cannot be removed through this server.

Keep keys and `token.json` out of git. A project-level `.mcp.json` or `.cursor/mcp.json` is
often committed; reference the key by path instead of pasting it there.
