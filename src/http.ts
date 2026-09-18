import { createServer as createNodeHttpServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

/** Largest JSON-RPC request body accepted on POST /mcp. */
export const MAX_BODY_BYTES = 4 * 1024 * 1024;

export interface McpHttpOptions {
  /**
   * Builds a fresh MCP server for one request. The HTTP mode is stateless: an
   * McpServer can be connected to only one transport, and a stateless
   * transport serves only one request, so both are created per POST and closed
   * when the response ends. Shared state (API clients, cache, rate limiter)
   * lives outside and is captured by the factory.
   */
  createMcpServer: () => McpServer;
  /** Extra fields for GET /health. */
  health?: () => Record<string, unknown>;
}

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

function rpcError(code: number, message: string): unknown {
  return { jsonrpc: '2.0', error: { code, message }, id: null };
}

class BodyTooLargeError extends Error {}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk: Buffer) => {
      if (tooLarge) return; // keep draining so the 413 reaches the client
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        chunks.length = 0;
        reject(new BodyTooLargeError());
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function handleMcpPost(req: IncomingMessage, res: ServerResponse, options: McpHttpOptions): Promise<void> {
  let body: unknown;
  try {
    body = JSON.parse(await readBody(req));
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      sendJson(res, 413, rpcError(-32600, `Request body exceeds ${MAX_BODY_BYTES} bytes`), { Connection: 'close' });
    } else {
      sendJson(res, 400, rpcError(-32700, 'Parse error: request body is not valid JSON'));
    }
    return;
  }

  const server = options.createMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  } catch (error) {
    console.error('[google-webtools-mcp] Error handling MCP request:', error instanceof Error ? error.message : error);
    sendJson(res, 500, rpcError(-32603, 'Internal server error'));
  }
}

/**
 * Stateless Streamable HTTP server:
 *   POST /mcp    — MCP JSON-RPC (a new McpServer + transport per request)
 *   GET  /health — liveness
 * GET/DELETE /mcp answer 405: there are no sessions to resume or terminate.
 */
export function createMcpHttpServer(options: McpHttpOptions): Server {
  return createNodeHttpServer((req, res) => {
    let path: string;
    try {
      path = new URL(req.url ?? '/', 'http://localhost').pathname;
    } catch {
      sendJson(res, 400, { error: 'Bad request URL' });
      return;
    }

    if (path === '/mcp') {
      if (req.method === 'POST') {
        handleMcpPost(req, res, options).catch((error: unknown) => {
          console.error('[google-webtools-mcp] Unhandled HTTP error:', error instanceof Error ? error.message : error);
          sendJson(res, 500, rpcError(-32603, 'Internal server error'));
        });
        return;
      }
      sendJson(res, 405, rpcError(-32000, 'Method not allowed: this server is stateless, use POST'), { Allow: 'POST' });
      return;
    }

    if (path === '/health' && req.method === 'GET') {
      sendJson(res, 200, { status: 'ok', ...(options.health?.() ?? {}) });
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  });
}
