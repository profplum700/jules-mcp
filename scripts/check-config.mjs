#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { parseConfig } from '../src/platform/config.ts';
try {
  const input = process.argv[2] ? JSON.parse(await readFile(process.argv[2], 'utf8')) : process.env;
  parseConfig(input);
  console.log('Security configuration valid. Values intentionally not displayed.');
} catch {
  console.error(
    'Invalid security configuration. See docs/authentication.md for required fields; no input values were logged.',
  );
  process.exit(1);
}
