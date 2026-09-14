import { equalDigest, sha256 } from '../shared/crypto.ts';
import { GatewayError, requireThat } from '../shared/errors.ts';
import { parseScopes, type Principal, type Scope } from './principal.ts';
export interface ServiceCredential {
  id: string;
  clientId: string;
  sha256: string;
  scopes: Scope[];
  expiresAt?: string;
  revoked?: boolean;
}
export function parseCredentials(json: string): ServiceCredential[] {
  try {
    requireThat(new TextEncoder().encode(json).length <= 4_096, 'CONFIGURATION_ERROR', 503);
    const rows: unknown = JSON.parse(json);
    requireThat(Array.isArray(rows) && rows.length <= 12, 'CONFIGURATION_ERROR', 503);
    const seen = new Set<string>();
    return rows.map((row) => {
      requireThat(row && typeof row === 'object', 'CONFIGURATION_ERROR', 503);
      const item = row as ServiceCredential;
      requireThat(/^[A-Za-z0-9_-]{1,32}$/.test(item.id) && !seen.has(item.id), 'CONFIGURATION_ERROR', 503);
      requireThat(/^[A-Za-z0-9_-]{1,64}$/.test(item.clientId), 'CONFIGURATION_ERROR', 503);
      requireThat(/^[a-f0-9]{64}$/.test(item.sha256), 'CONFIGURATION_ERROR', 503);
      requireThat(
        item.revoked === undefined || typeof item.revoked === 'boolean',
        'CONFIGURATION_ERROR',
        503,
      );
      requireThat(
        item.expiresAt === undefined ||
          (typeof item.expiresAt === 'string' &&
            /^\d{4}-\d{2}-\d{2}T/.test(item.expiresAt) &&
            Number.isFinite(Date.parse(item.expiresAt))),
        'CONFIGURATION_ERROR',
        503,
      );
      seen.add(item.id);
      return { ...item, scopes: parseScopes(item.scopes) };
    });
  } catch {
    throw new GatewayError('CONFIGURATION_ERROR', 503);
  }
}
export async function verifyServiceToken(
  token: string,
  credentials: ServiceCredential[],
  now = Date.now(),
): Promise<Principal | null> {
  const match = /^jmg_([A-Za-z0-9_-]{1,32})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!match) return null;
  const entry = credentials.find((c) => c.id === match[1]);
  // Always hash a syntactically valid token, even for unknown key IDs.
  const digest = await sha256(token);
  if (
    !equalDigest(digest, entry?.sha256 ?? '0'.repeat(64)) ||
    !entry ||
    entry.revoked ||
    (entry.expiresAt && Date.parse(entry.expiresAt) <= now)
  )
    return null;
  return {
    clientId: entry.clientId,
    credentialId: entry.id,
    authMethod: 'service-token',
    scopes: [...entry.scopes],
  };
}
