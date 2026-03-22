import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from '../src/server.js';
import { createAuthenticatedClient } from '../src/auth/client-factory.js';
import { GscApiClient } from '../src/api/client.js';
import { Ga4ApiClient } from '../src/api/ga4-client.js';
import { VerificationApiClient } from '../src/api/verification-client.js';
import { CacheManager } from '../src/cache/cache-manager.js';
import { RateLimiter } from '../src/utils/rate-limiter.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const isHttpMode = args.includes('--http');

  try {
    // Create shared infrastructure
    const cache = new CacheManager();
    const rateLimiter = new RateLimiter(20, 30); // 20 req/s, burst of 30

    // Authenticate with Google
    const authResult = await createAuthenticatedClient();
    console.error(`[google-webtools-mcp] Authenticated via ${authResult.method} (${authResult.identity})`);

    // Create API clients
    const api = new GscApiClient(authResult.auth, cache, rateLimiter);
    const ga4 = new Ga4ApiClient(authResult.auth, rateLimiter);
    const verification = new VerificationApiClient(authResult.auth, rateLimiter);

    // Create MCP server
    const server = createServer(api, ga4, verification);

    if (isHttpMode) {
      // Streamable HTTP transport
      const { StreamableHTTPServerTransport } = await import(
        '@modelcontextprotocol/sdk/server/streamableHttp.js'
      );
      const { createServer: createHttpServer } = await import('http');

      const port = parseInt(process.env['PORT'] ?? '3000', 10);

      const httpServer = createHttpServer(async (req, res) => {
        if (req.url === '/mcp' && req.method === 'POST') {
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
          });
          await server.connect(transport);

          // Collect request body
          const chunks: Buffer[] = [];
          req.on('data', (chunk: Buffer) => chunks.push(chunk));
          req.on('end', async () => {
            const body = Buffer.concat(chunks).toString();
            try {
              await transport.handleRequest(req, res, JSON.parse(body));
            } catch {
              res.writeHead(400);
              res.end('Invalid request');
            }
          });
        } else if (req.url === '/health') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', auth: authResult.method }));
        } else {
          res.writeHead(404);
          res.end('Not found');
        }
      });

      httpServer.listen(port, () => {
        console.error(`[google-webtools-mcp] HTTP server listening on port ${port}`);
        console.error(`[google-webtools-mcp] MCP endpoint: POST http://localhost:${port}/mcp`);
      });
    } else {
      // Stdio transport (default)
      const transport = new StdioServerTransport();
      await server.connect(transport);
      console.error('[google-webtools-mcp] Server running on stdio');
    }
  } catch (error) {
    console.error('[google-webtools-mcp] Failed to start:', error instanceof Error ? error.message : error);

    if (error instanceof Error && error.message.includes('credentials')) {
      console.error(`
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
`);
    }

    process.exit(1);
  }
}

main();
