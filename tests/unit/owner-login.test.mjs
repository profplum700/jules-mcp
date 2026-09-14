import test from 'node:test';
import assert from 'node:assert/strict';
import { ownerLogin, escapeHtml } from '../../src/auth/owner-login.ts';
import { RequestBudget } from '../../src/shared/limits.ts';
import { pkceChallenge, randomSecret } from '../../src/shared/crypto.ts';
const origin = 'https://gateway.example.test';
function harness(overrides = {}) {
  const rows = new Map();
  const completed = [];
  const github = [];
  const b = new RequestBudget();
  const config = {
    origin,
    ownerId: '12345',
    githubClientId: 'synthetic-client',
    githubClientSecret: 'synthetic-client-secret',
    ...overrides.config,
  };
  const ctx = {
    config,
    budget: b,
    store: {
      async get(k) {
        return rows.get(k) ?? null;
      },
      async put(k, v) {
        rows.set(k, v);
      },
      async delete(k) {
        rows.delete(k);
      },
    },
    api: {
      async parseAuthRequest(request) {
        const p = new URL(request.url).searchParams;
        return {
          clientId: p.get('client_id'),
          redirectUri: p.get('redirect_uri'),
          responseType: p.get('response_type'),
          scope: p.has('scope') ? p.get('scope').split(' ') : [],
          state: p.get('state'),
          codeChallenge: p.get('code_challenge'),
          codeChallengeMethod: p.get('code_challenge_method'),
          resource: p.get('resource'),
        };
      },
      async lookupClient(id) {
        return id === 'registered'
          ? {
              clientName: '<script>untrusted client</script>',
              redirectUris: ['https://client.example.test/callback'],
            }
          : null;
      },
      async completeAuthorization(options) {
        completed.push(options);
        return {
          redirectTo: `${options.request.redirectUri}?code=synthetic-code&state=${options.request.state}`,
        };
      },
    },
    async fetcher(request) {
      github.push({
        url: request.url,
        headers: Object.fromEntries(request.headers),
        body: request.body ? await request.text() : null,
      });
      if (request.url.endsWith('/access_token'))
        return Response.json({ access_token: 'synthetic-ephemeral-github-token' });
      return Response.json({ id: overrides.githubId ?? 12345 });
    },
  };
  const url = new URL(`${origin}/authorize`);
  for (const [k, v] of Object.entries({
    client_id: 'registered',
    response_type: 'code',
    redirect_uri: 'https://client.example.test/callback',
    state: 'client-state',
    code_challenge: 'a'.repeat(43),
    code_challenge_method: 'S256',
    resource: `${origin}/mcp`,
    scope: 'jules:read jules:control',
    ...overrides.params,
  }))
    url.searchParams.set(k, v);
  return { ctx, rows, completed, github, url, close: () => b.close() };
}
async function start(h) {
  const response = await ownerLogin(new Request(h.url), h.ctx);
  const html = await response.text();
  return {
    response,
    html,
    cookie: response.headers.get('set-cookie').split(';')[0],
    transaction: html.match(/name="transaction" value="([^"]+)"/)[1],
  };
}
async function consent(h, s, decision = 'allow', originHeader = origin) {
  return ownerLogin(
    new Request(`${origin}/consent`, {
      method: 'POST',
      headers: {
        Origin: originHeader,
        Cookie: s.cookie,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ transaction: s.transaction, decision }),
    }),
    h.ctx,
  );
}
async function callback(h, s, response, extra = '') {
  const state = new URL(response.headers.get('location')).searchParams.get('state');
  return ownerLogin(
    new Request(`${origin}/oauth/github/callback?state=${state}&code=code-once${extra}`, {
      headers: { Cookie: s.cookie },
    }),
    h.ctx,
  );
}
test('GitHub owner flow, connection consent, S256, code exchange, discard login token', async () => {
  const h = harness();
  try {
    const s = await start(h);
    assert.equal(s.response.status, 200);
    assert.match(s.html, /&lt;script&gt;/);
    assert.doesNotMatch(s.html, /<script>/);
    assert.match(s.response.headers.get('set-cookie'), /Secure; HttpOnly; SameSite=Lax/);
    const login = await consent(h, s);
    const githubUrl = new URL(login.headers.get('location'));
    assert.equal(githubUrl.origin, 'https://github.com');
    assert.equal(githubUrl.searchParams.get('scope'), null);
    assert.equal(githubUrl.searchParams.get('code_challenge_method'), 'S256');
    const result = await callback(h, s, login);
    assert.equal(result.status, 302);
    assert.equal(new URL(result.headers.get('location')).origin, 'https://client.example.test');
    assert.equal(h.completed.length, 1);
    assert.equal(h.completed[0].props.clientId, 'registered');
    assert.deepEqual(h.completed[0].scope, ['jules:read', 'jules:control']);
    assert.equal(JSON.stringify([...h.rows]).includes('synthetic-ephemeral-github-token'), false);
    assert.equal(JSON.stringify(h.completed).includes('synthetic-ephemeral-github-token'), false);
    assert.equal(h.rows.size, 0);
    const tokenBody = new URLSearchParams(h.github[0].body);
    assert.equal(
      await pkceChallenge(tokenBody.get('code_verifier')),
      githubUrl.searchParams.get('code_challenge'),
    );
    assert.equal(h.github[1].headers.authorization, 'Bearer synthetic-ephemeral-github-token');
  } finally {
    h.close();
  }
});
test('wrong stable GitHub owner is denied before grant creation', async () => {
  const h = harness({ githubId: 99999 });
  try {
    const s = await start(h);
    const r = await consent(h, s);
    await assert.rejects(callback(h, s, r), (e) => e.code === 'OWNER_DENIED');
    assert.equal(h.completed.length, 0);
  } finally {
    h.close();
  }
});
for (const params of [
  { client_id: 'unknown' },
  { redirect_uri: 'https://evil.test/callback' },
  { redirect_uri: 'https://client.example.test/callback/extra' },
  { code_challenge_method: 'plain' },
  { code_challenge: '' },
  { resource: 'https://other.example.test/mcp' },
  { scope: 'jules:read admin' },
  { response_type: 'token' },
])
  test(`reject OAuth request ${Object.keys(params).join(',')}`, async () => {
    const h = harness({ params });
    try {
      await assert.rejects(start(h));
      assert.equal(h.rows.size, 0);
      assert.equal(h.completed.length, 0);
    } finally {
      h.close();
    }
  });
