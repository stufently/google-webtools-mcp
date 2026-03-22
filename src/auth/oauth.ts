/**
 * OAuth 2.0 authentication flow for Google Search Console API.
 *
 * When no stored token exists, spins up a temporary local HTTP server to
 * handle the OAuth callback, prints the authorization URL to stderr, and
 * waits for the user to complete the consent flow in their browser.
 *
 * Tokens are persisted to ~/.google-webtools-mcp/token.json so the user only
 * needs to authorize once.
 */

import { google } from 'googleapis';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { createServer } from 'http';
import type { OAuth2Client, Credentials } from 'google-auth-library';

const TOKEN_DIR = join(homedir(), '.google-webtools-mcp');
const TOKEN_PATH = join(TOKEN_DIR, 'token.json');
const SCOPES: readonly string[] = [
  'https://www.googleapis.com/auth/webmasters',
  'https://www.googleapis.com/auth/analytics.readonly',
  'https://www.googleapis.com/auth/analytics.edit',
  'https://www.googleapis.com/auth/siteverification.verify_only',
];

export interface OAuthClientSecrets {
  installed?: OAuthInstalledCredentials;
  web?: OAuthInstalledCredentials;
}

interface OAuthInstalledCredentials {
  client_id: string;
  client_secret: string;
  redirect_uris?: string[];
}

/**
 * Reads the OAuth client secrets file referenced by the
 * `GSC_OAUTH_CLIENT_SECRETS_FILE` env var.
 *
 * @returns The parsed client secrets object, or `null` if the env var is unset.
 * @throws If the file doesn't exist or contains invalid JSON.
 */
export function loadOAuthCredentials(): OAuthClientSecrets | null {
  const secretsPath = process.env['GSC_OAUTH_CLIENT_SECRETS_FILE'];
  if (!secretsPath) {
    return null;
  }

  if (!existsSync(secretsPath)) {
    throw new Error(
      `GSC_OAUTH_CLIENT_SECRETS_FILE points to "${secretsPath}" which does not exist.`,
    );
  }

  let raw: string;
  try {
    raw = readFileSync(secretsPath, 'utf-8');
  } catch (err) {
    throw new Error(
      `Failed to read OAuth client secrets at "${secretsPath}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let data: unknown;
  try {
    data = JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`OAuth client secrets file at "${secretsPath}" contains invalid JSON.`);
  }

  const secrets = data as OAuthClientSecrets;
  const creds = secrets.installed ?? secrets.web;
  if (!creds?.client_id || !creds?.client_secret) {
    throw new Error(
      'OAuth client secrets file is missing "client_id" or "client_secret". ' +
        'Download fresh credentials from the Google Cloud Console.',
    );
  }

  return secrets;
}

/**
 * Saves an OAuth token to the persistent token store.
 */
export function saveToken(token: Credentials): void {
  if (!existsSync(TOKEN_DIR)) {
    mkdirSync(TOKEN_DIR, { recursive: true });
  }
  writeFileSync(TOKEN_PATH, JSON.stringify(token, null, 2), 'utf-8');
}

/**
 * Loads a previously saved OAuth token from disk.
 *
 * @returns The stored credentials, or `null` if no token file exists.
 */
export function loadToken(): Credentials | null {
  if (!existsSync(TOKEN_PATH)) {
    return null;
  }

  try {
    const raw = readFileSync(TOKEN_PATH, 'utf-8');
    return JSON.parse(raw) as Credentials;
  } catch {
    // Corrupted token file -- treat as missing so we re-auth.
    return null;
  }
}

/**
 * Checks whether a token is expired or about to expire (within 60 s).
 */
function isTokenExpired(token: Credentials): boolean {
  if (!token.expiry_date) {
    // No expiry info -- assume it's still valid.
    return false;
  }
  const bufferMs = 60_000;
  return Date.now() >= token.expiry_date - bufferMs;
}

/**
 * Starts a temporary local HTTP server, prints the authorization URL to
 * stderr, and resolves with the authorization code once the user completes
 * the consent flow.
 */
function waitForAuthorizationCode(authUrl: string, oauth2Client: OAuth2Client): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      try {
        const url = new URL(req.url ?? '/', `http://localhost`);
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');

        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`<h1>Authorization denied</h1><p>${error}</p><p>You can close this tab.</p>`);
          server.close();
          reject(new Error(`OAuth authorization denied: ${error}`));
          return;
        }

        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<h1>Missing authorization code</h1><p>Please try again.</p>');
          return;
        }

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(
          '<h1>Authorization successful!</h1>' +
            '<p>You can close this tab and return to the terminal.</p>',
        );
        server.close();
        resolve(code);
      } catch (err) {
        server.close();
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });

    server.on('error', (err) => {
      reject(new Error(`Failed to start local OAuth callback server: ${err.message}`));
    });

    // Listen on port 0 to let the OS assign a random available port.
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Failed to determine callback server address.'));
        return;
      }

      const redirectUri = `http://127.0.0.1:${address.port}`;

      // Update the OAuth client's redirect URI to match the actual port.
      (oauth2Client as unknown as { redirectUri: string }).redirectUri = redirectUri;

      const url = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: [...SCOPES],
        prompt: 'consent',
        redirect_uri: redirectUri,
      });

      process.stderr.write('\n');
      process.stderr.write('='.repeat(60) + '\n');
      process.stderr.write('  Google Search Console - OAuth Authorization\n');
      process.stderr.write('='.repeat(60) + '\n');
      process.stderr.write('\n');
      process.stderr.write('  Open this URL in your browser to authorize:\n\n');
      process.stderr.write(`  ${url}\n\n`);
      process.stderr.write('  Waiting for authorization...\n');
      process.stderr.write('='.repeat(60) + '\n\n');
    });

    // Safety timeout: close the server after 5 minutes.
    const timeout = setTimeout(() => {
      server.close();
      reject(new Error('OAuth authorization timed out after 5 minutes.'));
    }, 5 * 60 * 1000);

    server.on('close', () => clearTimeout(timeout));
  });
}

