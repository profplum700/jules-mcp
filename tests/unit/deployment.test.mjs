import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderConfig } from '../../scripts/render-deploy-config.mjs';
const base = JSON.parse(readFileSync('wrangler.jsonc', 'utf8'));
const vars = {
  WORKER_NAME: 'example-gateway',
  OAUTH_KV_NAMESPACE_ID: 'a'.repeat(32),
  PUBLIC_ORIGIN: 'https://example-gateway.example.workers.dev',
  RATE_AUTH_NAMESPACE_ID: '1001',
  RATE_READ_NAMESPACE_ID: '1002',
  RATE_CONTROL_NAMESPACE_ID: '1003',
  BUILD_COMMIT: 'a'.repeat(40),
  CONFIRMED_FREE_PLAN: 'true',
};
test('renderer maps variables explicitly; no shell interpolation or runtime secrets', () => {
  const c = renderConfig(base, vars);
  assert.equal(c.name, 'example-gateway');
  assert.equal(c.vars.GATEWAY_DISABLED, 'true');
  assert.equal(c.kv_namespaces[0].id, vars.OAUTH_KV_NAMESPACE_ID);
  assert.equal(c.main, '../src/index.ts');
  assert.equal(c.vars.JULES_API_KEY, undefined);
  assert.equal(c.preview_urls, false);
});
for (const key of Object.keys(vars))
  test(`renderer rejects missing ${key}`, () => {
    const v = { ...vars };
    delete v[key];
    assert.throws(() => renderConfig(base, v));
  });
test('Stage-0 diagnostic entrypoint cannot replace production accidentally', () => {
  assert.throws(() => renderConfig(base, { ...vars, GATEWAY_MODE: 'feasibility' }));
  assert.throws(
    () => renderConfig(base, { ...vars, GATEWAY_MODE: 'production', WORKER_NAME: 'example-feasibility' }),
    /Production cannot overwrite/,
  );
  assert.throws(
    () => renderConfig(base, { ...vars, WORKER_NAME: 'example-feasibility' }),
    /Production cannot overwrite/,
  );
  const c = renderConfig(base, { ...vars, GATEWAY_MODE: 'feasibility', WORKER_NAME: 'example-feasibility' });
  assert.equal(c.main, '../src/feasibility.ts');
});
test('no paid infrastructure bindings, DOs, tasks or schedules', () => {
  for (const field of [
    'durable_objects',
    'd1_databases',
    'r2_buckets',
    'queues',
    'triggers',
    'workflows',
    'ai',
    'containers',
    'hyperdrive',
  ])
    assert.equal(base[field], undefined);
  assert.equal(base.kv_namespaces.length, 1);
});
