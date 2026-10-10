import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { GscApiClient } from '../../src/api/client.js';
import type { Ga4ApiClient } from '../../src/api/ga4-client.js';
import type { VerificationApiClient } from '../../src/api/verification-client.js';
import { createServer } from '../../src/server.js';

// Listing tools never calls Google, so the API clients can be empty stubs.
async function listTools(): Promise<Tool[]> {
  const server = createServer(
    {} as GscApiClient,
    {} as Ga4ApiClient,
    {} as VerificationApiClient,
  );
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'annotations-test', version: '1' });
  await server.connect(serverSide);
  await client.connect(clientSide);
  try {
    const { tools } = await client.listTools();
    return tools;
  } finally {
    await client.close();
    await server.close();
  }
}

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

// Every tool that changes state on the Google side. Anything not listed here
// must be read-only.
const WRITE_TOOLS: Record<string, typeof READ_ONLY> = {
  add_property: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  submit_sitemap: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  gsc_verify_site: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  delete_property: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  delete_sitemap: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  ga4_create_property: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  ga4_create_data_stream: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
};

describe('tool annotations and descriptions', () => {
  let tools: Tool[];

  beforeAll(async () => {
    tools = await listTools();
  });

  it('registers all 39 tools', () => {
    expect(tools).toHaveLength(39);
  });

  it('marks write tools with their exact hints', () => {
    const byName = new Map(tools.map((t) => [t.name, t]));
    for (const [name, hints] of Object.entries(WRITE_TOOLS)) {
      expect(byName.has(name), name).toBe(true);
      expect(byName.get(name)?.annotations, name).toEqual(hints);
    }
  });

  it('marks every other tool read-only and non-destructive', () => {
    for (const tool of tools) {
      if (tool.name in WRITE_TOOLS) continue;
      expect(tool.annotations, tool.name).toEqual(READ_ONLY);
    }
  });

  it('describes each tool in at least 25 words with a "Use when" sentence', () => {
    for (const tool of tools) {
      const description = tool.description ?? '';
      expect(description.split(/\s+/).filter(Boolean).length, tool.name).toBeGreaterThanOrEqual(25);
      expect(description, tool.name).toMatch(/(^|\.\s+)Use when /);
    }
  });
});
