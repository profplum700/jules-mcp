#!/usr/bin/env node
/** Small dependency-free policy linter; formatting belongs only to Prettier. */
import { readdir, readFile } from 'node:fs/promises';
const errors = [];
async function walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const path = `${dir}/${e.name}`;
    if (e.isDirectory()) await walk(path);
    else if (path.endsWith('.ts')) {
      const text = await readFile(path, 'utf8');
      if (/\beval\s*\(|new\s+Function\s*\(/.test(text)) errors.push(`${path}: dynamic execution forbidden`);
      if (/console\.(log|error|warn|info)\(/.test(text) && !path.endsWith('/safe-log.ts'))
        errors.push(`${path}: use safe-log only`);
      if (/https:\/\/jules\.googleapis\.com|['"]v1alpha['"]/.test(text) && !path.endsWith('/jules/client.ts'))
        errors.push(`${path}: API version/origin must remain isolated`);
      if (path.includes('/jules/') && /cloudflare|KVNamespace|DurableObject/.test(text))
        errors.push(`${path}: Jules layer must be portable`);
    }
  }
}
await walk('src');
const production = await readFile('src/index.ts', 'utf8');
if (/feasibility|diagnostic/.test(production))
  errors.push('Production entrypoint references diagnostic code.');
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('Security/architecture policy lint passed.');
