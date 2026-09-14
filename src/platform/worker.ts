import { assertPrincipal } from '../auth/principal.ts';
import { oauthProvider } from '../auth/oauth.ts';
import { JulesClient } from '../jules/client.ts';
import { RequestBudget, readLimited, DEFAULT_LIMITS } from '../shared/limits.ts';
import { GatewayError, requireThat, safeError } from '../shared/errors.ts';
import { sha256 } from '../shared/crypto.ts';
import { parseConfig, allowedOrigin, type SecurityConfig } from './config.ts';
import { budgetKv, rateLimit, type Env } from './cloudflare.ts';
import type { ToolContext } from '../mcp/execute.ts';
export type McpAdapter = (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  tools: ToolContext,
  config: SecurityConfig,
) => Promise<Response>;
function secured(response: Response, requestId: string, origin?: string): Response {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Request-Id', requestId);
  headers.set('Referrer-Policy', 'no-referrer');
  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Vary', 'Origin');
    headers.set(
      'Access-Control-Allow-Headers',
      'Authorization, Content-Type, Accept, MCP-Protocol-Version, Mcp-Method, Mcp-Name, mcp-session-id',
    );
    headers.set('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS');
    headers.set(
      'Access-Control-Expose-Headers',
      'WWW-Authenticate, MCP-Protocol-Version, mcp-session-id, X-Request-Id',
    );
  }
  return new Response(response.body, { status: response.status, headers });
}
export function createWorker(serve: McpAdapter) {
  return {
    async fetch(original: Request, rawEnv: Env, ctx: ExecutionContext): Promise<Response> {
      const id = crypto.randomUUID();
      let budget: RequestBudget | undefined;
      let responseOrigin: string | undefined;
      try {
        // Health is intentionally non-identifying and independent of secrets; it is not readiness.
        if (new URL(original.url).pathname === '/healthz' && original.method === 'GET')
          return secured(Response.json({ status: 'alive', readiness: 'not asserted' }), id);
        const config = parseConfig(rawEnv as unknown as Record<string, unknown>);
        requireThat(!config.disabled, 'GATEWAY_DISABLED', 503);
        requireThat(new URL(original.url).origin === config.origin, 'FORBIDDEN', 403);
        requireThat(allowedOrigin(original, config), 'FORBIDDEN', 403);
        responseOrigin = original.headers.get('origin') ?? undefined;
        requireThat(
          rawEnv.OAUTH_KV && rawEnv.AUTH_LIMITER && rawEnv.READ_LIMITER && rawEnv.CONTROL_LIMITER,
          'CONFIGURATION_ERROR',
          503,
        );
        budget = new RequestBudget(config.limits);
        const b = budget;
        // Fixed, hashed transport/IP key; labels supplied by callers never establish a principal.
        b.take();
        const key = await sha256(original.headers.get('cf-connecting-ip') ?? 'unknown-transport');
        requireThat((await b.run(rawEnv.AUTH_LIMITER.limit({ key }))).success, 'GATEWAY_RATE_LIMITED', 429);
        if (original.method === 'OPTIONS')
          return secured(new Response(null, { status: 204 }), id, responseOrigin);
        requireThat(original.url.length <= 8192, 'REQUEST_TOO_LARGE', 413);
        requireThat((original.headers.get('authorization') ?? '').length <= 2048, 'REQUEST_TOO_LARGE', 413);
        let request = original;
        if (original.body) {
          const body = await readLimited(original, config.limits.requestBytes, b, 'REQUEST_TOO_LARGE');
          request = new Request(original.url, {
            method: original.method,
            headers: original.headers,
            body,
            signal: b.signal,
            redirect: 'manual',
          });
        }
        const env: Env = { ...rawEnv, OAUTH_KV: budgetKv(rawEnv.OAUTH_KV, b) };
        const provider = oauthProvider(config, b, {
          async fetch(req, authedEnv, authedCtx) {
            requireThat(new URL(req.url).pathname === '/mcp', 'RESOURCE_NOT_FOUND', 404);
            const principal = assertPrincipal(authedCtx.props);
            return serve(
              req,
              authedEnv,
              authedCtx,
              {
                principal,
                jules: new JulesClient(authedEnv.JULES_API_KEY ?? '', b),
                requestId: id,
                rateLimit: (control, p) => rateLimit(authedEnv, control, p, b),
              },
              config,
            );
          },
        });
        const response = await b.run(provider.fetch(request, env, ctx));
        // A bounded one-request response may be JSON or SSE; preserve its content type/protocol.
        // Persistent subscriptions/background event streams are deliberately not implemented.
        const body = response.body
          ? await readLimited(response, config.limits.transportBytes, b, 'OUTPUT_TOO_LARGE')
          : null;
        const result = secured(
          new Response(body, { status: response.status, headers: response.headers }),
          id,
          responseOrigin,
        );
        // no-referrer makes browser form POSTs send Origin: null. The consent page needs
        // its exact origin, but must never disclose its OAuth query in a Referer header.
        if (
          request.method === 'GET' &&
          new URL(request.url).pathname === '/authorize' &&
          response.status === 200
        )
          result.headers.set('Referrer-Policy', 'strict-origin');
        return result;
      } catch (error) {
        let e = safeError(error);
        // Only an outer failure AFTER dispatch makes the outcome unknowable to this caller.
        if (budget?.mutationDispatched) e = new GatewayError('UPSTREAM_OUTCOME_UNKNOWN', 502);
        const headers: Record<string, string> = {};
        if (e.code === 'GATEWAY_RATE_LIMITED') headers['Retry-After'] = '60';
        return secured(
          Response.json({ error: { code: e.code, message: e.message } }, { status: e.status, headers }),
          id,
          responseOrigin,
        );
      } finally {
        budget?.close();
      }
    },
  };
}
export const TRANSPORT_RESPONSE_CEILING = DEFAULT_LIMITS.transportBytes;
