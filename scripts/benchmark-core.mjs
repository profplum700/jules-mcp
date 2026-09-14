#!/usr/bin/env node
/** Local regression signal only; these numbers are NOT Cloudflare CPU qualification. */
import { performance } from 'node:perf_hooks';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomSecret, sha256 } from '../src/shared/crypto.ts';
import { verifyServiceToken } from '../src/auth/service-tokens.ts';
import { executeTool } from '../src/mcp/execute.ts';
import { JulesClient } from '../src/jules/client.ts';
import { RequestBudget } from '../src/shared/limits.ts';
const token = `jmg_benchmark.${randomSecret()}`;
const rows = [
  {
    id: 'benchmark',
    clientId: 'benchmark',
    sha256: await sha256(token),
    scopes: ['jules:read', 'jules:control'],
  },
];
const timings = [];
for (let i = 0; i < 100; i++) {
  const start = performance.now();
  const principal = await verifyServiceToken(token, rows);
  const budget = new RequestBudget();
  try {
    await executeTool(
      'jules_gateway_info',
      {},
      { principal, jules: new JulesClient('', budget), requestId: crypto.randomUUID(), log: () => {} },
    );
    timings.push(performance.now() - start);
  } finally {
    budget.close();
  }
}
const sorted = [...timings].sort((a, b) => a - b);
const report = {
  environment: `Node ${process.version}`,
  operation: 'service verifier + dependency-free gateway-info executor',
  samples: timings.length,
  firstMs: timings[0],
  medianMs: sorted[50],
  p95Ms: sorted[95],
  units: 'local wall-clock milliseconds, not Worker CPU',
  sdkAndOAuthProviderIncluded: false,
  freeTierQualified: false,
};
await mkdir('reports', { recursive: true });
await writeFile('reports/core-benchmark.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
