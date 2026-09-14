import test from 'node:test';
import assert from 'node:assert/strict';
import { retryDelay, JulesClient } from '../../src/jules/client.ts';
import { RequestBudget, readLimited } from '../../src/shared/limits.ts';
import { mockClient, session, rejectsCode } from '../helpers/core.mjs';
for (const [label, call] of [
  ['create', (j) => j.createSession({ prompt: 'synthetic prompt' })],
  ['message', (j) => j.sendMessage('sessions/s', 'synthetic message')],
  ['approve', (j) => j.approvePlan('sessions/s')],
  ['delete', (j) => j.deleteSession('sessions/s')],
]) {
  for (const failure of ['network', '500', 'malformed', 'oversized'])
    test(`${label}: ambiguous ${failure} is never retried`, async () => {
      const response =
        failure === 'network'
          ? new Error('lost response with synthetic secret')
          : failure === '500'
            ? new Response('sensitive error', { status: 500 })
            : failure === 'oversized'
              ? new Response('x'.repeat(400))
              : new Response('not json');
      const m = mockClient([response, {}], { upstreamBytes: 100 });
      try {
        await assert.rejects(call(m.client), rejectsCode('UPSTREAM_OUTCOME_UNKNOWN'));
        assert.equal(m.calls.length, 1);
      } finally {
        m.close();
      }
    });
}
test('valid oversized mutation response reports unknown if no trustworthy JSON obtained', async () => {
  const m = mockClient([session({ prompt: 'x'.repeat(500) })], { upstreamBytes: 100 });
  try {
    await assert.rejects(m.client.createSession({ prompt: 'task' }), rejectsCode('UPSTREAM_OUTCOME_UNKNOWN'));
  } finally {
    m.close();
  }
});
for (const [status, expected] of [
  [401, 'UPSTREAM_AUTHENTICATION_FAILED'],
  [403, 'UPSTREAM_FORBIDDEN'],
  [404, 'RESOURCE_NOT_FOUND'],
  [410, 'RESOURCE_EXPIRED'],
  [409, 'INVALID_SESSION_STATE'],
  [412, 'INVALID_SESSION_STATE'],
  [429, 'JULES_QUOTA_EXHAUSTED'],
])
  test(`safe classification ${status}`, async () => {
    const m = mockClient([new Response('do-not-leak', { status, headers: { 'Retry-After': '900' } })]);
    try {
      await assert.rejects(
        m.client.getSession('sessions/s'),
        (e) => e.code === expected && !JSON.stringify(e).includes('do-not-leak'),
      );
    } finally {
      m.close();
    }
  });
test('read retries a transient response', async () => {
  const m = mockClient([
    new Response('', { status: 503, headers: { 'Retry-After': '0' } }),
    { sessions: [] },
  ]);
  try {
    await m.client.listSessions();
    assert.equal(m.calls.length, 2);
  } finally {
    m.close();
  }
});
test('long Retry-After does not sleep or amplify calls', async () => {
  const m = mockClient([new Response('', { status: 429, headers: { 'Retry-After': '3600' } })]);
  try {
    await assert.rejects(m.client.listSessions(), rejectsCode('JULES_QUOTA_EXHAUSTED'));
    assert.equal(m.calls.length, 1);
  } finally {
    m.close();
  }
});
test('Retry-After numeric, date and jitter bounds', () => {
  assert.equal(retryDelay('2', 0), 2000);
  assert.equal(retryDelay(new Date(5000).toUTCString(), 0, 1000), 4000);
  assert.equal(retryDelay(null, 1, 0, 0.5), 250);
});
test('all outbound credentials go only to fixed Google origin; manual redirects', async () => {
  const b = new RequestBudget();
  let seen;
  const j = new JulesClient('private-key-sentinel', b, async (r) => {
    seen = r;
    return Response.json({ sessions: [] });
  });
  try {
    await j.listSessions({ pageToken: 'https://evil.test/?x=y' });
    assert.equal(new URL(seen.url).origin, 'https://jules.googleapis.com');
    assert.equal(seen.headers.get('x-goog-api-key'), 'private-key-sentinel');
    assert.equal(seen.headers.has('authorization'), false);
    assert.equal(seen.redirect, 'manual');
  } finally {
    b.close();
  }
});
test('chunked response bounded without Content-Length', async () => {
  const b = new RequestBudget();
  const response = new Response(
    new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array(80));
        c.enqueue(new Uint8Array(80));
        c.close();
      },
    }),
  );
  try {
    await assert.rejects(readLimited(response, 100, b), rejectsCode('UPSTREAM_TOO_LARGE'));
  } finally {
    b.close();
  }
});
test('body bytes not character count enforce input budget', async () => {
  const b = new RequestBudget();
  try {
    await assert.rejects(
      readLimited(new Response('é'.repeat(20)), 25, b, 'REQUEST_TOO_LARGE'),
      rejectsCode('REQUEST_TOO_LARGE'),
    );
  } finally {
    b.close();
  }
});
test('request budget rejects before mutation dispatch', async () => {
  const m = mockClient([{}], { maxRequests: 0 });
  try {
    await assert.rejects(m.client.deleteSession('sessions/s'), rejectsCode('REQUEST_BUDGET_EXHAUSTED'));
    assert.equal(m.calls.length, 0);
  } finally {
    m.close();
  }
});
test('wall-clock deadline enforced', async () => {
  const b = new RequestBudget({ deadlineMs: 20 });
  const keepAlive = setTimeout(() => {}, 100);
  try {
    await assert.rejects(b.run(new Promise(() => {})), rejectsCode('DEADLINE_EXCEEDED'));
  } finally {
    clearTimeout(keepAlive);
    b.close();
  }
});
test('wrong upstream resource name fails contract', async () => {
  const m = mockClient([session()]);
  try {
    await assert.rejects(m.client.getSession('sessions/different'), rejectsCode('UPSTREAM_PROTOCOL_ERROR'));
  } finally {
    m.close();
  }
});
test('unknown upstream states preserved', async () => {
  const m = mockClient([session()]);
  try {
    assert.equal((await m.client.getSession('sessions/test-session')).state, 'FUTURE_STATE');
  } finally {
    m.close();
  }
});
test('unexpected mutation redirect remains ambiguous and is never followed/retried', async () => {
  const m = mockClient([new Response(null, { status: 302, headers: { Location: 'https://evil.test/' } })]);
  try {
    await assert.rejects(
      m.client.sendMessage('sessions/s', 'message'),
      rejectsCode('UPSTREAM_OUTCOME_UNKNOWN'),
    );
    assert.equal(m.calls.length, 1);
  } finally {
    m.close();
  }
});
test('malformed list member is a protocol error rather than silent incomplete data', async () => {
  const m = mockClient([{ sources: [null] }]);
  try {
    await assert.rejects(m.client.listSources(), rejectsCode('UPSTREAM_PROTOCOL_ERROR'));
  } finally {
    m.close();
  }
});
test('undefined optional pageSize preserves explicit default 20', async () => {
  const m = mockClient([{ sessions: [] }]);
  try {
    await m.client.listSessions({ pageSize: undefined });
    assert.equal(new URL(m.calls[0].url).searchParams.get('pageSize'), '20');
  } finally {
    m.close();
  }
});
