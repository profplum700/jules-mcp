#!/usr/bin/env node
/** Uses the official legacy SDK client to prove Streamable HTTP backward compatibility. No writes. */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
const endpoint = new URL(process.env.GATEWAY_MCP_URL ?? '');
if (
  endpoint.protocol !== 'https:' ||
  endpoint.pathname !== '/mcp' ||
  endpoint.search ||
  endpoint.hash ||
  endpoint.username ||
  endpoint.password
)
  throw new Error('Set canonical HTTPS GATEWAY_MCP_URL ending /mcp.');
const token = (await readFile(process.env.GATEWAY_TOKEN_FILE ?? '.private/smoke.token', 'utf8')).trim();
const client = new Client({ name: 'jules-mcp-readonly-smoke', version: '0.1.0' });
const started = Date.now();
try {
  await client.connect(
    new StreamableHTTPClientTransport(endpoint, {
      requestInit: {
        headers: { Authorization: `Bearer ${token}` },
        redirect: 'error',
        signal: AbortSignal.timeout(20000),
      },
    }),
  );
  const tools = await client.listTools();
  const name = tools.tools.some((t) => t.name === 'jules_gateway_info')
    ? 'jules_gateway_info'
    : 'jules_feasibility_read';
  const info = await client.callTool({ name, arguments: {} });
  if (info.isError) throw new Error('Authenticated read tool failed.');
  await mkdir('reports', { recursive: true });
  await writeFile(
    'reports/live-readonly-smoke.json',
    JSON.stringify(
      {
        client: 'official MCP TypeScript SDK legacy client',
        authMethod: 'bearer',
        toolCount: tools.tools.length,
        readTool: name,
        successful: true,
        elapsedMs: Date.now() - started,
        testedAt: new Date().toISOString(),
        mutations: 0,
        endpointOmitted: true,
      },
      null,
      2,
    ) + '\n',
  );
  console.log('Read-only MCP connection passed. No Jules task or PR was created; sanitized report written.');
} finally {
  await client.close();
}