/**
 * Creates a fully authenticated `OAuth2Client` for the Google Search Console API.
 *
 * If a stored token exists and is still valid, it is reused. If the token is
 * expired but has a refresh token, it is refreshed automatically. Otherwise,
 * an interactive browser-based OAuth flow is initiated.
 *
 * @param secrets - The OAuth client secrets (from `loadOAuthCredentials`).
 * @returns An authenticated `OAuth2Client`.
 */
export async function createOAuthClient(secrets: OAuthClientSecrets): Promise<OAuth2Client> {
  const creds = secrets.installed ?? secrets.web;
  if (!creds) {
    throw new Error('OAuth client secrets must contain an "installed" or "web" key.');
  }

  const oauth2Client = new google.auth.OAuth2(
    creds.client_id,
    creds.client_secret,
    // Redirect URI will be set dynamically when starting the callback server.
    'http://127.0.0.1',
  );

  // Try to load an existing token.
  const storedToken = loadToken();

  if (storedToken) {
    oauth2Client.setCredentials(storedToken);

    // If the token isn't expired, we're done.
    if (!isTokenExpired(storedToken)) {
      return oauth2Client;
    }

    // If we have a refresh token, try to refresh.
    if (storedToken.refresh_token) {
      try {
        const { credentials } = await oauth2Client.refreshAccessToken();
        // Preserve the refresh token if Google didn't return a new one.
        if (!credentials.refresh_token && storedToken.refresh_token) {
          credentials.refresh_token = storedToken.refresh_token;
        }
        oauth2Client.setCredentials(credentials);
        saveToken(credentials);
        process.stderr.write('[auth] OAuth token refreshed successfully.\n');
        return oauth2Client;
      } catch (err) {
        process.stderr.write(
          `[auth] Token refresh failed, starting new authorization flow: ${err instanceof Error ? err.message : String(err)}\n`,
        );
      }
    }
  }

  // No valid token -- run the interactive authorization flow.
  const code = await waitForAuthorizationCode('', oauth2Client);
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);
  saveToken(tokens);

  process.stderr.write('[auth] OAuth authorization completed. Token saved.\n');
  return oauth2Client;
}
