#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { writePrivate } from './private-files.mjs';
const [action, ...args] = process.argv.slice(2);
const origin = new URL(process.env.GATEWAY_ORIGIN ?? '');
if (origin.protocol !== 'https:' || origin.origin !== process.env.GATEWAY_ORIGIN)
  throw new Error('Set canonical GATEWAY_ORIGIN.');
const token = (await readFile('.private/admin.token', 'utf8')).trim();
if (!/^jma_[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('Invalid admin credential file.');
let data;
if (action === 'create-client') {
  if (!args[0] || !args[1])
    throw new Error(
      'Usage: oauth-admin.mjs create-client NAME EXACT_REDIRECT_URI [client_secret_post|client_secret_basic|none]',
    );
  data = {
    action,
    name: args[0],
    redirectUri: args[1],
    tokenEndpointAuthMethod: args[2] ?? 'client_secret_post',
  };
} else if (action === 'list-grants') data = { action, ...(args[0] ? { cursor: args[0] } : {}) };
else if (action === 'revoke-grant') data = { action, grantId: args[0] };
else if (action === 'delete-client') data = { action, clientId: args[0] };
else throw new Error('Supported: create-client, list-grants [cursor], revoke-grant ID, delete-client ID.');
const response = await fetch(new URL('/admin', origin), {
  method: 'POST',
  redirect: 'error',
  signal: AbortSignal.timeout(20000),
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(data),
});
if (!response.ok)
  throw new Error(
    `Admin operation failed (HTTP ${response.status}). No automatic retry: check existing records before creating another client.`,
  );
const result = await response.text();
if (result.length > 65536) throw new Error('Unexpectedly large admin response.');
const suffix = Date.now();
const filename = `.private/oauth-${action}-${suffix}.json`;
await writePrivate(filename, result + '\n');
console.log(
  `Saved response in ${filename}; secrets and grant records were not printed. Read it locally, never paste into chat or issues.`,
);
