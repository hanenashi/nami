import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, stat, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { buildApp } from '../src/app.js';

test('Tus ownership, limits, cancellation and byte-exact resume across API restart', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'nami-tus-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const webRoot = join(root, 'web');
  const dataRoot = join(root, 'data');
  await mkdir(webRoot);
  await writeFile(join(webRoot, 'index.html'), '<title>Fixture</title>');
  let app = await buildApp({ dataRoot, webRoot });
  t.after(() => app.close());
  let base = await app.listen({ host: '127.0.0.1', port: 0 });
  const db = new Database(join(dataRoot, 'db', 'nami.sqlite'));
  t.after(() => db.close());
  const event = randomUUID();
  const otherEvent = randomUUID();
  const cookies: string[] = [];
  const actors: string[] = [];
  for (const role of ['organizer', 'contributor', 'contributor', 'viewer']) {
    const actor = randomUUID();
    actors.push(actor);
    db.prepare('INSERT INTO actors VALUES (?, ?, ?, ?, ?)').run(actor, role === 'organizer' ? 'organizer' : 'guest', 'Fixture', role === 'organizer' ? 'unused' : null, Date.now());
    const token = randomUUID();
    cookies.push(`nami_session=${token}`);
    db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?)').run(createHash('sha256').update(token).digest('hex'), actor, Date.now(), Date.now() + 600_000);
    if (role === 'organizer') {
      for (const id of [event, otherEvent]) db.prepare('INSERT INTO events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, actor, 'Fixture', '', '2026-10-19', null, null, Date.now(), Date.now());
    }
    db.prepare('INSERT INTO event_access VALUES (?, ?, ?, ?)').run(actor, event, role, Date.now());
    db.prepare('INSERT INTO event_access VALUES (?, ?, ?, ?)').run(actor, otherEvent, role, Date.now());
  }
  const collection = `/api/events/${event}/uploads`;
  const call = (path: string, method: string, actor = 1, headers: Record<string, string> = {}, body?: string) => fetch(`${base}${path}`, {
    method, headers: { origin: base, cookie: cookies[actor], 'Tus-Resumable': '1.0.0', ...headers }, body,
  });
  const create = () => call(collection, 'POST', 1, { 'Upload-Length': '11' });
  const created = await create();
  assert.equal(created.status, 201, await created.text());
  const location = created.headers.get('location')!;
  assert.ok(location.startsWith(collection));
  const id = location.split('/').at(-1)!;
  assert.equal((await stat(join(dataRoot, 'uploads', id))).mode & 0o777, 0o600);
  assert.equal((await call(location, 'GET')).status, 404);
  for (const method of ['HEAD', 'DELETE', 'PATCH']) {
    const headers: Record<string, string> = method === 'PATCH' ? { 'Content-Type': 'application/offset+octet-stream', 'Upload-Offset': '0' } : {};
    assert.equal((await call(location, method, 2, headers)).status, 404);
    assert.equal((await call(location, method, 3, headers)).status, 403);
    assert.equal((await call(location.replace(event, otherEvent), method, 1, headers)).status, 404);
    assert.equal((await call(location, method, 1, { ...headers, origin: 'http://elsewhere.test' })).status, 403);
  }
  const patch = (offset: number, body: string) => call(location, 'PATCH', 1, { 'Content-Type': 'application/offset+octet-stream', 'Upload-Offset': String(offset) }, body);
  // Drop a real HTTP connection in the middle of a declared PATCH body.
  const interrupted = httpRequest(`${base}${location}`, {
    method: 'PATCH', headers: { origin: base, cookie: cookies[1],
      'Tus-Resumable': '1.0.0', 'Upload-Offset': '0',
      'Content-Type': 'application/offset+octet-stream', 'Content-Length': '11' },
  });
  interrupted.on('error', () => {});
  interrupted.write('hello');
  for (let i = 0; i < 100; i++) {
    if ((await stat(join(dataRoot, 'uploads', id))).size === 5) break;
    await delay(10);
  }
  assert.equal((await stat(join(dataRoot, 'uploads', id))).size, 5);
  interrupted.destroy();
  const afterDrop = await call(location, 'HEAD');
  assert.equal(afterDrop.headers.get('upload-offset'), '5');
  assert.equal((await patch(0, 'wrong')).status, 409);
  await app.close();
  app = await buildApp({ dataRoot, webRoot });
  base = await app.listen({ host: '127.0.0.1', port: 0 });
  const resumed = await fetch(`${base}${location}`, { method: 'HEAD', headers: { cookie: cookies[1], 'Tus-Resumable': '1.0.0' } });
  assert.equal(resumed.status, 200);
  assert.equal(resumed.headers.get('upload-offset'), '5');
  assert.equal(resumed.headers.get('upload-length'), '11');
  assert.equal((await patch(5, ' world')).status, 204);
  assert.equal(await readFile(join(dataRoot, 'uploads', id), 'utf8'), 'hello world');
  assert.equal((db.prepare('SELECT count(*) AS count FROM media').get() as { count: number }).count, 0);
  db.prepare('DELETE FROM event_access WHERE actor_id = ? AND event_id = ?').run(actors[1], event);
  assert.equal((await call(location, 'HEAD')).status, 404);
  assert.equal((await call(location, 'DELETE')).status, 404);
  db.prepare('INSERT INTO event_access VALUES (?, ?, ?, ?)').run(actors[1], event, 'contributor', Date.now());
  assert.equal((await call(location, 'DELETE')).status, 204);
  assert.equal((await call(location, 'HEAD')).status, 404);
  assert.deepEqual(await readdir(join(dataRoot, 'uploads')), []);
  assert.equal((await call(collection, 'POST', 1, { 'Upload-Length': String(25 * 1024 * 1024 + 1) })).status, 413);
  assert.equal((await call(collection, 'POST', 1, { 'Upload-Length': '0' })).status, 400);
  const locations = [];
  for (let i = 0; i < 10; i++) {
    const response = await create();
    assert.equal(response.status, 201);
    locations.push(response.headers.get('location')!);
  }
  assert.equal((await create()).status, 429);
  assert.equal((await readdir(join(dataRoot, 'uploads'))).length, 10);
  for (const path of locations) assert.equal((await call(path, 'DELETE')).status, 204);
  assert.deepEqual(await readdir(join(dataRoot, 'uploads')), []);
  assert.deepEqual(db.pragma('foreign_key_check'), []);
});
