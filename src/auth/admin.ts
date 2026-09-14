import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import { equalDigest, sha256 } from '../shared/crypto.ts';
import { GatewayError, requireThat } from '../shared/errors.ts';
import { readLimited, type RequestBudget } from '../shared/limits.ts';
import type { SecurityConfig } from '../platform/config.ts';
export async function oauthAdmin(
  request: Request,
  api: OAuthHelpers,
  config: SecurityConfig,
  budget: RequestBudget,
) {
  // This separate bootstrap credential is not an MCP credential. Browser-originated calls are forbidden.
  requireThat(
    request.method === 'POST' &&
      !request.headers.has('origin') &&
      request.headers.get('content-type')?.startsWith('application/json'),
    'FORBIDDEN',
    403,
  );
  const value = request.headers.get('authorization') ?? '';
  requireThat(
    /^Bearer jma_[A-Za-z0-9_-]{43}$/.test(value) &&
      equalDigest(await sha256(value.slice(7)), config.adminHash),
    'UNAUTHENTICATED',
    401,
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readLimited(request, 4096, budget, 'REQUEST_TOO_LARGE'));
  } catch (error) {
    if (error instanceof GatewayError) throw error;
    throw new GatewayError('INVALID_ARGUMENT');
  }
  requireThat(parsed && typeof parsed === 'object' && !Array.isArray(parsed), 'INVALID_ARGUMENT');
  const data = parsed as Record<string, unknown>;
  const id = (value: unknown) => {
    requireThat(typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value), 'INVALID_ARGUMENT');
    return value;
  };
  let result: unknown;
  if (data.action === 'create-client') {
    requireThat(
      typeof data.name === 'string' &&
        data.name.length > 0 &&
        data.name.length <= 80 &&
        typeof data.redirectUri === 'string',
      'INVALID_ARGUMENT',
    );
    let redirect: URL;
    try {
      redirect = new URL(data.redirectUri);
    } catch {
      throw new GatewayError('INVALID_ARGUMENT');
    }
    requireThat(
      redirect.protocol === 'https:' &&
        !redirect.username &&
        !redirect.password &&
        !redirect.hash &&
        data.redirectUri.length <= 2048,
      'INVALID_ARGUMENT',
    );
    requireThat(
      data.tokenEndpointAuthMethod === 'client_secret_post' ||
        data.tokenEndpointAuthMethod === 'client_secret_basic' ||
        data.tokenEndpointAuthMethod === 'none',
      'INVALID_ARGUMENT',
    );
    result = await api.createClient({
      clientName: data.name,
      redirectUris: [data.redirectUri],
      grantTypes: ['authorization_code', 'refresh_token'],
      responseTypes: ['code'],
      tokenEndpointAuthMethod: data.tokenEndpointAuthMethod,
    });
  } else if (data.action === 'list-grants') {
    requireThat(
      data.cursor === undefined || (typeof data.cursor === 'string' && data.cursor.length <= 2048),
      'INVALID_ARGUMENT',
    );
    result = await api.listUserGrants(config.ownerId, {
      limit: 10,
      cursor: data.cursor as string | undefined,
    });
  } else if (data.action === 'revoke-grant') {
    await api.revokeGrant(id(data.grantId), config.ownerId);
    result = { revoked: true, propagation: 'eventually consistent; verify separately' };
  } else if (data.action === 'delete-client') {
    await api.deleteClient(id(data.clientId));
    result = { deleted: true, propagation: 'eventually consistent; verify separately' };
  } else requireThat(false, 'INVALID_ARGUMENT');
  return Response.json(result, {
    headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
  });
}
