#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { writePrivate } from './private-files.mjs';
const [id] = process.argv.slice(2);
const path = '.private/service-tokens.json';
const rows = JSON.parse(await readFile(path, 'utf8'));
const row = rows.find((r) => r.id === id);
if (!row) throw new Error('Unknown credential ID.');
row.revoked = true;
await writePrivate(path, JSON.stringify(rows, null, 2) + '\n', true);
console.log(
  'Updated the local verifier registry only. Apply SERVICE_TOKENS_JSON to Cloudflare, then verify this credential fails and another still works.',
);
