#!/usr/bin/env node
import { randomBytes, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { writePrivate } from './private-files.mjs';
const [id, ...flags] = process.argv.slice(2);
if (
  !/^[A-Za-z0-9_-]{1,32}$/.test(id ?? '') ||
  id === 'admin' ||
  flags.some((f) => !['--read-only', '--rotate'].includes(f))
) {
  console.error(
    'Usage: node scripts/generate-client-credential.mjs CLIENT_ID [--read-only] [--rotate] (admin is a reserved credential-file name)',
  );
  process.exit(1);
}
const rotate = flags.includes('--rotate');
const path = '.private/service-tokens.json';
let rows = [];
try {
  rows = JSON.parse(await readFile(path, 'utf8'));
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}
if (!Array.isArray(rows) || rows.length > 12) throw new Error('Invalid local verifier registry.');
const exists = rows.find((r) => r.id === id);
if (exists && !rotate) throw new Error('Credential exists; use --rotate explicitly.');
if (!exists && rotate) throw new Error('No existing credential to rotate.');
if (!exists && rows.length >= 12) throw new Error('Maximum 12 client credentials.');
const token = `jmg_${id}.${randomBytes(32).toString('base64url')}`;
const row = {
  id,
  clientId: id,
  sha256: createHash('sha256').update(token).digest('hex'),
  scopes: flags.includes('--read-only') ? ['jules:read'] : ['jules:read', 'jules:control'],
};
rows = [...rows.filter((r) => r.id !== id), row];
const registry = JSON.stringify(rows, null, 2) + '\n';
if (Buffer.byteLength(registry) > 4096)
  throw new Error('Verifier registry exceeds Worker secret size limit.');
await writePrivate(`.private/${id}.token`, token + '\n', rotate);
await writePrivate(path, registry, true);
console.log(
  `Wrote .private/${id}.token and .private/service-tokens.json. No secret value was printed. Apply the registry as the SERVICE_TOKENS_JSON Worker secret.`,
);
