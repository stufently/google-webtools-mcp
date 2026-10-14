import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from '../src/server.js';
import { createMcpHttpServer } from '../src/http.js';
import { createAuthenticatedClient, type AuthResult } from '../src/auth/client-factory.js';
import { DeferredAuth } from '../src/auth/deferred-auth.js';
import { GscApiClient } from '../src/api/client.js';
import { Ga4ApiClient } from '../src/api/ga4-client.js';
import { VerificationApiClient } from '../src/api/verification-client.js';
import { CacheManager } from '../src/cache/cache-manager.js';
import { RateLimiter } from '../src/utils/rate-limiter.js';

const SETUP_GUIDE_BOX = `
╔══════════════════════════════════════════════════════════════╗
║                    SETUP GUIDE                               ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  Option 1: Service Account (recommended for automation)      ║
║  ─────────────────────────────────────────────────────────   ║
║  1. Go to Google Cloud Console → IAM & Admin → Service       ║
║     Accounts                                                 ║
║  2. Create a service account and download JSON key            ║
║  3. In Search Console / GA4 → add service account email      ║
║  4. Enable Search Console, Analytics, Site Verification APIs ║
║  5. Set: export GOOGLE_APPLICATION_CREDENTIALS=/path/to/key  ║
║                                                              ║
║  Option 2: OAuth (for individual use)                        ║
║  ─────────────────────────────────────────────────────────   ║
║  1. Go to Google Cloud Console → APIs & Services →           ║
║     Credentials                                              ║
║  2. Create OAuth 2.0 Client ID (Desktop app)                ║
║  3. Download the client secrets JSON                         ║
║  4. Set: export GSC_OAUTH_CLIENT_SECRETS_FILE=/path/to/json  ║
║  5. Run the server — it will open a browser for consent      ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const isHttpMode = args.includes('--http');

  try {
    // Create shared infrastructure
    const cache = new CacheManager();
    const rateLimiter = new RateLimiter(20, 30); // 20 req/s, burst of 30

    // Authenticate with Google. Without usable credentials the server still
    // starts: initialize and tools/list need no Google call, and every tool
    // call retries the lookup and reports its error until credentials work.
    let authResult: AuthResult | undefined;
    let deferred: DeferredAuth | undefined;
    try {
      authResult = await createAuthenticatedClient();
      console.error(`[google-webtools-mcp] Authenticated via ${authResult.method} (${authResult.identity})`);
    } catch (error) {
      console.error('[google-webtools-mcp] No usable credentials:', error instanceof Error ? error.message : error);
      console.error(SETUP_GUIDE_BOX);
      console.error('[google-webtools-mcp] Starting anyway: tools will fail with this error until credentials are configured.');
      deferred = new DeferredAuth(createAuthenticatedClient);
    }
    const auth = authResult?.auth ?? deferred!;

    // Create API clients
    const api = new GscApiClient(auth, cache, rateLimiter);
    const ga4 = new Ga4ApiClient(auth, rateLimiter);
    const verification = new VerificationApiClient(auth, rateLimiter);

    // A factory, not a single instance: HTTP mode needs a fresh McpServer per request.
    const makeServer = () => createServer(api, ga4, verification);

    if (isHttpMode) {
      // Stateless Streamable HTTP transport
      const port = parseInt(process.env['PORT'] ?? '3000', 10);
      const httpServer = createMcpHttpServer({
        createMcpServer: makeServer,
        health: () => ({ auth: authResult?.method ?? deferred?.method ?? 'none' }),
      });

      httpServer.listen(port, () => {
        console.error(`[google-webtools-mcp] HTTP server listening on port ${port}`);
        console.error(`[google-webtools-mcp] MCP endpoint: POST http://localhost:${port}/mcp`);
      });
    } else {
      // Stdio transport (default)
      const server = makeServer();
      const transport = new StdioServerTransport();
      await server.connect(transport);
      console.error('[google-webtools-mcp] Server running on stdio');
    }
  } catch (error) {
    console.error('[google-webtools-mcp] Failed to start:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
