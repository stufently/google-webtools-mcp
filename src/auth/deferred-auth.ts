/**
 * Auth client used when no credentials could be loaded at startup.
 *
 * The server still starts, so an MCP host (or a directory such as Glama that
 * introspects the image with no keys and no network) gets `initialize` and
 * `tools/list`. Credentials are looked up again on the first Google API call;
 * until that succeeds every call fails with the loader's error, setup guide
 * included. Nothing is faked: no key is invented, and a call never reaches
 * Google without real credentials.
 *
 * googleapis-common only touches an object auth through `getUniverseDomain`,
 * `request` and (for HTTP/2) `getRequestHeaders`, so those three delegate.
 */

import type { AuthClient, AuthMethod, AuthResult } from './client-factory.js';

type Loader = () => Promise<AuthResult>;

export class DeferredAuth {
  private loaded: AuthResult | undefined;
  private pending: Promise<AuthResult> | undefined;

  constructor(private readonly loader: Loader) {}

  /** `none` until credentials load, then the method that loaded them. */
  get method(): AuthMethod {
    return this.loaded?.method ?? 'none';
  }

  /**
   * Loads credentials once. Concurrent callers share one attempt; a failed
   * attempt is not cached, so fixing the key file needs no restart.
   */
  resolve(): Promise<AuthResult> {
    if (this.loaded) return Promise.resolve(this.loaded);
    if (!this.pending) {
      this.pending = this.loader().then(
        (result) => {
          this.loaded = result;
          this.pending = undefined;
          process.stderr.write(
            `[google-webtools-mcp] Authenticated via ${result.method} (${result.identity})\n`,
          );
          return result;
        },
        (err: unknown) => {
          this.pending = undefined;
          throw err;
        },
      );
    }
    return this.pending;
  }

  private async client(): Promise<AuthClient> {
    return (await this.resolve()).auth;
  }

  async getUniverseDomain(): Promise<string | undefined> {
    const auth = (await this.client()) as { getUniverseDomain?: () => Promise<string> };
    return typeof auth.getUniverseDomain === 'function' ? auth.getUniverseDomain() : undefined;
  }

  async request(options: unknown): Promise<unknown> {
    const auth = (await this.client()) as { request: (o: unknown) => Promise<unknown> };
    return auth.request(options);
  }

  async getRequestHeaders(url?: string): Promise<unknown> {
    const auth = (await this.client()) as { getRequestHeaders: (u?: string) => Promise<unknown> };
    return auth.getRequestHeaders(url);
  }
}