test('consent CSRF wrong Origin denied', async () => {
  const h = harness();
  try {
    const s = await start(h);
    await assert.rejects(
      consent(h, s, 'allow', 'https://evil.test'),
      (e) => e.code === 'OAUTH_INVALID_REQUEST',
    );
    assert.equal(h.github.length, 0);
  } finally {
    h.close();
  }
});
test('cookie/state tampering denied', async () => {
  const h = harness();
  try {
    const s = await start(h);
    await assert.rejects(
      consent(h, { ...s, cookie: `__Host-jules_login=${randomSecret()}` }),
      (e) => e.code === 'OAUTH_INVALID_REQUEST',
    );
    await assert.rejects(
      consent(h, { ...s, transaction: randomSecret() }),
      (e) => e.code === 'OAUTH_INVALID_REQUEST',
    );
  } finally {
    h.close();
  }
});
test('consent replay denied', async () => {
  const h = harness();
  try {
    const s = await start(h);
    await consent(h, s);
    await assert.rejects(consent(h, s), (e) => e.code === 'OAUTH_INVALID_REQUEST');
  } finally {
    h.close();
  }
});
test('callback replay denied after consumption', async () => {
  const h = harness();
  try {
    const s = await start(h);
    const r = await consent(h, s);
    await callback(h, s, r);
    await assert.rejects(callback(h, s, r), (e) => e.code === 'OAUTH_INVALID_REQUEST');
    assert.equal(h.completed.length, 1);
  } finally {
    h.close();
  }
});
test('expired browser transaction denied', async () => {
  const h = harness();
  try {
    const s = await start(h);
    const key = `login:${s.transaction}`;
    h.rows.set(key, JSON.stringify({ ...JSON.parse(h.rows.get(key)), expiresAt: 0 }));
    await assert.rejects(consent(h, s), (e) => e.code === 'OAUTH_INVALID_REQUEST');
  } finally {
    h.close();
  }
});
test('deny is not a grant or an arbitrary redirect', async () => {
  const h = harness();
  try {
    const s = await start(h);
    const response = await consent(h, s, 'deny');
    assert.equal(response.status, 403);
    assert.equal(response.headers.has('location'), false);
    assert.equal(h.completed.length, 0);
    assert.equal(h.rows.size, 0);
  } finally {
    h.close();
  }
});
test('missing scope defaults to full trusted authority; read-only consent stays read-only', async () => {
  for (const scopes of [null, 'jules:read']) {
    const h = harness();
    if (scopes === null) h.url.searchParams.delete('scope');
    else h.url.searchParams.set('scope', scopes);
    try {
      const s = await start(h);
      const r = await consent(h, s);
      await callback(h, s, r);
      assert.deepEqual(h.completed[0].scope, scopes ? ['jules:read'] : ['jules:read', 'jules:control']);
    } finally {
      h.close();
    }
  }
});
test('escaping all HTML delimiters', () =>
  assert.equal(escapeHtml('<a title="x">&\''), '&lt;a title=&quot;x&quot;&gt;&amp;&#39;'));
