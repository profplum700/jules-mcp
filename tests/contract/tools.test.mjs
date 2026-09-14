import test from 'node:test';
import assert from 'node:assert/strict';
import { executeTool } from '../../src/mcp/execute.ts';
import { TOOLS, toolSchema } from '../../src/mcp/catalog.ts';
import { mockClient, source, session, event, context, principal } from '../helpers/core.mjs';
const activityName = 'sessions/test-session/activities/test-activity';
const cases = [
  ['jules_list_sources', {}, [{ sources: [source()], nextPageToken: 'next' }], 'GET', '/sources'],
  ['jules_get_source', { source: 'sources/opaque-source' }, [source()], 'GET', '/sources/opaque-source'],
  ['jules_resolve_repository', { repository: 'acme/widgets' }, [{ sources: [source()] }], 'GET', '/sources'],
  [
    'jules_create_session',
    { repository: 'acme/widgets', prompt: 'Write a test' },
    [{ sources: [source()] }, session()],
    'POST',
    '/sessions',
  ],
  ['jules_list_sessions', {}, [{ sessions: [session({ prompt: 'content omitted' })] }], 'GET', '/sessions'],
  ['jules_get_session', { session: 'sessions/test-session' }, [session()], 'GET', '/sessions/test-session'],
  ['jules_delete_session', { session: 'sessions/test-session' }, [{}], 'DELETE', '/sessions/test-session'],
  [
    'jules_send_message',
    { session: 'sessions/test-session', prompt: 'Please test' },
    [{}],
    'POST',
    '/sessions/test-session:sendMessage',
  ],
  [
    'jules_approve_plan',
    { session: 'sessions/test-session' },
    [{}],
    'POST',
    '/sessions/test-session:approvePlan',
  ],
  [
    'jules_list_activities',
    { session: 'sessions/test-session' },
    [{ activities: [event()] }],
    'GET',
    '/sessions/test-session/activities',
  ],
  ['jules_get_activity', { activity: activityName }, [event()], 'GET', `/${activityName}`],
  [
    'jules_get_change_set',
    { activity: activityName, artifactIndex: 0 },
    [event()],
    'GET',
    `/${activityName}`,
  ],
  ['jules_gateway_info', {}, [], null, null],
];
for (const [name, args, fixture, method, path] of cases)
  test(`tool contract: ${name}`, async () => {
    const m = mockClient([...fixture]);
    try {
      const result = await executeTool(name, args, context(m.client));
      assert.equal(result.isError, undefined, JSON.stringify(result));
      assert.ok(result.structuredContent);
      assert.ok(result.content[0].text.length < 300);
      if (method) {
        assert.equal(m.calls.at(-1).method, method);
        assert.equal(new URL(m.calls.at(-1).url).pathname, `/v1alpha${path}`);
      } else assert.equal(m.calls.length, 0);
    } finally {
      m.close();
    }
  });
for (const tool of TOOLS.filter((t) => t.control))
  test(`read-only credential cannot ${tool.name}`, async () => {
    const m = mockClient([]);
    try {
      const args = cases.find((c) => c[0] === tool.name)[1];
      const r = await executeTool(tool.name, args, context(m.client, principal('reader', ['jules:read'])));
      assert.equal(r.structuredContent.error.code, 'FORBIDDEN');
      assert.equal(m.calls.length, 0);
    } finally {
      m.close();
    }
  });
