import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
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

test('organizer setup, login and logout persist safely', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'nami-auth-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dataRoot = join(root, 'data');
  const webRoot = join(root, 'web');
  await mkdir(webRoot);
  await writeFile(join(webRoot, 'index.html'), '<!doctype html><title>NAMI fixture</title>');
  let app = await buildApp({ dataRoot, webRoot });
  const sameOriginHeaders = { host: 'nami.test', origin: 'http://nami.test' };

  const initial = await app.inject('/api/auth/status');
  assert.deepEqual(initial.json(), { setupRequired: true, authenticated: false, organizer: null });
  const crossOrigin = await app.inject({
    method: 'POST', url: '/api/auth/setup', headers: { host: 'nami.test', origin: 'http://elsewhere.test' },
    payload: { displayName: 'Organizer', password: 'a long test passphrase' },
  });
  assert.equal(crossOrigin.statusCode, 403);
  const tooShort = await app.inject({
    method: 'POST', url: '/api/auth/setup', headers: sameOriginHeaders,
    payload: { displayName: 'Organizer', password: 'too short' },
  });
  assert.equal(tooShort.statusCode, 400);

  const setup = await app.inject({
    method: 'POST', url: '/api/auth/setup', headers: sameOriginHeaders,
    payload: { displayName: 'Organizer', password: 'a long test passphrase' },
  });
  assert.equal(setup.statusCode, 201);
  const setCookie = setup.headers['set-cookie'];
  assert.equal(typeof setCookie, 'string');
  assert.match(String(setCookie), /HttpOnly/i);
  assert.match(String(setCookie), /SameSite=Strict/i);
  const sessionCookie = String(setCookie).split(';', 1)[0];
  assert.ok(sessionCookie.startsWith('nami_session='));

  const status = await app.inject({ url: '/api/auth/status', headers: { cookie: sessionCookie } });
  assert.deepEqual(status.json(), {
    setupRequired: false,
    authenticated: true,
    organizer: { displayName: 'Organizer' },
  });
  const secondSetup = await app.inject({
    method: 'POST', url: '/api/auth/setup', headers: sameOriginHeaders,
    payload: { displayName: 'Someone else', password: 'another long passphrase' },
  });
  assert.equal(secondSetup.statusCode, 409);

  const database = new Database(join(dataRoot, 'db', 'nami.sqlite'), { readonly: true });
  const actor = database.prepare('SELECT display_name, password_hash FROM actors').get() as { display_name: string; password_hash: string };
  const session = database.prepare('SELECT token_hash FROM sessions').get() as { token_hash: string };
  database.close();
  assert.equal(actor.display_name, 'Organizer');
  assert.ok(actor.password_hash.startsWith('scrypt$'));
  assert.ok(!actor.password_hash.includes('a long test passphrase'));
  assert.notEqual(session.token_hash, sessionCookie.split('=')[1]);

  const logout = await app.inject({
    method: 'POST', url: '/api/auth/logout',
    headers: { ...sameOriginHeaders, cookie: sessionCookie },
  });
  assert.equal(logout.statusCode, 204);
  assert.match(String(logout.headers['set-cookie']), /Max-Age=0/i);
  assert.equal((await app.inject({ url: '/api/auth/status', headers: { cookie: sessionCookie } })).json().authenticated, false);
  await app.close();

  app = await buildApp({ dataRoot, webRoot });
  t.after(() => app.close());
  assert.equal((await app.inject('/api/auth/status')).json().setupRequired, false);
  const wrongLogin = await app.inject({
    method: 'POST', url: '/api/auth/login', headers: sameOriginHeaders,
    payload: { password: 'the wrong passphrase' },
  });
  assert.equal(wrongLogin.statusCode, 401);
  const login = await app.inject({
    method: 'POST', url: '/api/auth/login', headers: sameOriginHeaders,
    payload: { password: 'a long test passphrase' },
  });
  assert.equal(login.statusCode, 200);
  assert.equal(login.json().organizer.displayName, 'Organizer');
});
