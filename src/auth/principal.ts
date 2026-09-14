import { GatewayError, requireThat } from '../shared/errors.ts';
export const SCOPES = ['jules:read', 'jules:control'] as const;
export type Scope = (typeof SCOPES)[number];
export type Principal = {
  clientId: string;
  credentialId: string;
  authMethod: 'oauth' | 'service-token';
  scopes: Scope[];
};
export function parseScopes(value: unknown): Scope[] {
  requireThat(Array.isArray(value) && value.length > 0 && value.length <= 2, 'CONFIGURATION_ERROR', 503);
  requireThat(
    value.every((v) => SCOPES.includes(v as Scope)) && new Set(value).size === value.length,
    'CONFIGURATION_ERROR',
    503,
  );
  return [...value] as Scope[];
}
export function assertPrincipal(value: unknown): Principal {
  requireThat(value && typeof value === 'object', 'UNAUTHENTICATED', 401);
  const p = value as Principal;
  requireThat(
    typeof p.clientId === 'string' && p.clientId.length > 0 && p.clientId.length <= 128,
    'UNAUTHENTICATED',
    401,
  );
  requireThat(
    typeof p.credentialId === 'string' && p.credentialId.length > 0 && p.credentialId.length <= 128,
    'UNAUTHENTICATED',
    401,
  );
  requireThat(p.authMethod === 'oauth' || p.authMethod === 'service-token', 'UNAUTHENTICATED', 401);
  return {
    clientId: p.clientId,
    credentialId: p.credentialId,
    authMethod: p.authMethod,
    scopes: parseScopes(p.scopes),
  };
}
export function requireScope(principal: Principal, scope: Scope): void {
  if (!principal.scopes.includes(scope)) throw new GatewayError('FORBIDDEN', 403);
}
