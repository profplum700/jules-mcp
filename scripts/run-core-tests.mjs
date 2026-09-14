#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readdirSync, mkdirSync, writeFileSync } from 'node:fs';
const files = ['tests/unit', 'tests/contract'].flatMap((dir) =>
  readdirSync(dir)
    .filter((f) => f.endsWith('.test.mjs'))
    .map((f) => `${dir}/${f}`),
);
const result = spawnSync(
  process.execPath,
  ['--experimental-strip-types', '--test', '--test-reporter=tap', ...files],
  { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, timeout: 45000 },
);
mkdirSync('reports', { recursive: true });
const output = (result.stdout ?? '') + (result.stderr ?? '');
writeFileSync('reports/core-tests.tap', output);
const count = (name) => Number(output.match(new RegExp(`^# ${name} (\\d+)`, 'm'))?.[1] ?? 0);
let commit = 'uncommitted';
const git = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
if (!git.status) commit = git.stdout.trim();
const report = {
  runtime: process.version,
  command: 'node scripts/run-core-tests.mjs',
  commit,
  workingTreeDirty: spawnSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).stdout?.trim() !== '',
  tests: count('tests'),
  passed: count('pass'),
  failed: count('fail'),
  skipped: count('skipped'),
  exitCode: result.status,
  environment: 'Node; not Cloudflare Workers runtime',
  testedAt: new Date().toISOString(),
};
writeFileSync('reports/core-tests.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (result.status) console.error(output);
process.exit(result.status ?? 1);
