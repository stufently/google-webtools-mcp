/**
 * Auto-detecting authentication client factory for Google Search Console.
 *
 * Tries authentication methods in priority order and returns the first
 * one that succeeds, along with metadata about which method was used.
 */

import { google, webmasters_v3 } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import type { GoogleAuth } from 'googleapis-common';
import {
  loadServiceAccountCredentials,
  createServiceAccountAuth,
} from './service-account.js';
import { loadOAuthCredentials, createOAuthClient } from './oauth.js';
import { AuthenticationError, AuthorizationError } from '../errors/gsc-error.js';

export type AuthMethod = 'service-account' | 'oauth' | 'none';
export type AuthClient = GoogleAuth | OAuth2Client;

export interface AuthResult {
  auth: AuthClient;
  method: AuthMethod;
  identity: string;
}

const SETUP_GUIDE = `
===== Google Webtools MCP - Authentication Setup =====

No valid credentials found. Set up authentication using one of these methods:

This server requires scopes for Search Console, GA4, and Site Verification.

--- Option 1: Service Account (recommended for servers) ---
  1. Create a service account in Google Cloud Console
  2. Download the JSON key file
  3. Add the service account email as a user in Search Console
     (Search Console -> Settings -> Users and permissions)
  4. Grant the service account access to GA4 properties and Site Verification
  5. Set the environment variable:
     export GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account-key.json"

--- Option 2: OAuth 2.0 (recommended for local/personal use) ---
  1. Create OAuth 2.0 credentials in Google Cloud Console
     (APIs & Services -> Credentials -> Create -> OAuth client ID -> Desktop app)
  2. Enable Search Console API, Analytics Data API, Analytics Admin API,
     and Site Verification API in your project
  3. Download the client secrets JSON file
  4. Set the environment variable:
     export GSC_OAUTH_CLIENT_SECRETS_FILE="/path/to/client-secrets.json"
  5. On first run, follow the browser prompt to authorize

--- Option 3: Auto-detect credentials.json ---
  Place a credentials.json file (service account key or OAuth client secrets)
  in the current working directory. The type will be detected automatically.

================================================================
`.trim();

/**
 * Attempts to create an authenticated Search Console client by trying
 * all supported authentication methods in priority order.
 *
 * Priority:
 * 1. Service account (GOOGLE_APPLICATION_CREDENTIALS or GOOGLE_SERVICE_ACCOUNT_KEY)
 * 2. OAuth (GSC_OAUTH_CLIENT_SECRETS_FILE)
 * 3. Auto-detect ./credentials.json (inspects the "type" field)
 *
 * @throws {AuthenticationError} If no credentials are found or all methods fail.
 */
export async function createAuthenticatedClient(): Promise<AuthResult> {
  const errors: string[] = [];

  // 1. Service Account
  try {
    const credentials = loadServiceAccountCredentials();
    if (credentials) {
      const auth = createServiceAccountAuth(credentials);
      process.stderr.write(
        `[auth] Authenticated via service account: ${credentials.client_email}\n`,
      );
      return {
        auth,
        method: 'service-account',
        identity: credentials.client_email,
      };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push(`Service account: ${message}`);
  }

  // 2. OAuth (explicit env var)
  try {
    const oauthSecrets = loadOAuthCredentials();
    if (oauthSecrets) {
      const oauth2Client = await createOAuthClient(oauthSecrets);
      const creds = oauthSecrets.installed ?? oauthSecrets.web;
      const identity = creds?.client_id ?? 'unknown';
      process.stderr.write(`[auth] Authenticated via OAuth: ${identity}\n`);
      return {
        auth: oauth2Client,
        method: 'oauth',
        identity,
      };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push(`OAuth: ${message}`);
  }

  // 3. Auto-detect ./credentials.json as OAuth client secrets
  //    (Service account credentials.json is already handled in step 1 via
  //    loadServiceAccountCredentials, which checks ./credentials.json as a fallback.)
  try {
    const { existsSync, readFileSync } = await import('fs');
    const fallbackPath = 'credentials.json';

    if (existsSync(fallbackPath)) {
      const raw = readFileSync(fallbackPath, 'utf-8');
      const data = JSON.parse(raw) as Record<string, unknown>;

      // If it has "installed" or "web" keys, treat as OAuth client secrets.
      if ('installed' in data || 'web' in data) {
        const oauth2Client = await createOAuthClient(data as import('./oauth.js').OAuthClientSecrets);
        const creds = (data as import('./oauth.js').OAuthClientSecrets).installed ??
          (data as import('./oauth.js').OAuthClientSecrets).web;
        const identity = creds?.client_id ?? 'unknown';
        process.stderr.write(
          `[auth] Authenticated via OAuth (auto-detected credentials.json): ${identity}\n`,
        );
        return {
          auth: oauth2Client,
          method: 'oauth',
          identity,
        };
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push(`Auto-detect credentials.json: ${message}`);
  }

  // All methods exhausted.
  const detail =
    errors.length > 0
      ? `\n\nAttempted methods:\n${errors.map((e) => `  - ${e}`).join('\n')}`
      : '';

  throw new AuthenticationError(
    `No valid Google Search Console credentials found.${detail}`,
    { recoveryHint: SETUP_GUIDE },
  );
}

/**
 * Validates that the authenticated client can actually reach the Search Console API
 * by making a lightweight `sites.list` call.
 *
 * @throws {AuthenticationError} on 401 responses.
 * @throws {AuthorizationError} on 403 responses.
 * @throws {Error} on other unexpected failures.
 */
export async function validateConnection(
  client: webmasters_v3.Webmasters,
): Promise<void> {
  try {
    await client.sites.list();
  } catch (err: unknown) {
    const status = extractHttpStatus(err);

    if (status === 401) {
      throw new AuthenticationError(
        'Credentials were loaded but the API returned 401 Unauthorized.',
        {
          recoveryHint:
            'Your credentials may be revoked or expired.\n' +
            '  - Service account: re-download the JSON key from Google Cloud Console.\n' +
            '  - OAuth: delete ~/.google-webtools-mcp/token.json and re-authorize.',
          cause: err,
        },
      );
    }

    if (status === 403) {
      throw new AuthorizationError(
        'Credentials are valid but lack permission to access Search Console.',
        {
          recoveryHint:
            'Ensure the authenticated account has access:\n' +
            '  - Service account: add its email in Search Console -> Settings -> Users and permissions.\n' +
            '  - OAuth: make sure the Google account has at least one verified property.',
          cause: err,
        },
      );
    }

    throw new Error(
      `Failed to validate Search Console connection: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Extracts an HTTP status code from a Google API error, if present.
 */
function extractHttpStatus(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) {
    return undefined;
  }

  // googleapis wraps errors in GaxiosError with a `code` field (as a string or number).
  const maybeCode = (err as Record<string, unknown>)['code'];
  if (typeof maybeCode === 'number') {
    return maybeCode;
  }
  if (typeof maybeCode === 'string') {
    const parsed = parseInt(maybeCode, 10);
    return Number.isNaN(parsed) ? undefined : parsed;
  }

  // Fallback: check response.status
  const response = (err as Record<string, unknown>)['response'];
  if (typeof response === 'object' && response !== null) {
    const status = (response as Record<string, unknown>)['status'];
    if (typeof status === 'number') {
      return status;
    }
  }

  return undefined;
}
