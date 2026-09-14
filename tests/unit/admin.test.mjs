import test from 'node:test';
import assert from 'node:assert/strict';
import { oauthAdmin } from '../../src/auth/admin.ts';
import { parseConfig } from '../../src/platform/config.ts';
import { randomSecret, sha256 } from '../../src/shared/crypto.ts';
import { RequestBudget } from '../../src/shared/limits.ts';
async function setup(t) {
  const token = `jma_${randomSecret()}`;
  const config = parseConfig({
    PUBLIC_ORIGIN: 'https://gateway.example.test',
    OWNER_GITHUB_ID: '12345',
    GITHUB_CLIENT_ID: 'synthetic-client',
    GITHUB_CLIENT_SECRET: 'synthetic-secret',
    SERVICE_TOKENS_JSON: '[]',
    ADMIN_TOKEN_SHA256: await sha256(token),
    GATEWAY_DISABLED: 'false',
  });
  const budget = new RequestBudget();
  t.after(() => budget.close());
  const calls = [];
  const api = {
    createClient: async (data) => {
      calls.push(['createClient', data]);
      return { clientId: 'opaque-client', ...data };
    },
    listUserGrants: async (...args) => {
      calls.push(['listUserGrants', ...args]);
      return { items: [], cursor: 'next-page' };
    },
    revokeGrant: async (...args) => {
      calls.push(['revokeGrant', ...args]);
    },
    deleteClient: async (...args) => {
      calls.push(['deleteClient', ...args]);
    },
  };
  const run = (body, options = {}) =>
    oauthAdmin(
      new Request(`${config.origin}/admin`, {
        method: options.method ?? 'POST',
        headers: {
          Authorization: `Bearer ${options.token ?? token}`,
          'Content-Type': 'application/json',
          ...options.headers,
        },
        ...(options.method === 'GET' ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
      }),
      api,
      config,
      budget,
    );
  return { token, config, calls, run };
}
test('admin uses provider helper for exact pre-registration; no DCR required', async (t) => {
  const { run, calls } = await setup(t);
  const r = await run({
    action: 'create-client',
    name: 'Hosted client',
    redirectUri: 'https://client.example.test/callback?installation=one',
    tokenEndpointAuthMethod: 'client_secret_post',
  });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.deepEqual(calls[0], [
    'createClient',
    {
      clientName: 'Hosted client',
      redirectUris: ['https://client.example.test/callback?installation=one'],
      grantTypes: ['authorization_code', 'refresh_token'],
      responseTypes: ['code'],
      tokenEndpointAuthMethod: 'client_secret_post',
    },
  ]);
});
test('admin grant listing is bounded and tied to configured owner', async (t) => {
  const { run, calls } = await setup(t);
  assert.equal(
    (await (await run({ action: 'list-grants', cursor: 'opaque-page' })).json()).cursor,
    'next-page',
  );
  assert.deepEqual(calls, [['listUserGrants', '12345', { limit: 10, cursor: 'opaque-page' }]]);
});
test('revocation/deletion use maintained helpers, not opaque KV edits', async (t) => {
  const { run, calls } = await setup(t);
  await run({ action: 'revoke-grant', grantId: 'grant-one' });
  await run({ action: 'delete-client', clientId: 'client-one' });
  assert.deepEqual(calls, [
    ['revokeGrant', 'grant-one', '12345'],
    ['deleteClient', 'client-one'],
  ]);
});
for (const [label, options, code] of [
  ['service credential', { token: `jmg_test.${randomSecret()}` }, 'UNAUTHENTICATED'],
  ['wrong admin credential', { token: `jma_${randomSecret()}` }, 'UNAUTHENTICATED'],
  ['browser Origin', { headers: { Origin: 'https://gateway.example.test' } }, 'FORBIDDEN'],
  ['GET', { method: 'GET' }, 'FORBIDDEN'],
  ['form content type', { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }, 'FORBIDDEN'],
])
  test(`admin denies ${label} before provider helper`, async (t) => {
    const { run, calls } = await setup(t);
    await assert.rejects(run({ action: 'list-grants' }, options), (e) => e.code === code);
    assert.equal(calls.length, 0);
  });
for (const data of [
  'null',
  '[]',
  '{broken',
  { action: 'unknown' },
  { action: 'revoke-grant', grantId: '../other' },
  { action: 'create-client', name: 'x', redirectUri: 'not a URL', tokenEndpointAuthMethod: 'none' },
  {
    action: 'create-client',
    name: 'x',
    redirectUri: 'http://client.example.test/callback',
    tokenEndpointAuthMethod: 'none',
  },
])
  test(`admin rejects malformed input ${JSON.stringify(data).slice(0, 50)}`, async (t) => {
    const { run, calls } = await setup(t);
    await assert.rejects(run(data), (e) => e.code === 'INVALID_ARGUMENT');
    assert.equal(calls.length, 0);
  });
