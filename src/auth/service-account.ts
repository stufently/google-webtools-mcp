/**
 * Service account credential loading for Google Search Console API.
 *
 * Supports three discovery methods (tried in priority order):
 * 1. GOOGLE_APPLICATION_CREDENTIALS env var (path to JSON key file)
 * 2. GOOGLE_SERVICE_ACCOUNT_KEY env var (inline JSON string)
 * 3. ./credentials.json in the current working directory
 */

import { google } from 'googleapis';
import { readFileSync, existsSync } from 'fs';
import type { GoogleAuth } from 'googleapis-common';

export interface ServiceAccountCredentials {
  type: 'service_account';
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
  auth_uri: string;
  token_uri: string;
}

const REQUIRED_FIELDS: ReadonlyArray<keyof ServiceAccountCredentials> = [
  'type',
  'project_id',
  'private_key_id',
  'private_key',
  'client_email',
  'client_id',
  'auth_uri',
  'token_uri',
];

const WEBMASTERS_SCOPE = 'https://www.googleapis.com/auth/webmasters';

/**
 * Validates that a parsed JSON object contains all required service account fields.
 * Throws a descriptive error if any field is missing or if "type" is not "service_account".
 */
function validateCredentials(data: unknown): ServiceAccountCredentials {
  if (typeof data !== 'object' || data === null) {
    throw new Error('Service account credentials must be a JSON object.');
  }

  const obj = data as Record<string, unknown>;

  const missingFields = REQUIRED_FIELDS.filter(
    (field) => !(field in obj) || typeof obj[field] !== 'string' || (obj[field] as string).length === 0,
  );

  if (missingFields.length > 0) {
    throw new Error(
      `Service account JSON is missing or has empty required fields: ${missingFields.join(', ')}`,
    );
  }

  if (obj['type'] !== 'service_account') {
    throw new Error(
      `Expected credentials type "service_account" but got "${String(obj['type'])}". ` +
        'This file may contain OAuth client credentials instead.',
    );
  }

  return data as ServiceAccountCredentials;
}

/**
 * Safely reads and parses a JSON file at the given path.
 * Returns the parsed object or throws with context about what went wrong.
 */
function readJsonFile(filePath: string, sourceLabel: string): unknown {
  if (!existsSync(filePath)) {
    throw new Error(`${sourceLabel} points to "${filePath}" which does not exist.`);
  }

  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf-8');
  } catch (err) {
    throw new Error(
      `Failed to read ${sourceLabel} file at "${filePath}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`${sourceLabel} file at "${filePath}" contains invalid JSON.`);
  }
}

/**
 * Attempts to load service account credentials from the environment or filesystem.
 *
 * Discovery order:
 * 1. `GOOGLE_APPLICATION_CREDENTIALS` env var -- path to a JSON key file
 * 2. `GOOGLE_SERVICE_ACCOUNT_KEY` env var -- raw JSON string
 * 3. `./credentials.json` in the current working directory (only if type is "service_account")
 *
 * @returns The validated credentials, or `null` if no source is available.
 */
export function loadServiceAccountCredentials(): ServiceAccountCredentials | null {
  // 1. GOOGLE_APPLICATION_CREDENTIALS (file path)
  const credentialsPath = process.env['GOOGLE_APPLICATION_CREDENTIALS'];
  if (credentialsPath) {
    const data = readJsonFile(credentialsPath, 'GOOGLE_APPLICATION_CREDENTIALS');
    return validateCredentials(data);
  }

  // 2. GOOGLE_SERVICE_ACCOUNT_KEY (inline JSON)
  const inlineKey = process.env['GOOGLE_SERVICE_ACCOUNT_KEY'];
  if (inlineKey) {
    let data: unknown;
    try {
      data = JSON.parse(inlineKey) as unknown;
    } catch {
      throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY contains invalid JSON.');
    }
    return validateCredentials(data);
  }

  // 3. ./credentials.json fallback (only if it's a service account file)
  const fallbackPath = 'credentials.json';
  if (existsSync(fallbackPath)) {
    let data: unknown;
    try {
      const raw = readFileSync(fallbackPath, 'utf-8');
      data = JSON.parse(raw) as unknown;
    } catch {
      // If the file can't be parsed, silently skip -- it may be an OAuth file
      // handled by the OAuth loader.
      return null;
    }

    if (typeof data === 'object' && data !== null && (data as Record<string, unknown>)['type'] === 'service_account') {
      return validateCredentials(data);
    }

    // Not a service account file; return null so other auth methods can try.
    return null;
  }

  return null;
}

/**
 * Creates a `GoogleAuth` instance configured for the Google Search Console
 * (webmasters) API using the provided service account credentials.
 */
export function createServiceAccountAuth(
  credentials: ServiceAccountCredentials,
): GoogleAuth {
  return new google.auth.GoogleAuth({
    credentials: {
      client_email: credentials.client_email,
      private_key: credentials.private_key,
    },
    projectId: credentials.project_id,
    scopes: [WEBMASTERS_SCOPE],
  });
}
