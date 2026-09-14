#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { TOOLS, toolSchema } from '../src/mcp/catalog.ts';
const schema = TOOLS.map((t) => ({
  name: t.name,
  inputSchema: toolSchema(t),
  annotations: {
    readOnlyHint: !t.control,
    destructiveHint: t.destructive ?? false,
    idempotentHint: t.idempotent ?? !t.control,
    openWorldHint: t.name !== 'jules_gateway_info',
  },
}));
const text = JSON.stringify(schema, null, 2) + '\n';
const path = 'tests/fixtures/tool-schemas.json';
if (process.argv.includes('--write')) {
  await writeFile(path, text);
  console.log('Updated schema baseline; refresh configured clients after schema changes.');
} else {
  if ((await readFile(path, 'utf8')) !== text)
    throw new Error('Schema drift: review changes, then run pnpm schema:update.');
  console.log(`Schema baseline matches ${schema.length} tools.`);
}
