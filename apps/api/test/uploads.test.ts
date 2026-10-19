import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, stat, readdir, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import sharp from 'sharp';
import { buildApp } from '../src/app.js';
import { pruneUploads } from '../src/uploads.js';

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
  const create = (size = 11) => call(collection, 'POST', 1, { 'Upload-Length': String(size) });
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
  const jpeg = await sharp({ create: { width: 10, height: 8, channels: 3, background: '#bcbcbc' } }).jpeg().toBuffer();
  const jpegCreate = await create(jpeg.length);
  assert.equal(jpegCreate.status, 201);
  const jpegLocation = jpegCreate.headers.get('location')!;
  const jpegId = jpegLocation.split('/').at(-1)!;
  const jpegPatch = await fetch(`${base}${jpegLocation}`, { method: 'PATCH',
    headers: { origin: base, cookie: cookies[1], 'Tus-Resumable': '1.0.0',
      'Content-Type': 'application/offset+octet-stream', 'Upload-Offset': '0' }, body: jpeg });
  assert.equal(jpegPatch.status, 204);
  await app.close();
  app = await buildApp({ dataRoot, webRoot });
  base = await app.listen({ host: '127.0.0.1', port: 0 });
  const finalize = (path: string, actor = 1) => call(`${path}/finalize`, 'POST', actor,
    { 'Content-Type': 'application/json' }, JSON.stringify({ originalName: 'family.jpg' }));
  assert.equal((await finalize(jpegLocation, 2)).status, 404);
  // Simulate a crash after beginning a copy and before the media row exists.
  await writeFile(join(dataRoot, 'originals', `${jpegId}.jpg`), 'partial');
  await writeFile(join(dataRoot, 'previews', `${jpegId}.jpg`), 'stale preview');
  const published = await finalize(jpegLocation);
  assert.equal(published.status, 201);
  const media = (await published.json()).media;
  assert.equal(media.id, jpegId);
  assert.equal(media.originalName, 'family.jpg');
  assert.equal((await finalize(jpegLocation)).status, 200);
  assert.deepEqual(await readFile(join(dataRoot, 'originals', `${jpegId}.jpg`)), jpeg);
  assert.equal((await readdir(join(dataRoot, 'previews'))).length, 1);
  assert.equal((await readdir(join(dataRoot, 'uploads'))).length, 0);
  assert.equal((db.prepare('SELECT count(*) AS count FROM media').get() as { count: number }).count, 1);
  const listed = await call(`/api/events/${event}/media`, 'GET');
  assert.equal(listed.status, 200);
  assert.equal((await listed.json()).media[0].id, jpegId);
  const invalid = await create(11);
  const invalidLocation = invalid.headers.get('location')!;
  assert.equal((await call(invalidLocation, 'PATCH', 1,
    { 'Content-Type': 'application/offset+octet-stream', 'Upload-Offset': '0' }, 'hello world')).status, 204);
  assert.equal((await finalize(invalidLocation)).status, 415);
  assert.equal((await call(invalidLocation, 'DELETE')).status, 204);
  const staleResponse = await create();
  const staleId = staleResponse.headers.get('location')!.split('/').at(-1)!;
  const freshResponse = await create();
  const freshId = freshResponse.headers.get('location')!.split('/').at(-1)!;
  const staleRecord = db.prepare('SELECT metadata FROM upload_sessions WHERE id = ?').get(staleId) as { metadata: string };
  const old = Date.now() - 8 * 24 * 60 * 60 * 1000;
  db.prepare('UPDATE upload_sessions SET metadata = ? WHERE id = ?')
    .run(JSON.stringify({ ...JSON.parse(staleRecord.metadata), creation_date: new Date(old).toISOString() }), staleId);
  await utimes(join(dataRoot, 'uploads', staleId), old / 1000, old / 1000);
  const orphanId = randomUUID();
  await writeFile(join(dataRoot, 'uploads', orphanId), 'orphan');
  await utimes(join(dataRoot, 'uploads', orphanId), old / 1000, old / 1000);
  assert.equal(await pruneUploads(db, join(dataRoot, 'uploads'), Date.now(), new Set([staleId])), 1);
  assert.equal((await readdir(join(dataRoot, 'uploads'))).length, 2);
  assert.equal(await pruneUploads(db, join(dataRoot, 'uploads')), 1);
  assert.deepEqual(await readdir(join(dataRoot, 'uploads')), [freshId]);
  assert.equal((await stat(join(dataRoot, 'originals', `${jpegId}.jpg`))).size, jpeg.length);
  assert.equal((await call(freshResponse.headers.get('location')!, 'DELETE')).status, 204);
  // Repeated batches must release each slot and publish every original.
  for (let i = 0; i < 100; i++) {
    const response = await create(jpeg.length);
    assert.equal(response.status, 201);
    const path = response.headers.get('location')!;
    const id = path.split('/').at(-1)!;
    const sent = await fetch(`${base}${path}`, { method: 'PATCH',
      headers: { origin: base, cookie: cookies[1], 'Tus-Resumable': '1.0.0',
        'Content-Type': 'application/offset+octet-stream', 'Upload-Offset': '0' }, body: jpeg });
    assert.equal(sent.status, 204);
    assert.equal((await finalize(path)).status, 201);
    assert.deepEqual(await readFile(join(dataRoot, 'originals', `${id}.jpg`)), jpeg);
  }
  assert.equal((db.prepare('SELECT count(*) AS count FROM media').get() as { count: number }).count, 101);
  assert.deepEqual(await readdir(join(dataRoot, 'uploads')), []);
  assert.deepEqual(db.pragma('foreign_key_check'), []);
});