test('session options translated; no implicit branch/main or approval override', async () => {
  const m = mockClient([source(), session()]);
  try {
    const r = await executeTool(
      'jules_create_session',
      {
        source: 'sources/opaque-source',
        prompt: 'Task',
        title: 'Title',
        requirePlanApproval: true,
        automationMode: 'AUTO_CREATE_PR',
      },
      context(m.client),
    );
    assert.equal(r.isError, undefined);
    assert.deepEqual(m.calls[1].body, {
      prompt: 'Task',
      title: 'Title',
      requirePlanApproval: true,
      automationMode: 'AUTO_CREATE_PR',
      sourceContext: { source: 'sources/opaque-source', githubRepoContext: { startingBranch: 'develop' } },
    });
  } finally {
    m.close();
  }
});
test('intentional repositoryless session preserves upstream defaults', async () => {
  const m = mockClient([session()]);
  try {
    await executeTool('jules_create_session', { prompt: 'Task', repositoryless: true }, context(m.client));
    assert.deepEqual(m.calls[0].body, { prompt: 'Task' });
  } finally {
    m.close();
  }
});
for (const args of [
  { prompt: 'x' },
  { prompt: 'x', repositorry: 'acme/widgets' },
  { prompt: 'x', repository: 'acme/widgets', source: 'sources/x' },
  { prompt: 'x', repositoryless: true, branch: 'main' },
  { prompt: 'x', repositoryless: false },
  { prompt: 'x', repositoryless: true, automationMode: 'AUTO_CREATE_PR' },
  { prompt: 'x', repository: 'acme/widgets', repositoryless: true },
])
  test(`reject ambiguous create context ${JSON.stringify(args)}`, async () => {
    const m = mockClient([]);
    try {
      const r = await executeTool('jules_create_session', args, context(m.client));
      assert.equal(r.structuredContent.error.code, 'INVALID_ARGUMENT');
      assert.equal(m.calls.length, 0);
    } finally {
      m.close();
    }
  });
