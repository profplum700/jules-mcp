/** Separate Stage-0 entrypoint: NEVER imported by the production entrypoint. No Jules key required. */
import { McpServer } from '@modelcontextprotocol/server';
import { createMcpHandler } from 'agents/mcp/server';
import { z } from 'zod';
import { createWorker } from './platform/worker.ts';
import { requireScope } from './auth/principal.ts';
import { requireThat } from './shared/errors.ts';
import { randomSecret } from './shared/crypto.ts';
export default createWorker(async (request, env, ctx, context, config) => {
  const handler = createMcpHandler(
    () => {
      const server = new McpServer({ name: 'jules-mcp-feasibility-only', version: '0.1.0' });
      server.registerTool(
        'jules_feasibility_read',
        {
          description:
            'Stage-0 diagnostic: read verified identity and, optionally, an ephemeral nonce. Never calls Jules.',
          inputSchema: z.strictObject({
            nonce: z
              .string()
              .regex(/^[A-Za-z0-9_-]{43}$/)
              .optional(),
          }),
          annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
          },
        },
        async ({ nonce }) => {
          requireScope(context.principal, 'jules:read');
          requireThat(await context.rateLimit?.(false, context.principal), 'GATEWAY_RATE_LIMITED', 429);
          const stored = nonce
            ? await env.OAUTH_KV.get(`diagnostic:${context.principal.credentialId}:${nonce}`)
            : null;
          return {
            content: [{ type: 'text', text: 'Authenticated Stage-0 read succeeded.' }],
            structuredContent: {
              principal: context.principal,
              nonceFound: stored !== null,
              productionGateway: false,
            },
          };
        },
      );
      server.registerTool(
        'jules_feasibility_write',
        {
          description:
            'Stage-0 benign write: stores only a random diagnostic nonce in authentication KV for 120 seconds. No repository, Jules task, or source code is touched.',
          inputSchema: z.strictObject({}),
          annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: false,
          },
        },
        async () => {
          requireScope(context.principal, 'jules:control');
          requireThat(await context.rateLimit?.(true, context.principal), 'GATEWAY_RATE_LIMITED', 429);
          const nonce = randomSecret();
          await env.OAUTH_KV.put(`diagnostic:${context.principal.credentialId}:${nonce}`, 'ok', {
            expirationTtl: 120,
          });
          return {
            content: [
              { type: 'text', text: 'Benign diagnostic write succeeded; use the read tool with this nonce.' },
            ],
            structuredContent: { nonce, expiresInSeconds: 120 },
          };
        },
      );
      return server;
    },
    {
      corsOptions: false,
      allowedHostnames: [new URL(config.origin).hostname],
      allowedOriginHostnames: '*',
      onerror: () => {},
    },
  );
  return handler(request, env, ctx);
});
