#!/usr/bin/env node
/** Explicit one-time engineering bootstrap, not a production deployment shortcut. */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
if (existsSync('pnpm-lock.yaml') && !process.argv.includes('--refresh'))
  throw new Error('Lockfile already exists. Use pnpm install --frozen-lockfile, or --refresh intentionally.');
const run = (args) => {
  const r = spawnSync('pnpm', args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.error || r.status !== 0) {
    console.error('Dependency bootstrap command failed; no passing validation is claimed.');
    process.exit(r.status ?? 1);
  }
};
run(['install', '--no-frozen-lockfile']);
run(['format']);
run(['check']);
console.log(
  'Dependency resolution and checks passed. Review and commit pnpm-lock.yaml plus formatting changes. No deployment or Git push was performed.',
);
