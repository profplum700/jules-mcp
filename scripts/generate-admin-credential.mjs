#!/usr/bin/env node
import { randomBytes, createHash } from 'node:crypto';
import { writePrivate } from './private-files.mjs';
const flags = process.argv.slice(2);
if (flags.length > 1 || flags.some((flag) => flag !== '--rotate'))
  throw new Error('Usage: node scripts/generate-admin-credential.mjs [--rotate]');
const rotate = flags.includes('--rotate');
const token = `jma_${randomBytes(32).toString('base64url')}`;
await writePrivate('.private/admin.token', token + '\n', rotate);
await writePrivate('.private/admin.sha256', createHash('sha256').update(token).digest('hex') + '\n', rotate);
console.log(
  'Wrote .private/admin.token and .private/admin.sha256. Put only the verifier in ADMIN_TOKEN_SHA256. Never use this token as an MCP credential.',
);
