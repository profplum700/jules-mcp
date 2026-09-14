import test from 'node:test';
import assert from 'node:assert/strict';
import { randomSecret, sha256, equalDigest, pkceChallenge } from '../../src/shared/crypto.ts';
import { parseCredentials, verifyServiceToken } from '../../src/auth/service-tokens.ts';
import { safeLogEvent } from '../../src/observability/safe-log.ts';
import { parseConfig, allowedOrigin } from '../../src/platform/config.ts';
const env = () => ({
  PUBLIC_ORIGIN: 'https://gateway.example.test',
  OWNER_GITHUB_ID: '123456',
  GITHUB_CLIENT_ID: 'synthetic-client',
  GITHUB_CLIENT_SECRET: 'synthetic-client-secret',
  ADMIN_TOKEN_SHA256: 'a'.repeat(64),
  SERVICE_TOKENS_JSON: '[]',
  GATEWAY_DISABLED: 'false',
});
async function credential(id) {
  const token = `jmg_${id}.${randomSecret()}`;
  return {
    token,
    row: { id, clientId: id, sha256: await sha256(token), scopes: ['jules:read', 'jules:control'] },
  };
}
test('credentials have 256 random bits and separate verified identities', async () => {
  const a = await credential('a');
  const b = await credential('b');
  assert.match(a.token, /^jmg_a\.[A-Za-z0-9_-]{43}$/);
  const rows = parseCredentials(JSON.stringify([a.row, b.row]));
  assert.equal((await verifyServiceToken(a.token, rows)).clientId, 'a');
  assert.equal((await verifyServiceToken(b.token, rows)).clientId, 'b');
});
test('revocation of A does not affect B', async () => {
  const a = await credential('a');
  const b = await credential('b');
  const rows = [{ ...a.row, revoked: true }, b.row];
  assert.equal(await verifyServiceToken(a.token, rows), null);
  assert.equal((await verifyServiceToken(b.token, rows)).clientId, 'b');
});
test('expired credential denied', async () => {
  const a = await credential('a');
  assert.equal(await verifyServiceToken(a.token, [{ ...a.row, expiresAt: '2000-01-01T00:00:00Z' }]), null);
});
test('unknown id, wrong secret and missing token denied', async () => {
  const a = await credential('a');
  for (const token of [
    '',
    `jmg_other.${randomSecret()}`,
    `jmg_a.${randomSecret()}`,
    a.token + 'x',
    'oauth-like-token',
  ])
    assert.equal(await verifyServiceToken(token, [a.row]), null);
});
for (const value of [
  'null',
  '{}',
  'not json',
  '[{}]',
  JSON.stringify([{ id: 'x', sha256: 'a'.repeat(64), clientId: 'x', scopes: ['admin'] }]),
  ' '.repeat(5000),
])
  test(`invalid credential config fails closed ${value.slice(0, 20)}`, () =>
    assert.throws(
      () => parseCredentials(value),
      (e) => e.code === 'CONFIGURATION_ERROR',
    ));
test('duplicate credential IDs rejected', async () => {
  const a = await credential('a');
  assert.throws(() => parseCredentials(JSON.stringify([a.row, a.row])));
});
test('constant-time verifier comparison does not accept malformed hashes', () => {
  assert.equal(equalDigest('a'.repeat(64), 'a'.repeat(64)), true);
  assert.equal(equalDigest('a'.repeat(63), 'a'.repeat(63)), false);
  assert.equal(equalDigest('a'.repeat(64), 'b'.repeat(64)), false);
});
test('PKCE S256 test vector', async () =>
  assert.equal(
    await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),
    'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  ));
test('logging allowlist removes prompt code tokens URLs errors headers', () => {
  const data = {
    requestId: '00000000-0000-4000-8000-000000000000',
    clientId: 'a',
    tool: 'jules_create_session',
    category: 'OK',
    durationMs: 42,
    prompt: 'PRIVATE_SENTINEL',
    code: 'PRIVATE_SENTINEL',
    headers: { Authorization: 'PRIVATE_SENTINEL' },
    error: new Error('PRIVATE_SENTINEL'),
    url: 'https://example.test/?secret=PRIVATE_SENTINEL',
  };
  const output = safeLogEvent(data);
  assert.equal(JSON.stringify(output).includes('PRIVATE_SENTINEL'), false);
  assert.deepEqual(Object.keys(output).sort(), ['category', 'clientId', 'durationMs', 'requestId', 'tool']);
});
test('untrusted log category and client labels cannot inject content', () => {
  const output = safeLogEvent({ category: 'secret-token', clientId: 'name\nsecret', tool: 'private code' });
  assert.deepEqual(output, {});
});
test('valid config and exact Origin policy', () => {
  const config = parseConfig(env());
  assert.equal(allowedOrigin(new Request(`${config.origin}/mcp`), config), true);
  assert.equal(
    allowedOrigin(new Request(`${config.origin}/mcp`, { headers: { Origin: 'https://evil.test' } }), config),
    false,
  );
});
for (const key of [
  'PUBLIC_ORIGIN',
  'OWNER_GITHUB_ID',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
  'ADMIN_TOKEN_SHA256',
  'SERVICE_TOKENS_JSON',
  'GATEWAY_DISABLED',
])
  test(`missing ${key} fails closed`, () => {
    const e = env();
    delete e[key];
    assert.throws(() => parseConfig(e));
  });
test('config cannot raise envelope or accept arbitrary insecure origin', () => {
  assert.throws(() => parseConfig({ ...env(), LIMITS_JSON: '{"maxRequests":1000}' }));
  assert.throws(() => parseConfig({ ...env(), PUBLIC_ORIGIN: 'http://gateway.example.test' }));
  assert.throws(() => parseConfig({ ...env(), ALLOWED_ORIGINS_JSON: '["*"]' }));
});
