#!/usr/bin/env node
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
export function renderConfig(base, env) {
  const mode = env.GATEWAY_MODE ?? 'production';
  if (!['production', 'feasibility'].includes(mode)) throw new Error('Invalid GATEWAY_MODE.');
  if (!/^[a-z][a-z0-9-]{2,62}$/.test(env.WORKER_NAME ?? '')) throw new Error('Set WORKER_NAME.');
  if (mode === 'feasibility' && !env.WORKER_NAME.endsWith('-feasibility'))
    throw new Error('Stage 0 requires a separate name ending in -feasibility.');
  if (!/^[a-f0-9]{32}$/.test(env.OAUTH_KV_NAMESPACE_ID ?? ''))
    throw new Error('Set a real OAUTH_KV_NAMESPACE_ID.');
  if (env.OAUTH_KV_NAMESPACE_ID === '0'.repeat(32)) throw new Error('Placeholder KV ID cannot deploy.');
  const origin = new URL(env.PUBLIC_ORIGIN);
  if (
    origin.protocol !== 'https:' ||
    origin.origin !== env.PUBLIC_ORIGIN ||
    origin.username ||
    origin.password ||
    origin.port
  )
    throw new Error('PUBLIC_ORIGIN must be a canonical HTTPS origin.');
  const rateIds = ['RATE_AUTH_NAMESPACE_ID', 'RATE_READ_NAMESPACE_ID', 'RATE_CONTROL_NAMESPACE_ID'].map(
    (name) => env[name],
  );
  if (!rateIds.every((v) => /^[1-9][0-9]{0,8}$/.test(v ?? '')) || new Set(rateIds).size !== 3)
    throw new Error('Set three distinct account-unique numeric rate-limit namespace IDs.');
  if (!/^[a-f0-9]{40}$/.test(env.BUILD_COMMIT ?? ''))
    throw new Error('Set BUILD_COMMIT to the exact validated Git commit.');
  if (env.CONFIRMED_FREE_PLAN !== 'true')
    throw new Error('Confirm the target account is Workers Free; no plan upgrade is authorised.');
  const disabled = env.GATEWAY_DISABLED ?? 'true';
  if (!['true', 'false'].includes(disabled)) throw new Error('GATEWAY_DISABLED must be true or false.');
  return {
    ...base,
    name: env.WORKER_NAME,
    main: `../src/${mode === 'feasibility' ? 'feasibility' : 'index'}.ts`,
    kv_namespaces: [{ binding: 'OAUTH_KV', id: env.OAUTH_KV_NAMESPACE_ID }],
    ratelimits: base.ratelimits.map((binding, i) => ({ ...binding, namespace_id: rateIds[i] })),
    vars: {
      GATEWAY_DISABLED: disabled,
      PUBLIC_ORIGIN: origin.origin,
      BUILD_COMMIT: env.BUILD_COMMIT,
      ALLOWED_ORIGINS_JSON: env.ALLOWED_ORIGINS_JSON ?? '[]',
    },
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const base = JSON.parse(await readFile('wrangler.jsonc', 'utf8'));
  const config = renderConfig(base, process.env);
  await mkdir('.deploy', { recursive: true, mode: 0o700 });
  await writeFile('.deploy/wrangler.json', JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  console.log('Rendered .deploy/wrangler.json; no runtime secrets are in this file.');
}