test('metadata pagination never claims complete on first page', async () => {
  const m = mockClient([
    { sessions: [session({ prompt: 'untrusted secret prompt' })], nextPageToken: 'more' },
  ]);
  try {
    const r = await executeTool('jules_list_sessions', {}, context(m.client));
    assert.equal(r.structuredContent.complete, false);
    assert.equal(r.structuredContent.nextPageToken, 'more');
    assert.ok(r.structuredContent.sessions[0].omittedFields.includes('prompt'));
    assert.equal(JSON.stringify(r).includes('untrusted secret prompt'), false);
  } finally {
    m.close();
  }
});
test('artifact slices carry identity, digest, total and continuation', async () => {
  const m = mockClient([event('123456789')]);
  try {
    const r = await executeTool(
      'jules_get_change_set',
      { activity: activityName, artifactIndex: 0, limit: 4 },
      context(m.client),
    );
    assert.deepEqual(
      [r.structuredContent.patch, r.structuredContent.totalChars, r.structuredContent.nextOffset],
      ['1234', 9, 4],
    );
    assert.equal(r.structuredContent.activity, activityName);
    assert.match(r.structuredContent.sha256, /^[a-f0-9]{64}$/);
  } finally {
    m.close();
  }
});
test('changed digest rejects continuation', async () => {
  const m = mockClient([event('new content')]);
  try {
    const r = await executeTool(
      'jules_get_change_set',
      { activity: activityName, artifactIndex: 0, expectedSha256: '0'.repeat(64) },
      context(m.client),
    );
    assert.equal(r.structuredContent.error.code, 'ARTIFACT_CHANGED');
  } finally {
    m.close();
  }
});
test('surrogate pairs are not split at output boundary', async () => {
  const m = mockClient([event('a😀b')]);
  try {
    const r = await executeTool(
      'jules_get_change_set',
      { activity: activityName, artifactIndex: 0, limit: 2 },
      context(m.client),
    );
    assert.equal(r.structuredContent.patch, 'a');
    assert.equal(r.structuredContent.nextOffset, 1);
  } finally {
    m.close();
  }
});
test('oversized full activity returns explicit limit, not false review completion', async () => {
  const m = mockClient([event('x'.repeat(2000))], { outputChars: 1000 });
  try {
    const r = await executeTool('jules_get_activity', { activity: activityName }, context(m.client));
    assert.equal(r.structuredContent.error.code, 'OUTPUT_TOO_LARGE');
  } finally {
    m.close();
  }
});
test('valid large successful create is not repeated or falsely rejected', async () => {
  const m = mockClient([session({ prompt: 'x'.repeat(4000) })], { outputChars: 1000 });
  try {
    const r = await executeTool(
      'jules_create_session',
      { prompt: 'Task', repositoryless: true },
      context(m.client),
    );
    assert.equal(r.structuredContent.upstreamOutcome, 'succeeded');
    assert.equal(r.structuredContent.outputOmitted, true);
    assert.equal(m.calls.length, 1);
  } finally {
    m.close();
  }
});
test('rate limit prevents upstream dispatch', async () => {
  const m = mockClient([]);
  try {
    const r = await executeTool(
      'jules_list_sessions',
      {},
      context(m.client, principal(), { rateLimit: async () => false }),
    );
    assert.equal(r.structuredContent.error.code, 'GATEWAY_RATE_LIMITED');
    assert.equal(m.calls.length, 0);
  } finally {
    m.close();
  }
});
test('parallel clients retain distinct principals', async () => {
  const a = mockClient([]);
  const b = mockClient([]);
  try {
    const results = await Promise.all([
      executeTool('jules_gateway_info', {}, context(a.client, principal('a'))),
      executeTool('jules_gateway_info', {}, context(b.client, principal('b'))),
    ]);
    assert.deepEqual(
      results.map((r) => r.structuredContent.principal.clientId),
      ['a', 'b'],
    );
  } finally {
    a.close();
    b.close();
  }
});
test('client B can inspect and continue client A session; no ownership queue', async () => {
  const a = mockClient([session()]);
  const b = mockClient([session(), {}]);
  try {
    const created = await executeTool(
      'jules_create_session',
      { prompt: 'Task', repositoryless: true },
      context(a.client, principal('a')),
    );
    assert.equal(
      (
        await executeTool(
          'jules_get_session',
          { session: created.structuredContent.name },
          context(b.client, principal('b')),
        )
      ).isError,
      undefined,
    );
    assert.equal(
      (
        await executeTool(
          'jules_send_message',
          { session: created.structuredContent.name, prompt: 'Continue' },
          context(b.client, principal('b')),
        )
      ).isError,
      undefined,
    );
  } finally {
    a.close();
    b.close();
  }
});
test('schema is strict and all write annotations follow control', () => {
  assert.equal(TOOLS.length, 13);
  assert.equal(new Set(TOOLS.map((t) => t.name)).size, 13);
  for (const t of TOOLS) {
    assert.equal(toolSchema(t).additionalProperties, false);
    assert.match(t.description, /./);
  }
  assert.equal(TOOLS.find((t) => t.name === 'jules_delete_session').destructive, true);
  assert.equal(
    TOOLS.some((t) => /cancel|merge|shell|admin/.test(t.name)),
    false,
  );
});
for (const args of [
  { pageSize: 0 },
  { pageSize: 101 },
  { pageSize: 1.5 },
  { pageToken: 'x'.repeat(2049) },
  { filter: 'unsupported' },
])
  test(`reject invalid session list arguments ${Object.keys(args)}`, async () => {
    const m = mockClient([]);
    try {
      const r = await executeTool('jules_list_sessions', args, context(m.client));
      assert.equal(r.structuredContent.error.code, 'INVALID_ARGUMENT');
    } finally {
      m.close();
    }
  });
test('default source metadata omits large branch arrays explicitly', async () => {
  const item = source();
  item.githubRepo.branches = Array.from({ length: 1000 }, (_, i) => ({ displayName: `branch-${i}` }));
  const m = mockClient([{ sources: [item] }]);
  try {
    const r = await executeTool('jules_list_sources', {}, context(m.client));
    assert.equal(r.structuredContent.sources[0].githubRepo.branches, undefined);
    assert.deepEqual(r.structuredContent.sources[0].githubRepoOmittedFields, ['branches']);
  } finally {
    m.close();
  }
});
