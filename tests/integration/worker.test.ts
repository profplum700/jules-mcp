/** These tests MUST run in the Cloudflare runtime. Node core tests are not a substitute. */
import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthorizationError } from '@cloudflare/workers-oauth-provider';
import { GatewayError } from '../../src/shared/errors.ts';
import worker from '../../src/index.ts';
import diagnostic from '../../src/feasibility.ts';
import { pkceChallenge, randomSecret, sha256 } from '../../src/shared/crypto.ts';
import type { Env } from '../../src/platform/cloudflare.ts';
import { TOOLS, toolSchema } from '../../src/mcp/catalog.ts';
const origin = 'https://gateway.example.test';
const testEnv = env as unknown as Env;
let testIp = '';
const outbound: Array<{ url: string; method: string; body: unknown }> = [];
const replyOnce = (url: string, method: string, body: unknown) => outbound.push({ url, method, body });
let bindings: Env;
let tokenA: string;
let tokenB: string;
let admin: string;
const requests: Array<{ method: string; params?: unknown }> = [];
async function dispatch(path: string, init: RequestInit = {}, target = worker) {
  const ctx = createExecutionContext();
  const response = await target.fetch(
    new Request(`${origin}${path}`, {
      ...init,
      headers: {
        Host: new URL(origin).host,
        'cf-connecting-ip': testIp,
        ...Object.fromEntries(new Headers(init.headers)),
      },
    }),
    bindings,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
}
async function rpc(token: string | undefined, method: string, params: unknown = {}, target = worker) {
  requests.push({ method, params });
  const requestId = requests.length;
  const response = await dispatch(
    '/mcp',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2025-11-25',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }),
    },
    target,
  );
  const text = await response.text();
  let data;
  if (response.headers.get('content-type')?.includes('text/event-stream')) {
    const messages = text
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => JSON.parse(line.slice(5)));
    data = messages.find((message) => message.id === requestId) ?? messages.at(-1);
  } else data = text ? JSON.parse(text) : undefined;
  return { response, data };
}
async function adminCall(data: unknown) {
  return dispatch('/admin', {
    method: 'POST',
    headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}
beforeEach(async () => {
  testIp = crypto.randomUUID();
  outbound.length = 0;
  vi.stubGlobal('fetch', async (input: Request | string, init?: RequestInit) => {
    const request = new Request(input, init);
    const expected = outbound.shift();
    if (!expected) throw new Error('Unexpected outbound request blocked by test harness');
    expect(request.url).toBe(expected.url);
    expect(request.method).toBe(expected.method);
    return Response.json(expected.body);
  });
  requests.length = 0;
  tokenA = `jmg_alpha.${randomSecret()}`;
  tokenB = `jmg_beta.${randomSecret()}`;
  admin = `jma_${randomSecret()}`;
  const entries = await testEnv.OAUTH_KV.list();
  for (const entry of entries.keys) await testEnv.OAUTH_KV.delete(entry.name);
  bindings = {
    ...(env as unknown as Env),
    PUBLIC_ORIGIN: origin,
    OWNER_GITHUB_ID: '12345',
    GITHUB_CLIENT_ID: 'synthetic-client-id',
    GITHUB_CLIENT_SECRET: 'synthetic-github-secret',
    ADMIN_TOKEN_SHA256: await sha256(admin),
    GATEWAY_DISABLED: 'false',
    ALLOWED_ORIGINS_JSON: '[]',
    JULES_API_KEY: 'synthetic-jules-key',
    SERVICE_TOKENS_JSON: JSON.stringify(
      await Promise.all(
        [
          [tokenA, 'alpha'],
          [tokenB, 'beta'],
        ].map(async ([token, id]) => ({
          id,
          clientId: id,
          sha256: await sha256(token),
          scopes: ['jules:read', 'jules:control'],
        })),
      ),
    ),
  };
});
afterEach(() => {
  expect(outbound).toHaveLength(0);
  vi.unstubAllGlobals();
});
describe('stateless Worker / SDK protocol integration', () => {
  it('unauthenticated MCP gets discovery challenge before Jules', async () => {
    const { response } = await rpc(undefined, 'tools/list');
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain('resource_metadata');
  });
  it('publishes canonical protected-resource and AS metadata without DCR/CIMD', async () => {
    const prm = await dispatch('/.well-known/oauth-protected-resource');
    const data = (await prm.json()) as Record<string, unknown>;
    expect(data.resource).toBe(`${origin}/mcp`);
    const as = (await (await dispatch('/.well-known/oauth-authorization-server')).json()) as Record<
      string,
      unknown
    >;
    expect(as.registration_endpoint).toBeUndefined();
    expect(as.token_endpoint).toBe(`${origin}/oauth/token`);
    expect(as.code_challenge_methods_supported as string[]).toContain('S256');
  });
  it('initializes and discovers exactly 13 truthful tools', async () => {
    const init = await rpc(tokenA, 'initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'worker-test', version: '1' },
    });
    expect(init.response.status).toBe(200);
    expect(init.data.result.serverInfo.name).toBe('jules-mcp');
    const result = await rpc(tokenA, 'tools/list');
    const tools = result.data.result.tools;
    expect(tools).toHaveLength(13);
    for (const definition of TOOLS) {
      const actual = tools.find((tool: { name: string }) => tool.name === definition.name);
      const expected = toolSchema(definition);
      expect(actual.inputSchema).toMatchObject({
        type: 'object',
        additionalProperties: false,
        properties: expected.properties,
      });
      expect([...(actual.inputSchema.required ?? [])].sort()).toEqual([...expected.required].sort());
    }
    expect(
      tools.find((t: { name: string }) => t.name === 'jules_create_session').annotations.readOnlyHint,
    ).toBe(false);
    expect(
      tools.find((t: { name: string }) => t.name === 'jules_delete_session').annotations.destructiveHint,
    ).toBe(true);
    expect(tools.some((t: { name: string }) => t.name.includes('feasibility'))).toBe(false);
  });
  it('isolates concurrent client identity; revoking A leaves B working', async () => {
    const result = await Promise.all(
      [tokenA, tokenB].map((token) =>
        rpc(token, 'tools/call', { name: 'jules_gateway_info', arguments: {} }),
      ),
    );
    expect(result.map((r) => r.data.result.structuredContent.principal.clientId)).toEqual(['alpha', 'beta']);
    const registry = JSON.parse(bindings.SERVICE_TOKENS_JSON);
    registry[0].revoked = true;
    bindings.SERVICE_TOKENS_JSON = JSON.stringify(registry);
    expect((await rpc(tokenA, 'tools/list')).response.status).toBe(401);
    expect((await rpc(tokenB, 'tools/list')).response.status).toBe(200);
  });
  it('mocks Google, not the MCP transport, for a real tool call', async () => {
    replyOnce('https://jules.googleapis.com/v1alpha/sessions?pageSize=20', 'GET', { sessions: [] });
    const { data } = await rpc(tokenA, 'tools/call', { name: 'jules_list_sessions', arguments: {} });
    expect(data.result.structuredContent.sessions).toEqual([]);
  });
  it('rejects wrong Origin, alternate hostname, missing configuration and oversized body', async () => {
    expect(
      (await dispatch('/mcp', { method: 'POST', headers: { Origin: 'https://evil.test' } })).status,
    ).toBe(403);
    const ctx = createExecutionContext();
    expect(
      (await worker.fetch(new Request('https://alternate.example.test/mcp'), bindings, ctx)).status,
    ).toBe(403);
    expect((await dispatch('/mcp', { method: 'POST', body: 'x'.repeat(70000) })).status).toBe(413);
    bindings.ADMIN_TOKEN_SHA256 = '';
    expect((await dispatch('/mcp')).status).toBeGreaterThanOrEqual(500);
  });
  it('ordinary MCP credential cannot administer OAuth', async () => {
    expect(
      (
        await dispatch('/admin', {
          method: 'POST',
          headers: { Authorization: `Bearer ${tokenA}`, 'Content-Type': 'application/json' },
          body: '{"action":"list-grants"}',
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await dispatch('/admin', {
          method: 'POST',
          headers: { Authorization: `Bearer ${admin}`, Origin: origin, 'Content-Type': 'application/json' },
          body: '{"action":"list-grants"}',
        })
      ).status,
    ).toBe(403);
  });
  it('Stage-0 discovers, writes and reads without a Jules key or outbound HTTP', async () => {
    delete bindings.JULES_API_KEY;
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const tools = await rpc(tokenA, 'tools/list', {}, diagnostic);
    expect(tools.data.result.tools).toHaveLength(2);
    const written = await rpc(
      tokenA,
      'tools/call',
      { name: 'jules_feasibility_write', arguments: {} },
      diagnostic,
    );
    const nonce = written.data.result.structuredContent.nonce;
    const read = await rpc(
      tokenA,
      'tools/call',
      { name: 'jules_feasibility_read', arguments: { nonce } },
      diagnostic,
    );
    expect(read.data.result.structuredContent.nonceFound).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
async function authoriseOAuth() {
  const created = await adminCall({
    action: 'create-client',
    name: 'Synthetic hosted client',
    redirectUri: 'https://client.example.test/callback',
    tokenEndpointAuthMethod: 'none',
  });
  expect(created.status).toBe(200);
  const client = (await created.json()) as { clientId: string };
  const verifier = randomSecret();
  const query = new URLSearchParams({
    client_id: client.clientId,
    response_type: 'code',
    redirect_uri: 'https://client.example.test/callback',
    resource: `${origin}/mcp`,
    scope: 'jules:read jules:control',
    state: 'client-state',
    code_challenge: await pkceChallenge(verifier),
    code_challenge_method: 'S256',
  });
  const start = await dispatch(`/authorize?${query}`);
  expect(start.status).toBe(200);
  expect(start.headers.get('referrer-policy')).toBe('strict-origin');
  expect(start.headers.get('content-security-policy')).toBe(
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://github.com https://client.example.test; base-uri 'none'; frame-ancestors 'none'",
  );
  for (const unregisteredRedirect of [
    'https://untrusted.example.test/callback',
    'https://client.example.test/unregistered',
  ]) {
    const invalidQuery = new URLSearchParams(query);
    invalidQuery.set('redirect_uri', unregisteredRedirect);
    const rejected = await dispatch(`/authorize?${invalidQuery}`);
    expect(rejected.status).toBe(400);
    expect(rejected.headers.has('location')).toBe(false);
    expect(rejected.headers.has('set-cookie')).toBe(false);
    expect(rejected.headers.get('content-security-policy') ?? '').not.toContain('untrusted.example.test');
  }
  const cookie = start.headers.get('set-cookie')!.split(';')[0];
  const html = await start.text();
  const transaction = html.match(/name="transaction" value="([^"]+)"/)![1];
  const consent = await dispatch('/consent', {
    method: 'POST',
    headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ transaction, decision: 'allow' }),
  });
  expect(consent.status).toBe(302);
  expect(consent.headers.get('referrer-policy')).toBe('no-referrer');
  expect(consent.headers.get('content-security-policy')).toContain("form-action 'self';");
  const state = new URL(consent.headers.get('location')!).searchParams.get('state')!;
  replyOnce('https://github.com/login/oauth/access_token', 'POST', { access_token: 'synthetic-login-token' });
  replyOnce('https://api.github.com/user', 'GET', { id: 12345 });
  const callback = await dispatch(`/oauth/github/callback?state=${state}&code=synthetic-code`, {
    headers: { Cookie: cookie },
  });
  expect(callback.status).toBe(302);
  return {
    clientId: client.clientId,
    code: new URL(callback.headers.get('location')!).searchParams.get('code')!,
    verifier,
  };
}
async function exchange(values: Record<string, string>) {
  return dispatch('/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(values),
  });
}
describe('real maintained OAuth-provider integration with mocked GitHub identity', () => {
  it('rejects registered redirect origins with CSP wildcard or directive delimiters', async () => {
    for (const redirectUri of [
      'https://*.example.test/callback',
      'https://host;name.example.test/callback',
    ]) {
      const created = await adminCall({
        action: 'create-client',
        name: 'Synthetic malformed CSP host',
        redirectUri,
        tokenEndpointAuthMethod: 'none',
      });
      expect(created.status).toBe(200);
      const { clientId } = (await created.json()) as { clientId: string };
      const query = new URLSearchParams({
        client_id: clientId,
        response_type: 'code',
        redirect_uri: redirectUri,
        resource: `${origin}/mcp`,
        scope: 'jules:read',
        state: 'synthetic-state',
        code_challenge: 'A'.repeat(43),
        code_challenge_method: 'S256',
      });
      const rejected = await dispatch(`/authorize?${query}`);
      expect(rejected.status).toBe(400);
      expect(rejected.headers.has('set-cookie')).toBe(false);
      expect(rejected.headers.has('content-security-policy')).toBe(false);
    }
  });
  it('continues rejecting null and foreign consent origins', async () => {
    for (const originHeader of ['null', 'https://untrusted.example.test']) {
      const response = await dispatch('/consent', {
        method: 'POST',
        headers: { Origin: originHeader, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'decision=allow&transaction=synthetic',
      });
      expect(response.status).toBe(403);
      expect(response.headers.get('referrer-policy')).toBe('no-referrer');
      expect(response.headers.has('location')).toBe(false);
    }
  });
  it('preserves provider server failures, unexpected failures and existing gateway denials', async () => {
    const failures = [
      [
        new AuthorizationError('server_error', { description: 'synthetic-private-detail' }),
        500,
        'INTERNAL_ERROR',
      ],
      [
        new AuthorizationError('temporarily_unavailable', { description: 'synthetic-private-detail' }),
        500,
        'INTERNAL_ERROR',
      ],
      [new Error('synthetic-private-detail'), 500, 'INTERNAL_ERROR'],
      [new GatewayError('OWNER_DENIED', 403), 403, 'OWNER_DENIED'],
    ] as const;
    const get = vi.spyOn(bindings.OAUTH_KV, 'get');
    for (const [error, status, code] of failures) {
      get.mockRejectedValueOnce(error);
      const response = await dispatch('/authorize?client_id=synthetic-client');
      expect(response.status).toBe(status);
      const body = await response.text();
      expect(JSON.parse(body).error.code).toBe(code);
      expect(body).not.toContain('synthetic-private-detail');
    }
  });
  it('rejects an unknown authorization client without an internal error or reflected input', async () => {
    const query = new URLSearchParams({
      client_id: 'unknown-synthetic-client',
      response_type: 'code',
      redirect_uri: 'https://untrusted.example.test/callback',
      resource: `${origin}/mcp`,
      scope: 'jules:read',
      code_challenge: 'A'.repeat(43),
      code_challenge_method: 'S256',
    });
    const response = await dispatch(`/authorize?${query}`);
    expect(response.status).toBe(400);
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.has('location')).toBe(false);
    const body = await response.text();
    expect(JSON.parse(body).error.code).toBe('OAUTH_INVALID_REQUEST');
    expect(body).not.toContain('unknown-synthetic-client');
    expect(body).not.toContain('untrusted.example.test');
  });
  it('exchanges S256 code, calls MCP, refreshes with downscope, and revokes grant', async () => {
    const auth = await authoriseOAuth();
    const response = await exchange({
      grant_type: 'authorization_code',
      client_id: auth.clientId,
      code: auth.code,
      code_verifier: auth.verifier,
      redirect_uri: 'https://client.example.test/callback',
      resource: `${origin}/mcp`,
    });
    expect(response.status).toBe(200);
    const token = (await response.json()) as { access_token: string; refresh_token: string };
    expect((await rpc(token.access_token, 'tools/list')).response.status).toBe(200);
    const refreshed = await exchange({
      grant_type: 'refresh_token',
      client_id: auth.clientId,
      refresh_token: token.refresh_token,
      resource: `${origin}/mcp`,
      scope: 'jules:read',
    });
    expect(refreshed.status).toBe(200);
    const next = (await refreshed.json()) as { access_token: string };
    const denied = await rpc(next.access_token, 'tools/call', {
      name: 'jules_delete_session',
      arguments: { session: 'sessions/disposable-only' },
    });
    expect(denied.data.result.structuredContent.error.code).toBe('FORBIDDEN');
    const grants = (await (await adminCall({ action: 'list-grants' })).json()) as {
      items: Array<{ id: string }>;
    };
    expect(grants.items).toHaveLength(1);
    expect((await adminCall({ action: 'revoke-grant', grantId: grants.items[0].id })).status).toBe(200);
    expect((await rpc(next.access_token, 'tools/list')).response.status).toBe(401);
  });
  it('wrong PKCE and wrong audience are rejected; code replay cannot issue another token', async () => {
    const auth = await authoriseOAuth();
    const base = {
      grant_type: 'authorization_code',
      client_id: auth.clientId,
      code: auth.code,
      code_verifier: auth.verifier,
      redirect_uri: 'https://client.example.test/callback',
      resource: `${origin}/mcp`,
    };
    expect((await exchange({ ...base, code_verifier: randomSecret() })).status).toBe(400);
    expect((await exchange({ ...base, resource: 'https://other.example.test/mcp' })).status).toBe(400);
    expect((await exchange(base)).status).toBe(200);
    expect((await exchange(base)).status).toBe(400);
  });
});

describe('credential and mutation runtime boundaries', () => {
  it('rejects invalid and expired service credentials before outbound requests', async () => {
    expect((await rpc('invalid', 'tools/list')).response.status).toBe(401);
    const registry = JSON.parse(bindings.SERVICE_TOKENS_JSON);
    registry[0].expiresAt = '2000-01-01T00:00:00Z';
    bindings.SERVICE_TOKENS_JSON = JSON.stringify(registry);
    expect((await rpc(tokenA, 'tools/list')).response.status).toBe(401);
  });
  it('read scope cannot write; control scope can perform the benign write', async () => {
    const registry = JSON.parse(bindings.SERVICE_TOKENS_JSON);
    registry[0].scopes = ['jules:read'];
    bindings.SERVICE_TOKENS_JSON = JSON.stringify(registry);
    const denied = await rpc(tokenA, 'tools/call', {
      name: 'jules_delete_session',
      arguments: { session: 'sessions/disposable-only' },
    });
    expect(denied.data.result.structuredContent.error.code).toBe('FORBIDDEN');
    const allowed = await rpc(
      tokenB,
      'tools/call',
      { name: 'jules_feasibility_write', arguments: {} },
      diagnostic,
    );
    expect(allowed.data.result.isError).not.toBe(true);
    expect(allowed.data.result.structuredContent.nonce).toHaveLength(43);
  });
  it('does not retry a mutation whose response is lost', async () => {
    const upstream = vi.fn(async () => {
      throw new TypeError('synthetic lost response');
    });
    vi.stubGlobal('fetch', upstream);
    const result = await rpc(tokenA, 'tools/call', {
      name: 'jules_send_message',
      arguments: { session: 'sessions/disposable-only', prompt: 'Synthetic test' },
    });
    expect(result.data.result.structuredContent.error.code).toBe('UPSTREAM_OUTCOME_UNKNOWN');
    expect(upstream).toHaveBeenCalledTimes(1);
  });
  it('enforces the native control limiter', async () => {
    const id = crypto.randomUUID().replaceAll('-', '');
    tokenA = `jmg_${id}.${randomSecret()}`;
    bindings.SERVICE_TOKENS_JSON = JSON.stringify([
      { id, clientId: 'limiter-test', sha256: await sha256(tokenA), scopes: ['jules:read', 'jules:control'] },
    ]);
    for (let i = 0; i < 10; i++)
      expect(
        (await rpc(tokenA, 'tools/call', { name: 'jules_feasibility_write', arguments: {} }, diagnostic)).data
          .result.isError,
      ).not.toBe(true);
    const denied = await rpc(
      tokenA,
      'tools/call',
      { name: 'jules_feasibility_write', arguments: {} },
      diagnostic,
    );
    expect(denied.data.result.isError).toBe(true);
  });
});

describe('official SDK client compatibility (local Worker runtime)', () => {
  for (const modern of [false, true])
    it(`${modern ? 'v2' : 'legacy'} client connects, discovers, reads, writes, reconnects and fails after revocation`, async () => {
      const { Client } = modern
        ? await import('@modelcontextprotocol/client')
        : await import('@modelcontextprotocol/sdk/client/index.js');
      const { StreamableHTTPClientTransport } = modern
        ? await import('@modelcontextprotocol/client')
        : await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
      const makeClient = async () => {
        const client = new Client({ name: 'synthetic-sdk-client', version: modern ? '2.0.0' : '1.30.0' });
        const transport = new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
          requestInit: { headers: { Authorization: `Bearer ${tokenB}` } },
          fetch: async (input, init) => {
            const req = new Request(input, init);
            return dispatch(
              new URL(req.url).pathname,
              { method: req.method, headers: req.headers, ...(req.body ? { body: await req.text() } : {}) },
              diagnostic,
            );
          },
        });
        await client.connect(transport);
        return client;
      };
      let client = await makeClient();
      expect((await client.listTools()).tools).toHaveLength(2);
      const written = await client.callTool({ name: 'jules_feasibility_write', arguments: {} });
      const nonce = (written.structuredContent as { nonce: string }).nonce;
      expect(
        (await client.callTool({ name: 'jules_feasibility_read', arguments: { nonce } })).structuredContent,
      ).toMatchObject({ nonceFound: true });
      await client.close();
      client = await makeClient();
      expect(
        (await client.callTool({ name: 'jules_feasibility_read', arguments: { nonce } })).structuredContent,
      ).toMatchObject({ nonceFound: true });
      const registry = JSON.parse(bindings.SERVICE_TOKENS_JSON);
      registry[1].revoked = true;
      bindings.SERVICE_TOKENS_JSON = JSON.stringify(registry);
      await expect(client.listTools()).rejects.toThrow();
      await client.close();
    });
});
