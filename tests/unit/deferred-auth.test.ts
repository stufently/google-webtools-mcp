import { describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { DeferredAuth } from '../../src/auth/deferred-auth.js';
import type { AuthResult } from '../../src/auth/client-factory.js';
import { AuthenticationError } from '../../src/errors/gsc-error.js';
import { GscApiClient } from '../../src/api/client.js';
import { Ga4ApiClient } from '../../src/api/ga4-client.js';
import { VerificationApiClient } from '../../src/api/verification-client.js';
import { createServer } from '../../src/server.js';

function fakeResult(request = vi.fn(async () => ({ data: 'ok' }))): AuthResult {
  const auth = {
    request,
    getRequestHeaders: vi.fn(async () => ({ Authorization: 'Bearer t' })),
    getUniverseDomain: vi.fn(async () => 'googleapis.com'),
  };
  return { auth: auth as unknown as AuthResult['auth'], method: 'service-account', identity: 'sa@p' };
}

describe('DeferredAuth', () => {
  it('does not look for credentials until a request needs them', () => {
    const loader = vi.fn(async () => fakeResult());
    const auth = new DeferredAuth(loader);
    expect(loader).not.toHaveBeenCalled();
    expect(auth.method).toBe('none');
  });

  it('delegates request, headers and universe domain to the loaded client', async () => {
    const result = fakeResult();
    const auth = new DeferredAuth(async () => result);
    await expect(auth.request({ url: 'u' })).resolves.toEqual({ data: 'ok' });
    await expect(auth.getRequestHeaders('u')).resolves.toEqual({ Authorization: 'Bearer t' });
    await expect(auth.getUniverseDomain()).resolves.toBe('googleapis.com');
    expect(result.auth).toHaveProperty('request');
    expect((result.auth as unknown as { request: ReturnType<typeof vi.fn> }).request).toHaveBeenCalledWith({ url: 'u' });
    expect(auth.method).toBe('service-account');
  });

  it('shares one load between concurrent calls and keeps a success', async () => {
    const loader = vi.fn(async () => fakeResult());
    const auth = new DeferredAuth(loader);
    await Promise.all([auth.request({}), auth.request({}), auth.getUniverseDomain()]);
    await auth.request({});
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('rejects with the loader error and retries on the next call', async () => {
    const loader = vi
      .fn<() => Promise<AuthResult>>()
      .mockRejectedValueOnce(new AuthenticationError('No valid Google Search Console credentials found.'))
      .mockResolvedValueOnce(fakeResult());
    const auth = new DeferredAuth(loader);
    await expect(auth.request({})).rejects.toBeInstanceOf(AuthenticationError);
    expect(auth.method).toBe('none');
    await expect(auth.request({})).resolves.toEqual({ data: 'ok' });
    expect(loader).toHaveBeenCalledTimes(2);
  });
});

describe('server without credentials', () => {
  it('lists tools, and a tool call reports the credentials error', async () => {
    const loader = vi.fn(async (): Promise<AuthResult> => {
      throw new AuthenticationError('No valid Google Search Console credentials found.', {
        recoveryHint: 'Set GOOGLE_APPLICATION_CREDENTIALS.',
      });
    });
    const auth = new DeferredAuth(loader);
    const server = createServer(
      new GscApiClient(auth),
      new Ga4ApiClient(auth),
      new VerificationApiClient(auth),
    );
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(clientSide);

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain('list_properties');
    expect(loader).not.toHaveBeenCalled();

    const res = await client.callTool({ name: 'list_properties', arguments: {} });
    expect(res.isError).toBe(true);
    const text = (res.content as Array<{ text: string }>)[0]?.text ?? '';
    expect(text).toContain('No valid Google Search Console credentials found.');
    expect(text).toContain('Set GOOGLE_APPLICATION_CREDENTIALS.');
    expect(loader).toHaveBeenCalled();

    await client.close();
    await server.close();
  });
});
