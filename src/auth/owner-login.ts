import { equalDigest, pkceChallenge, randomSecret, sha256 } from '../shared/crypto.ts';
import { requireThat, GatewayError } from '../shared/errors.ts';
import { readLimited, type RequestBudget } from '../shared/limits.ts';
import { parseScopes, SCOPES } from './principal.ts';
import type { SecurityConfig } from '../platform/config.ts';
/** Structural interfaces keep owner identity glue independently testable; the adapter supplies OAuthHelpers. */
export interface ParsedAuth {
  clientId: string;
  redirectUri: string;
  responseType: string;
  scope: string[];
  state: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  resource?: string | string[];
  issuer?: string;
}
export interface LoginOAuthApi {
  parseAuthRequest(request: Request): Promise<ParsedAuth>;
  lookupClient(id: string): Promise<{ clientName?: string; redirectUris: string[] } | null>;
  completeAuthorization(options: {
    request: ParsedAuth;
    userId: string;
    metadata: unknown;
    scope: string[];
    props: unknown;
    revokeExistingGrants: boolean;
  }): Promise<{ redirectTo: string }>;
}
export interface AuthStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options: { expirationTtl: number }): Promise<void>;
  delete(key: string): Promise<void>;
}
interface Transaction {
  phase: 'consent' | 'github';
  authUrl: string;
  cookieHash: string;
  expiresAt: number;
  verifier?: string;
}
export interface LoginContext {
  config: SecurityConfig;
  api: LoginOAuthApi;
  store: AuthStore;
  budget: RequestBudget;
  fetcher?: (request: Request) => Promise<Response>;
}
const COOKIE = '__Host-jules_login';
export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}
function cookie(value: string, maxAge = 600) {
  return `${COOKIE}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}
function cookieValue(request: Request): string {
  const cookies = (request.headers.get('cookie') ?? '')
    .split(';')
    .map((v) => v.trim())
    .filter((v) => v.startsWith(`${COOKIE}=`));
  requireThat(cookies.length === 1, 'OAUTH_INVALID_REQUEST');
  const value = cookies[0].slice(COOKIE.length + 1);
  requireThat(/^[A-Za-z0-9_-]{43}$/.test(value), 'OAUTH_INVALID_REQUEST');
  return value;
}
function secureHeaders(extra: Record<string, string> = {}, registeredRedirectOrigin?: string) {
  return {
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; form-action 'self'${registeredRedirectOrigin ? ` https://github.com ${registeredRedirectOrigin}` : ''}; base-uri 'none'; frame-ancestors 'none'`,
    'X-Content-Type-Options': 'nosniff',
    ...extra,
  };
}
function redirect(url: string, cookieHeader?: string) {
  return new Response(null, {
    status: 302,
    headers: secureHeaders({ Location: url, ...(cookieHeader ? { 'Set-Cookie': cookieHeader } : {}) }),
  });
}
async function checkedAuth(url: string, ctx: LoginContext) {
  const auth = await ctx.api.parseAuthRequest(new Request(url));
  requireThat(
    auth.responseType === 'code' &&
      auth.codeChallengeMethod === 'S256' &&
      /^[A-Za-z0-9_-]{43}$/.test(auth.codeChallenge ?? ''),
    'OAUTH_INVALID_REQUEST',
  );
  requireThat(auth.resource === `${ctx.config.origin}/mcp`, 'OAUTH_INVALID_REQUEST');
  const client = await ctx.api.lookupClient(auth.clientId);
  requireThat(client && client.redirectUris.includes(auth.redirectUri), 'OAUTH_INVALID_REQUEST');
  const scopes = auth.scope.length ? parseScopes(auth.scope) : [...SCOPES];
  requireThat(scopes.includes('jules:read'), 'OAUTH_INVALID_REQUEST');
  return { auth, client, scopes };
}
async function loadTransaction(request: Request, id: string, phase: Transaction['phase'], ctx: LoginContext) {
  requireThat(/^[A-Za-z0-9_-]{43}$/.test(id), 'OAUTH_INVALID_REQUEST');
  const raw = await ctx.store.get(`login:${id}`);
  requireThat(raw, 'OAUTH_INVALID_REQUEST');
  let transaction: Transaction;
  try {
    transaction = JSON.parse(raw);
  } catch {
    throw new GatewayError('OAUTH_INVALID_REQUEST');
  }
  requireThat(transaction.phase === phase && transaction.expiresAt > Date.now(), 'OAUTH_INVALID_REQUEST');
  requireThat(
    equalDigest(transaction.cookieHash, await sha256(cookieValue(request))),
    'OAUTH_INVALID_REQUEST',
  );
  return transaction;
}
async function githubJson(url: string, init: RequestInit, ctx: LoginContext) {
  ctx.budget.take();
  const response = await ctx.budget.run(
    (ctx.fetcher ?? fetch)(new Request(url, { ...init, redirect: 'manual', signal: ctx.budget.signal })),
  );
  requireThat(response.ok, 'OAUTH_INVALID_REQUEST');
  const text = await readLimited(response, 32768, ctx.budget);
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text);
  } catch {
    throw new GatewayError('OAUTH_INVALID_REQUEST');
  }
  return json;
}
export async function ownerLogin(request: Request, ctx: LoginContext): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === '/authorize' && request.method === 'GET') {
    requireThat(request.url.length <= 8192, 'OAUTH_INVALID_REQUEST');
    const { auth, client, scopes } = await checkedAuth(request.url, ctx);
    // checkedAuth accepted this exact owner-registered redirect. Never serialize raw
    // query input into CSP: the browser also checks the returning-user redirect chain.
    const registeredRedirect = new URL(auth.redirectUri);
    requireThat(
      registeredRedirect.protocol === 'https:' &&
        !registeredRedirect.username &&
        !registeredRedirect.password &&
        !registeredRedirect.hash &&
        registeredRedirect.hostname
          .split('.')
          .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)),
      'OAUTH_INVALID_REQUEST',
    );
    const id = randomSecret();
    const secret = randomSecret();
    await ctx.store.put(
      `login:${id}`,
      JSON.stringify({
        phase: 'consent',
        authUrl: request.url,
        cookieHash: await sha256(secret),
        expiresAt: Date.now() + 600000,
      }),
      { expirationTtl: 600 },
    );
    const body = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Connect to Jules</title><body><main><h1>Connect to Jules</h1><p><strong>${escapeHtml(client.clientName ?? 'Registered client')}</strong> requests ${escapeHtml(scopes.join(', '))}.</p><p>This grants access to all repositories and sessions in your Jules account. Control access includes creating tasks, messaging, approving plans and deleting sessions. Your client may also ask for action confirmations.</p><form method="post" action="/consent"><input type="hidden" name="transaction" value="${id}"><button name="decision" value="allow">Continue with GitHub</button><button name="decision" value="deny">Deny</button></form></main></body></html>`;
    return new Response(body, {
      // Browsers apply form-action to the POST's redirect chain as well as /consent.
      headers: secureHeaders(
        { 'Content-Type': 'text/html; charset=utf-8', 'Set-Cookie': cookie(secret) },
        registeredRedirect.origin,
      ),
    });
  }
  if (url.pathname === '/consent' && request.method === 'POST') {
    requireThat(
      request.headers.get('origin') === ctx.config.origin &&
        request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded'),
      'OAUTH_INVALID_REQUEST',
    );
    const form = new URLSearchParams(await readLimited(request, 4096, ctx.budget, 'REQUEST_TOO_LARGE'));
    requireThat(
      form.getAll('transaction').length === 1 && form.getAll('decision').length === 1,
      'OAUTH_INVALID_REQUEST',
    );
    const id = form.get('transaction') ?? '';
    const transaction = await loadTransaction(request, id, 'consent', ctx);
    await ctx.store.delete(`login:${id}`);
    if (form.get('decision') === 'deny')
      return new Response('Connection denied.', {
        status: 403,
        headers: secureHeaders({ 'Set-Cookie': cookie('', 0) }),
      });
    requireThat(form.get('decision') === 'allow', 'OAUTH_INVALID_REQUEST');
    await checkedAuth(transaction.authUrl, ctx);
    const state = randomSecret();
    const verifier = randomSecret();
    await ctx.store.put(`login:${state}`, JSON.stringify({ ...transaction, phase: 'github', verifier }), {
      expirationTtl: 600,
    });
    const github = new URL('https://github.com/login/oauth/authorize');
    github.searchParams.set('client_id', ctx.config.githubClientId);
    github.searchParams.set('redirect_uri', `${ctx.config.origin}/oauth/github/callback`);
    github.searchParams.set('state', state);
    github.searchParams.set('code_challenge', await pkceChallenge(verifier));
    github.searchParams.set('code_challenge_method', 'S256');
    // No repo scope, no user:email scope: the public stable numeric identity is enough.
    return redirect(github.toString());
  }
  if (url.pathname === '/oauth/github/callback' && request.method === 'GET') {
    requireThat(
      url.searchParams.getAll('state').length === 1 && url.searchParams.getAll('code').length === 1,
      'OAUTH_INVALID_REQUEST',
    );
    const id = url.searchParams.get('state') ?? '';
    const code = url.searchParams.get('code') ?? '';
    requireThat(/^[A-Za-z0-9_-]{1,256}$/.test(code), 'OAUTH_INVALID_REQUEST');
    const transaction = await loadTransaction(request, id, 'github', ctx);
    await ctx.store.delete(`login:${id}`);
    requireThat(transaction.verifier, 'OAUTH_INVALID_REQUEST');
    const token = await githubJson(
      'https://github.com/login/oauth/access_token',
      {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: ctx.config.githubClientId,
          client_secret: ctx.config.githubClientSecret,
          code,
          code_verifier: transaction.verifier,
          redirect_uri: `${ctx.config.origin}/oauth/github/callback`,
        }),
      },
      ctx,
    );
    requireThat(
      typeof token.access_token === 'string' && !/[\r\n]/.test(token.access_token),
      'OAUTH_INVALID_REQUEST',
    );
    const identity = await githubJson(
      'https://api.github.com/user',
      {
        headers: {
          Authorization: `Bearer ${token.access_token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'jules-mcp-owner-login',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
      ctx,
    );
    requireThat(
      Number.isSafeInteger(identity.id) && String(identity.id) === ctx.config.ownerId,
      'OWNER_DENIED',
      403,
    );
    const { auth, scopes } = await checkedAuth(transaction.authUrl, ctx);
    const { redirectTo } = await ctx.api.completeAuthorization({
      request: auth,
      userId: ctx.config.ownerId,
      metadata: { connection: 'owner-authorised' },
      scope: scopes,
      props: { clientId: auth.clientId, credentialId: randomSecret(), authMethod: 'oauth', scopes },
      revokeExistingGrants: false,
    });
    requireThat(
      new URL(redirectTo).origin === new URL(auth.redirectUri).origin &&
        new URL(redirectTo).pathname === new URL(auth.redirectUri).pathname,
      'OAUTH_INVALID_REQUEST',
    );
    return redirect(redirectTo, cookie('', 0));
  }
  return new Response('Not found', { status: 404, headers: secureHeaders() });
}
