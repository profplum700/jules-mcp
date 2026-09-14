import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRepository, branchName, resourceName } from '../../src/jules/resources.ts';
import { resolveRepository } from '../../src/jules/resolve-repository.ts';
import { source, mockClient, rejectsCode } from '../helpers/core.mjs';
for (const [value, expected] of [
  ['ACME/Widget.Lib', 'acme/widget.lib'],
  ['a-b/my_repo', 'a-b/my_repo'],
  ['https://github.com/ACME/Widgets.git', 'acme/widgets'],
  ['https://github.com/acme/widgets/', 'acme/widgets'],
])
  test(`normalise exact repository: ${value}`, () => assert.equal(normalizeRepository(value), expected));
for (const value of [
  'widgets',
  'acme/widget/tree/main',
  'https://evil.test/acme/widgets',
  'http://github.com/acme/widgets',
  'https://github.com@evil.test/acme/widgets',
  'https://github.com/acme/widgets?token=x',
  'https://github.com/acme/%77idgets',
  'https://github.com/acme/../widgets',
  '../widgets',
  'acme/..',
  ' acme/widgets',
  'acme/widgets ',
])
  test(`reject non-exact repository: ${value}`, () => assert.throws(() => normalizeRepository(value)));
for (const value of [
  'sources/../secret',
  'sessions/%2e%2e',
  'https://evil.test/sessions/x',
  'sessions/x:approvePlan',
  'sessions/.',
  'sessions/x?key=value',
])
  test(`reject resource traversal: ${value}`, () =>
    assert.throws(() => resourceName(value, value.startsWith('sources/') ? 'source' : 'session')));
test('canonical identifiers remain opaque', () =>
  assert.equal(resourceName('sources/weird-provider-id.v2', 'source'), 'sources/weird-provider-id.v2'));
test('branch case is preserved, whitespace invalid', () => {
  assert.equal(branchName('Feature/Test.v2'), 'Feature/Test.v2');
  assert.throws(() => branchName(' branch'));
});
test('late page match, mixed case, non-main default', async () => {
  const m = mockClient([
    { sources: [source('sources/other', 'other', 'project')], nextPageToken: 'page-two' },
    { sources: [source('sources/opaque', 'ACME', 'WIDGETS', 'release-v2')] },
  ]);
  try {
    const r = await resolveRepository(m.client, 'acme/widgets');
    assert.equal(r.source, 'sources/opaque');
    assert.equal(r.branch, 'release-v2');
    assert.equal(r.pagesScanned, 2);
    assert.match(m.calls[1].url, /pageToken=page-two/);
  } finally {
    m.close();
  }
});
test('does not return first-page match before checking duplicates', async () => {
  const m = mockClient([
    { sources: [source()], nextPageToken: 'next' },
    { sources: [source('sources/duplicate')] },
  ]);
  try {
    await assert.rejects(resolveRepository(m.client, 'acme/widgets'), rejectsCode('REPOSITORY_AMBIGUOUS'));
  } finally {
    m.close();
  }
});
test('same canonical entry repeated is not an ambiguous duplicate', async () => {
  const m = mockClient([{ sources: [source()], nextPageToken: 'next' }, { sources: [source()] }]);
  try {
    assert.equal((await resolveRepository(m.client, 'acme/widgets')).source, 'sources/opaque-source');
  } finally {
    m.close();
  }
});
test('budget exhaustion reports incomplete, not not-connected', async () => {
  const m = mockClient([{ sources: [], nextPageToken: 'next' }]);
  try {
    await assert.rejects(
      resolveRepository(m.client, 'acme/widgets', { maxPages: 1 }),
      (e) => e.code === 'RESOLUTION_INCOMPLETE' && e.details.nextPageToken === 'next',
    );
  } finally {
    m.close();
  }
});
test('caller continuation cannot falsely prove uniqueness in earlier pages', async () => {
  const m = mockClient([{ sources: [source()] }]);
  try {
    await assert.rejects(
      resolveRepository(m.client, 'acme/widgets', { pageToken: 'continued' }),
      (e) => e.code === 'RESOLUTION_INCOMPLETE' && e.details.candidates.length === 1,
    );
  } finally {
    m.close();
  }
});
test('no match only after complete scan', async () => {
  const m = mockClient([{ sources: [], nextPageToken: 'next' }, { sources: [] }]);
  try {
    await assert.rejects(
      resolveRepository(m.client, 'acme/widgets'),
      (e) => e.code === 'REPOSITORY_NOT_CONNECTED' && e.details.complete,
    );
    assert.equal(m.calls.length, 2);
  } finally {
    m.close();
  }
});
test('canonical source retrieved, explicit branch preserved', async () => {
  const m = mockClient([source()]);
  try {
    const r = await resolveRepository(m.client, 'sources/opaque-source', { branch: 'Branch/CASE' });
    assert.equal(r.branch, 'Branch/CASE');
    assert.equal(m.calls.length, 1);
  } finally {
    m.close();
  }
});
test('missing branch requires explicit input', async () => {
  const item = source();
  delete item.githubRepo.defaultBranch;
  const m = mockClient([item]);
  try {
    await assert.rejects(resolveRepository(m.client, item.name), rejectsCode('BRANCH_REQUIRED'));
  } finally {
    m.close();
  }
});
test('missing list branch falls back to source detail', async () => {
  const item = source();
  delete item.githubRepo.defaultBranch;
  const m = mockClient([{ sources: [item] }, source()]);
  try {
    assert.equal((await resolveRepository(m.client, 'acme/widgets')).branch, 'develop');
  } finally {
    m.close();
  }
});
test('disconnected canonical source is not guessed', async () => {
  const m = mockClient([new Response('', { status: 404 })]);
  try {
    await assert.rejects(
      resolveRepository(m.client, 'sources/disconnected'),
      rejectsCode('RESOURCE_NOT_FOUND'),
    );
  } finally {
    m.close();
  }
});
test('new and archived connected source has no secondary allowlist', async () => {
  const item = { ...source('sources/new'), archived: true };
  const m = mockClient([{ sources: [item] }]);
  try {
    assert.equal((await resolveRepository(m.client, 'acme/widgets')).source, 'sources/new');
  } finally {
    m.close();
  }
});
test('pagination loop is rejected', async () => {
  const m = mockClient([
    { sources: [], nextPageToken: 'same' },
    { sources: [], nextPageToken: 'same' },
  ]);
  try {
    await assert.rejects(resolveRepository(m.client, 'acme/widgets'), rejectsCode('UPSTREAM_PROTOCOL_ERROR'));
  } finally {
    m.close();
  }
});

for (const input of ['opaque-source', 'github/acme/widgets', 'sources/github/acme/widgets'])
  test(`canonical source ID/name: ${input}`, async () => {
    const name = input.startsWith('sources/') ? input : `sources/${input}`;
    const m = mockClient([source(name)]);
    try {
      assert.equal((await resolveRepository(m.client, input)).source, name);
      assert.equal(m.calls.length, 1);
    } finally {
      m.close();
    }
  });
for (const input of [
  'sources/github/../widgets',
  'sources/github/acme/%2e%2e',
  'sources/github/acme/widgets/extra',
])
  test(`reject unsafe nested source: ${input}`, () => assert.throws(() => resourceName(input, 'source')));
