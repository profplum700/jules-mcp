import { parseCredentials, type ServiceCredential } from '../auth/service-tokens.ts';
import { DEFAULT_LIMITS, type Limits } from '../shared/limits.ts';
import { GatewayError, requireThat } from '../shared/errors.ts';
export interface SecurityConfig {
  origin: string;
  ownerId: string;
  githubClientId: string;
  githubClientSecret: string;
  serviceCredentials: ServiceCredential[];
  adminHash: string;
  allowedOrigins: string[];
  limits: Limits;
  disabled: boolean;
}
export function parseConfig(env: Record<string, unknown>): SecurityConfig {
  let url: URL;
  try {
    url = new URL(String(env.PUBLIC_ORIGIN ?? ''));
  } catch {
    throw new GatewayError('CONFIGURATION_ERROR', 503);
  }
  requireThat(
    url.protocol === 'https:' &&
      url.origin === env.PUBLIC_ORIGIN &&
      !url.username &&
      !url.password &&
      !url.port,
    'CONFIGURATION_ERROR',
    503,
  );
  requireThat(
    typeof env.OWNER_GITHUB_ID === 'string' && /^[1-9][0-9]{0,19}$/.test(env.OWNER_GITHUB_ID),
    'CONFIGURATION_ERROR',
    503,
  );
  for (const key of ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET'])
    requireThat(
      typeof env[key] === 'string' && /^[^\s]{8,256}$/.test(env[key] as string),
      'CONFIGURATION_ERROR',
      503,
    );
  requireThat(
    typeof env.ADMIN_TOKEN_SHA256 === 'string' && /^[a-f0-9]{64}$/.test(env.ADMIN_TOKEN_SHA256),
    'CONFIGURATION_ERROR',
    503,
  );
  requireThat(
    env.GATEWAY_DISABLED === 'true' || env.GATEWAY_DISABLED === 'false',
    'CONFIGURATION_ERROR',
    503,
  );
  requireThat(typeof env.SERVICE_TOKENS_JSON === 'string', 'CONFIGURATION_ERROR', 503);
  let origins: unknown;
  try {
    origins = JSON.parse(String(env.ALLOWED_ORIGINS_JSON ?? '[]'));
  } catch {
    origins = null;
  }
  requireThat(
    Array.isArray(origins) &&
      origins.length <= 10 &&
      origins.every(
        (value) =>
          typeof value === 'string' &&
          /^https:\/\//.test(value) &&
          (() => {
            try {
              return new URL(value).origin === value;
            } catch {
              return false;
            }
          })(),
      ),
    'CONFIGURATION_ERROR',
    503,
  );
  const limits: Limits = { ...DEFAULT_LIMITS };
  // Defaults are ceilings too: deployment tuning may make them smaller, not silently expand the Free envelope.
  if (env.LIMITS_JSON !== undefined) {
    let supplied: Record<string, unknown>;
    try {
      supplied = JSON.parse(String(env.LIMITS_JSON));
    } catch {
      throw new GatewayError('CONFIGURATION_ERROR', 503);
    }
    requireThat(
      supplied && typeof supplied === 'object' && !Array.isArray(supplied),
      'CONFIGURATION_ERROR',
      503,
    );
    for (const [key, value] of Object.entries(supplied)) {
      requireThat(
        Object.hasOwn(DEFAULT_LIMITS, key) &&
          Number.isSafeInteger(value) &&
          Number(value) > 0 &&
          Number(value) <= DEFAULT_LIMITS[key as keyof Limits],
        'CONFIGURATION_ERROR',
        503,
      );
      limits[key as keyof Limits] = Number(value);
    }
  }
  return {
    origin: url.origin,
    ownerId: env.OWNER_GITHUB_ID as string,
    githubClientId: env.GITHUB_CLIENT_ID as string,
    githubClientSecret: env.GITHUB_CLIENT_SECRET as string,
    serviceCredentials: parseCredentials(env.SERVICE_TOKENS_JSON as string),
    adminHash: env.ADMIN_TOKEN_SHA256 as string,
    allowedOrigins: [url.origin, ...(origins as string[])],
    limits,
    disabled: env.GATEWAY_DISABLED === 'true',
  };
}
export function allowedOrigin(request: Request, config: SecurityConfig): boolean {
  const origin = request.headers.get('origin');
  return origin === null || config.allowedOrigins.includes(origin);
}
