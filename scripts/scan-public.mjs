#!/usr/bin/env node
/** Offline additional safeguard, NOT a claim to replace GitHub secret scanning or gitleaks. */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
const skip = new Set(['.git', 'node_modules', '.private', '.deploy', '.wrangler', 'dist', 'reports']);
const patterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{40,}\b/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /\bjmg_[A-Za-z0-9_-]{1,32}\.[A-Za-z0-9_-]{43}\b/,
  /\bjma_[A-Za-z0-9_-]{43}\b/,
];
const failures = [];
async function walk(dir = '.') {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path);
    else {
      const text = await readFile(path, 'utf8');
      if (patterns.some((p) => p.test(text))) failures.push(path);
    }
  }
}
await walk();
// Inspect every reachable historical blob, including files deleted from HEAD.
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
let historicalBlobs = 0;
if (git('rev-parse', '--is-shallow-repository').trim() === 'true') {
  throw new Error('History scan requires a complete clone (fetch-depth: 0 in CI).');
}
for (const line of git('rev-list', '--objects', '--all').trim().split('\n')) {
  const [oid, ...path] = line.split(' ');
  if (git('cat-file', '-t', oid).trim() !== 'blob') continue;
  historicalBlobs++;
  if (patterns.some((pattern) => pattern.test(git('cat-file', 'blob', oid))))
    failures.push(`history:${oid}:${path.join(' ')}`);
}

if (failures.length) {
  console.error('Possible credentials detected in files (values suppressed):', failures.join(', '));
  process.exit(1);
}
console.log(
  `Working tree and ${historicalBlobs} historical blobs passed credential-pattern scanning. Provider-side secret protection is still required.`,
);
