import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { connect } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createMcpHttpServer, MAX_BODY_BYTES } from '../../src/http.js';
import { createServer } from '../../src/server.js';
import type { GscApiClient } from '../../src/api/client.js';
import type { Ga4ApiClient } from '../../src/api/ga4-client.js';
import type { VerificationApiClient } from '../../src/api/verification-client.js';

// Stub API clients stand in for Google credentials: the tools are real, only
// the network layer underneath them is replaced.
const api = {
  listSites: async () => {
    // Keep each call in flight for a moment so parallel requests overlap.
    await new Promise((resolve) => setTimeout(resolve, 30));
    return [{ siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner' }];
  },
} as unknown as GscApiClient;
const ga4 = {} as unknown as Ga4ApiClient;
const verification = {} as unknown as VerificationApiClient;

let httpServer: Server;
let baseUrl: string;
let serversCreated: number;

beforeEach(async () => {
  serversCreated = 0;
  httpServer = createMcpHttpServer({
    createMcpServer: () => {
      serversCreated += 1;
      return createServer(api, ga4, verification);
    },
    health: () => ({ auth: 'test' }),
  });
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const { port } = httpServer.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterEach(async () => {
  httpServer.closeAllConnections();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

async function rpc(body: unknown): Promise<{ status: number; text: string }> {
  const res = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify(body),
  });
  return { status: res.status, text: await res.text() };
}

describe('HTTP transport', () => {
  it('serves initialize, tools/list and tools/call in a row in one process', async () => {
    const init = await rpc({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } },
    });
    expect(init.status).toBe(200);
    expect(init.text).toContain('"serverInfo"');

    const list = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    expect(list.status).toBe(200);
    expect(list.text).toContain('"list_properties"');

    const call = await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_properties', arguments: {} } });
    expect(call.status).toBe(200);
    expect(call.text).toContain('sc-domain:example.com');

    // A fourth request proves the server is still alive after the sequence.
    const again = await rpc({ jsonrpc: '2.0', id: 4, method: 'tools/list' });
    expect(again.status).toBe(200);
    expect(serversCreated).toBe(4);
  });

  it('serves overlapping requests in parallel', async () => {
    const calls = Array.from({ length: 5 }, (_, i) =>
      rpc({ jsonrpc: '2.0', id: i + 1, method: 'tools/call', params: { name: 'list_properties', arguments: {} } }),
    );
    const results = await Promise.all(calls);
    for (const r of results) {
      expect(r.status).toBe(200);
      expect(r.text).toContain('sc-domain:example.com');
    }
  });

  it('works with the SDK client across several calls', async () => {
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`)));

    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toContain('list_properties');
    expect(tools.tools).toHaveLength(39);

    for (let i = 0; i < 2; i++) {
      const result = await client.callTool({ name: 'list_properties', arguments: {} });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain('sc-domain:example.com');
    }
    await client.close();
  });

  it('rejects invalid JSON with a parse error and keeps serving', async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: '{not json',
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('-32700');
    expect(serversCreated).toBe(0);

    const list = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(list.status).toBe(200);
  });

  it('answers 413 with a JSON-RPC error to an oversized body', async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: 'x'.repeat(MAX_BODY_BYTES + 1024),
    });
    expect(res.status).toBe(413);
    expect(await res.text()).toContain('-32600');
    expect(serversCreated).toBe(0);
  });

  it('survives a request line with an unparsable URL', async () => {
    const { port } = httpServer.address() as AddressInfo;
    const reply = await new Promise<string>((resolve, reject) => {
      const socket = connect(port, '127.0.0.1', () => {
        socket.write('GET //[ HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n');
      });
      let data = '';
      socket.on('data', (d) => (data += d.toString()));
      socket.on('end', () => resolve(data));
      socket.on('error', reject);
    });
    expect(reply).toMatch(/^HTTP\/1\.1 400/);

    const health = await fetch(`${baseUrl}/health`);
    expect(health.status).toBe(200);
  });

  it('answers 405 on GET/DELETE /mcp, 200 on /health, 404 elsewhere', async () => {
    const get = await fetch(`${baseUrl}/mcp`);
    expect(get.status).toBe(405);
    expect(get.headers.get('allow')).toBe('POST');
    const del = await fetch(`${baseUrl}/mcp`, { method: 'DELETE' });
    expect(del.status).toBe(405);

    const health = await fetch(`${baseUrl}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: 'ok', auth: 'test' });

    const other = await fetch(`${baseUrl}/nope`);
    expect(other.status).toBe(404);
  });
});
