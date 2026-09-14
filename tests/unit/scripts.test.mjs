import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const scripts = resolve('scripts');
async function sandbox(t) {
  const cwd = await mkdtemp(join(tmpdir(), 'jules-credentials-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  return cwd;
}
function run(cwd, name, args = [], env = process.env) {
  return spawnSync(process.execPath, [join(scripts, name), ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 5000,
    env,
  });
}
test('client issuer, rotation and revocation write private verifier files without printing secrets', async (t) => {
  const cwd = await sandbox(t);
  const issued = run(cwd, 'generate-client-credential.mjs', ['test-client']);
  assert.equal(issued.status, 0);
  const token = (await readFile(join(cwd, '.private/test-client.token'), 'utf8')).trim();
  const rows = JSON.parse(await readFile(join(cwd, '.private/service-tokens.json'), 'utf8'));
  assert.equal(rows[0].sha256, createHash('sha256').update(token).digest('hex'));
  assert.equal(JSON.stringify(rows).includes(token), false);
  assert.equal((issued.stdout + issued.stderr).includes(token), false);
  assert.deepEqual(rows[0].scopes, ['jules:read', 'jules:control']);
  if (process.platform !== 'win32')
    assert.equal((await stat(join(cwd, '.private/test-client.token'))).mode & 0o777, 0o600);
  assert.notEqual(run(cwd, 'generate-client-credential.mjs', ['test-client']).status, 0);
  assert.equal(
    run(cwd, 'generate-client-credential.mjs', ['test-client', '--rotate', '--read-only']).status,
    0,
  );
  const rotated = (await readFile(join(cwd, '.private/test-client.token'), 'utf8')).trim();
  assert.notEqual(rotated, token);
  assert.equal(run(cwd, 'revoke-client-credential.mjs', ['test-client']).status, 0);
  const revoked = JSON.parse(await readFile(join(cwd, '.private/service-tokens.json'), 'utf8'));
  assert.equal(revoked[0].revoked, true);
  assert.deepEqual(revoked[0].scopes, ['jules:read']);
});
test('admin issuer separates high-entropy token from stored verifier', async (t) => {
  const cwd = await sandbox(t);
  const result = run(cwd, 'generate-admin-credential.mjs');
  assert.equal(result.status, 0);
  const token = (await readFile(join(cwd, '.private/admin.token'), 'utf8')).trim();
  assert.match(token, /^jma_[A-Za-z0-9_-]{43}$/);
  assert.equal(
    (await readFile(join(cwd, '.private/admin.sha256'), 'utf8')).trim(),
    createHash('sha256').update(token).digest('hex'),
  );
  assert.equal(result.stdout.includes(token), false);
  assert.notEqual(run(cwd, 'generate-client-credential.mjs', ['admin']).status, 0);
  assert.notEqual(run(cwd, 'generate-admin-credential.mjs', ['--unknown']).status, 0);
});
test('dependency bootstrap fails rather than claiming success when pnpm cannot start', async (t) => {
  const cwd = await sandbox(t);
  const result = run(cwd, 'bootstrap-dependencies.mjs', [], { ...process.env, PATH: '' });
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout.includes('checks passed'), false);
});
