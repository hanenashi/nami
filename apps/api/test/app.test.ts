import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp, dataDirectories } from '../src/app.js';

test('health, static assets and persistent storage stay separate across restarts', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'nami-api-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dataRoot = join(root, 'data');
  const webRoot = join(root, 'web');
  await mkdir(webRoot);
  await writeFile(join(webRoot, 'index.html'), '<!doctype html><title>NAMI fixture</title>');
  await writeFile(join(webRoot, '.hidden'), 'not public');
  const app = await buildApp({ dataRoot, webRoot });
  t.after(() => app.close());

  const health = await app.inject('/api/health');
  assert.equal(health.statusCode, 200);
  assert.deepEqual(health.json(), { status: 'ok', service: 'nami' });
  assert.equal(health.headers['cache-control'], 'no-store');
  assert.equal(health.headers['referrer-policy'], 'no-referrer');
  assert.equal(health.headers['x-content-type-options'], 'nosniff');
  assert.equal((await app.inject('/')).statusCode, 200);
  assert.deepEqual((await readdir(dataRoot)).sort(), [...dataDirectories].sort());

  // Synthetic text only: no photographs, credentials or personal data in fixtures.
  await writeFile(join(dataRoot, 'originals', 'fixture.txt'), 'persistent fixture');
  for (const path of ['/originals/fixture.txt', '/data/originals/fixture.txt', '/api/missing', '/%2e%2e/data/originals/fixture.txt']) {
    assert.equal((await app.inject(path)).statusCode, 404, path);
  }
  assert.equal((await app.inject('/.hidden')).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: '/api/health' })).statusCode, 404);
  await app.close();
  const restarted = await buildApp({ dataRoot, webRoot });
  t.after(() => restarted.close());
  assert.equal((await restarted.inject('/api/health')).statusCode, 200);
  assert.equal(await readFile(join(dataRoot, 'originals', 'fixture.txt'), 'utf8'), 'persistent fixture');
});

test('startup rejects an invalid data root instead of claiming readiness', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'nami-invalid-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dataRoot = join(root, 'not-a-directory');
  await writeFile(dataRoot, 'fixture');
  await assert.rejects(buildApp({ dataRoot, webRoot: root }));
});
