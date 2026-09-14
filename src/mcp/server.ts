import { McpServer } from '@modelcontextprotocol/server';
import { createMcpHandler } from 'agents/mcp/server';
import { z } from 'zod';
import { TOOLS, type Field } from './catalog.ts';
import { executeTool, VERSION, type ToolContext } from './execute.ts';
import type { SecurityConfig } from '../platform/config.ts';
import type { Env } from '../platform/cloudflare.ts';
function fieldSchema(field: Field): z.ZodType {
  let schema: z.ZodType;
  if (field.enum) schema = z.enum(field.enum as [string, ...string[]]);
  else if (field.type === 'boolean') schema = z.boolean();
  else if (field.type === 'integer')
    schema = z
      .number()
      .int()
      .min(field.min ?? 0)
      .max(field.max ?? Number.MAX_SAFE_INTEGER);
  else
    schema = z
      .string()
      .min(field.min ?? 0)
      .max(field.max ?? 100000);
  schema = schema.describe(field.description);
  return field.required ? schema : schema.optional();
}
export function createServer(context: ToolContext) {
  const server = new McpServer({ name: 'jules-mcp', version: VERSION });
  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: z.strictObject(
          Object.fromEntries(Object.entries(tool.fields).map(([key, field]) => [key, fieldSchema(field)])),
        ),
        annotations: {
          readOnlyHint: !tool.control,
          destructiveHint: tool.destructive ?? false,
          idempotentHint: tool.idempotent ?? !tool.control,
          openWorldHint: tool.name !== 'jules_gateway_info',
        },
      },
      async (input) => executeTool(tool.name, input, context),
    );
  }
  return server;
}
export async function serveMcp(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  context: ToolContext,
  config: SecurityConfig,
) {
  // Per-request factory closure; a principal is never placed in module globals or a shared server.
  const handler = createMcpHandler(() => createServer(context), {
    route: '/mcp',
    corsOptions: false,
    allowedHostnames: [new URL(config.origin).hostname],
    allowedOriginHostnames: '*', // Exact full Origin check already enforced by the outer trusted middleware.
    onerror: () => {}, // Do not print upstream/library exceptions with request data.
  });
  return handler(request, env, ctx);
}
