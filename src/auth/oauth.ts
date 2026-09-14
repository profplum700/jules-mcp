import { AuthorizationError, OAuthProvider } from '@cloudflare/workers-oauth-provider';
import { assertPrincipal, parseScopes, SCOPES } from './principal.ts';
import { verifyServiceToken } from './service-tokens.ts';
import { ownerLogin } from './owner-login.ts';
import { oauthAdmin } from './admin.ts';
import { GatewayError, requireThat } from '../shared/errors.ts';
import type { Env } from '../platform/cloudflare.ts';
import type { SecurityConfig } from '../platform/config.ts';
import type { RequestBudget } from '../shared/limits.ts';
export function oauthProvider(
  config: SecurityConfig,
  budget: RequestBudget,
  apiHandler: { fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> },
) {
  return new OAuthProvider<Env>({
    apiRoute: '/mcp',
    apiHandler,
    authorizeEndpoint: '/authorize',
    tokenEndpoint: '/oauth/token',
    // Intentionally no DCR endpoint, CIMD, token exchange, implicit or plain PKCE.
    clientIdMetadataDocumentEnabled: false,
    allowImplicitFlow: false,
    allowPlainPKCE: false,
    allowTokenExchangeGrant: false,
    accessTokenTTL: 900,
    refreshTokenTTL: 2592000,
    scopesSupported: [...SCOPES],
    resourceMetadata: {
      resource: `${config.origin}/mcp`,
      authorization_servers: [config.origin],
      scopes_supported: [...SCOPES],
      bearer_methods_supported: ['header'],
      resource_name: 'Jules MCP Gateway',
    },
    defaultHandler: {
      async fetch(request, env) {
        if (new URL(request.url).pathname === '/admin')
          return oauthAdmin(request, env.OAUTH_PROVIDER, config, budget);
        try {
          return await ownerLogin(request, { config, api: env.OAUTH_PROVIDER, store: env.OAUTH_KV, budget });
        } catch (error) {
          // Provider validation errors are caller errors. Never reflect their details or redirect URI.
          if (
            error instanceof AuthorizationError &&
            error.code !== 'server_error' &&
            error.code !== 'temporarily_unavailable'
          )
            throw new GatewayError('OAUTH_INVALID_REQUEST', 400);
          throw error;
        }
      },
    },
    async resolveExternalToken({ token }) {
      const principal = await verifyServiceToken(token, config.serviceCredentials);
      return principal ? { props: principal, audience: `${config.origin}/mcp` } : null;
    },
    // The provider validates token resource against the authorization grant.
    // This callback exposes scopes/identity, not the token request resource.
    tokenExchangeCallback(options) {
      requireThat(options.userId === config.ownerId, 'FORBIDDEN', 403);
      const principal = assertPrincipal(options.props);
      requireThat(
        principal.authMethod === 'oauth' && principal.clientId === options.clientId,
        'FORBIDDEN',
        403,
      );
      const scopes = parseScopes(options.requestedScope);
      requireThat(
        scopes.every((scope) => principal.scopes.includes(scope)),
        'FORBIDDEN',
        403,
      );
      // Access-token downscoping must affect the verified principal, not merely OAuth's wire response.
      return { accessTokenProps: { ...principal, credentialId: options.grantId, scopes } };
    },
    onError: ({ code, status, headers }) =>
      Response.json(
        {
          error: code,
          error_description:
            'OAuth request rejected. Check the registered client, PKCE, redirect URI, audience and credential.',
        },
        { status, headers: { ...headers, 'Cache-Control': 'no-store' } },
      ),
  });
}
