import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { buildApp, dataDirectories } from '../src/app.js';
import { openDatabase } from '../src/database.js';

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
  const invitationShell = await app.inject('/invite/fixture-secret');
  assert.equal(invitationShell.statusCode, 200);
  assert.equal(invitationShell.headers['cache-control'], 'no-store');
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

test('organizer event access is enforced and events persist', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'nami-events-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dataRoot = join(root, 'data');
  const webRoot = join(root, 'web');
  await mkdir(webRoot);
  await writeFile(join(webRoot, 'index.html'), '<!doctype html><title>NAMI fixture</title>');
  let app = await buildApp({ dataRoot, webRoot });
  const sameOriginHeaders = { host: 'nami.test', origin: 'http://nami.test' };

  assert.equal((await app.inject('/api/events')).statusCode, 401);
  const setup = await app.inject({
    method: 'POST', url: '/api/auth/setup', headers: sameOriginHeaders,
    payload: { displayName: 'Organizer', password: 'a long test passphrase' },
  });
  const sessionCookie = String(setup.headers['set-cookie']).split(';', 1)[0];
  const authenticatedHeaders = { ...sameOriginHeaders, cookie: sessionCookie };

  const crossOrigin = await app.inject({
    method: 'POST', url: '/api/events',
    headers: { host: 'nami.test', origin: 'http://elsewhere.test', cookie: sessionCookie },
    payload: { title: 'Private gathering', startDate: '2026-10-19' },
  });
  assert.equal(crossOrigin.statusCode, 403);
  const impossibleDate = await app.inject({
    method: 'POST', url: '/api/events', headers: authenticatedHeaders,
    payload: { title: 'Private gathering', startDate: '2026-02-30' },
  });
  assert.equal(impossibleDate.statusCode, 400);
  const reversedDates = await app.inject({
    method: 'POST', url: '/api/events', headers: authenticatedHeaders,
    payload: { title: 'Private gathering', startDate: '2026-10-20', endDate: '2026-10-19' },
  });
  assert.equal(reversedDates.statusCode, 400);

  const created = await app.inject({
    method: 'POST', url: '/api/events', headers: authenticatedHeaders,
    payload: {
      title: '  Autumn lunch  ',
      description: '  Soup, stories, and photographs.  ',
      startDate: '2026-10-19',
      endDate: '2026-10-20',
      timezone: 'Asia/Tokyo',
    },
  });
  assert.equal(created.statusCode, 201);
  assert.equal(created.json().event.title, 'Autumn lunch');
  assert.equal(created.json().event.description, 'Soup, stories, and photographs.');
  const eventId = created.json().event.id as string;

  const list = await app.inject({ url: '/api/events', headers: { cookie: sessionCookie } });
  assert.equal(list.statusCode, 200);
  assert.equal(list.headers['cache-control'], 'no-store');
  assert.deepEqual(list.json().events.map((event: { id: string }) => event.id), [eventId]);
  const detail = await app.inject({ url: `/api/events/${eventId}`, headers: { cookie: sessionCookie } });
  assert.equal(detail.statusCode, 200);
  assert.equal(detail.json().event.timezone, 'Asia/Tokyo');
  assert.equal((await app.inject({ url: '/api/events/not-a-real-event', headers: { cookie: sessionCookie } })).statusCode, 404);

  const database = new Database(join(dataRoot, 'db', 'nami.sqlite'), { readonly: true });
  const access = database.prepare(`
    SELECT events.owner_id, event_access.actor_id, event_access.role
    FROM events JOIN event_access ON event_access.event_id = events.id
    WHERE events.id = ?
  `).get(eventId) as { owner_id: string; actor_id: string; role: string };
  database.close();
  assert.equal(access.owner_id, access.actor_id);
  assert.equal(access.role, 'organizer');

  await app.close();
  app = await buildApp({ dataRoot, webRoot });
  t.after(() => app.close());
  assert.equal((await app.inject('/api/events')).statusCode, 401);
  const persisted = await app.inject({ url: `/api/events/${eventId}`, headers: { cookie: sessionCookie } });
  assert.equal(persisted.statusCode, 200);
  assert.equal(persisted.json().event.title, 'Autumn lunch');
});

test('legacy organizer data migrates to guest-capable actors without changing ownership', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'nami-migration-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dataRoot = join(root, 'data');
  await mkdir(join(dataRoot, 'db'), { recursive: true });
  const path = join(dataRoot, 'db', 'nami.sqlite');
  const legacy = new Database(path);
  legacy.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE actors (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('organizer')),
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX one_organizer ON actors (kind) WHERE kind = 'organizer';
    CREATE TABLE sessions (
      token_hash TEXT PRIMARY KEY,
      actor_id TEXT NOT NULL REFERENCES actors(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE events (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES actors(id) ON DELETE RESTRICT,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      start_date TEXT NOT NULL,
      end_date TEXT,
      timezone TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE event_access (
      actor_id TEXT NOT NULL REFERENCES actors(id) ON DELETE CASCADE,
      event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('organizer', 'contributor', 'viewer')),
      created_at INTEGER NOT NULL,
      PRIMARY KEY (actor_id, event_id)
    );
    INSERT INTO actors VALUES ('organizer-1', 'organizer', 'Existing organizer', 'fixture-hash', 1);
    INSERT INTO sessions VALUES ('fixture-token-hash', 'organizer-1', 1, 9999999999999);
    INSERT INTO events VALUES ('event-1', 'organizer-1', 'Existing event', '', '2026-10-19', NULL, NULL, 1, 1);
    INSERT INTO event_access VALUES ('organizer-1', 'event-1', 'organizer', 1);
  `);
  legacy.close();

  const migrated = openDatabase(dataRoot);
  assert.equal(migrated.pragma('foreign_keys', { simple: true }), 1);
  assert.deepEqual(migrated.pragma('foreign_key_check'), []);
  const migratedEvent = migrated.prepare('SELECT title FROM events WHERE owner_id = ?').get('organizer-1') as { title: string };
  const migratedSessions = migrated.prepare('SELECT COUNT(*) AS count FROM sessions WHERE actor_id = ?').get('organizer-1') as { count: number };
  assert.equal(migratedEvent.title, 'Existing event');
  assert.equal(migratedSessions.count, 1);
  migrated.prepare(`
    INSERT INTO actors (id, kind, display_name, password_hash, created_at)
    VALUES ('guest-1', 'guest', 'Guest', NULL, 2)
  `).run();
  const migratedGuests = migrated.prepare("SELECT COUNT(*) AS count FROM actors WHERE kind = 'guest'").get() as { count: number };
  assert.equal(migratedGuests.count, 1);
  assert.throws(() => migrated.prepare(`
    INSERT INTO actors (id, kind, display_name, password_hash, created_at)
    VALUES ('organizer-2', 'organizer', 'Another organizer', 'fixture-hash', 2)
  `).run());
  migrated.close();
});

test('invitation redemption is event-scoped, repeatable and revocable', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'nami-invitations-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dataRoot = join(root, 'data');
  const webRoot = join(root, 'web');
  await mkdir(webRoot);
  await writeFile(join(webRoot, 'index.html'), '<!doctype html><title>NAMI fixture</title>');
  const app = await buildApp({ dataRoot, webRoot });
  t.after(() => app.close());
  const sameOriginHeaders = { host: 'nami.test', origin: 'http://nami.test' };
  const setup = await app.inject({
    method: 'POST', url: '/api/auth/setup', headers: sameOriginHeaders,
    payload: { displayName: 'Organizer', password: 'a long test passphrase' },
  });
  const organizerCookie = String(setup.headers['set-cookie']).split(';', 1)[0];
  const organizerHeaders = { ...sameOriginHeaders, cookie: organizerCookie };

  async function createEvent(title: string, startDate: string) {
    const response = await app.inject({
      method: 'POST', url: '/api/events', headers: organizerHeaders,
      payload: { title, startDate },
    });
    assert.equal(response.statusCode, 201);
    return response.json().event.id as string;
  }

  const eventA = await createEvent('Event A', '2026-10-19');
  const eventB = await createEvent('Event B', '2026-10-20');
  const created = await app.inject({
    method: 'POST', url: `/api/events/${eventA}/invitations`, headers: organizerHeaders,
    payload: { role: 'viewer', expiresInDays: 30 },
  });
  assert.equal(created.statusCode, 201);
  assert.equal(created.headers['cache-control'], 'no-store');
  const invitationId = created.json().invitation.id as string;
  const invitePath = created.json().invitePath as string;
  const secret = invitePath.split('/').at(-1)!;
  assert.match(secret, /^[A-Za-z0-9_-]{43}$/);

  const database = new Database(join(dataRoot, 'db', 'nami.sqlite'));
  const stored = database.prepare('SELECT secret_hash FROM invitations WHERE id = ?').get(invitationId) as { secret_hash: string };
  assert.equal(stored.secret_hash.length, 64);
  assert.notEqual(stored.secret_hash, secret);
  database.close();
  assert.equal((await readFile(join(dataRoot, 'db', 'nami.sqlite'))).includes(secret), false);

  const preview = await app.inject(`/api/invitations/${secret}`);
  assert.equal(preview.statusCode, 200);
  assert.equal(preview.headers['cache-control'], 'no-store');
  assert.equal(preview.json().invitation.event.title, 'Event A');
  assert.equal(preview.json().invitation.redeemedAs, null);
  const missingName = await app.inject({
    method: 'POST', url: `/api/invitations/${secret}/redeem`, headers: sameOriginHeaders, payload: {},
  });
  assert.equal(missingName.statusCode, 400);

  const redeemed = await app.inject({
    method: 'POST', url: `/api/invitations/${secret}/redeem`, headers: sameOriginHeaders,
    payload: { nickname: 'Aunt May' },
  });
  assert.equal(redeemed.statusCode, 200);
  assert.equal(redeemed.json().access.role, 'viewer');
  const guestCookie = String(redeemed.headers['set-cookie']).split(';', 1)[0];
  assert.ok(guestCookie.startsWith('nami_session='));
  assert.equal((await app.inject({ url: `/api/events/${eventA}`, headers: { cookie: guestCookie } })).json().access.role, 'viewer');
  assert.equal((await app.inject({ url: `/api/events/${eventB}`, headers: { cookie: guestCookie } })).statusCode, 404);
  assert.equal((await app.inject({ url: '/api/events', headers: { cookie: guestCookie } })).statusCode, 401);
  assert.equal((await app.inject({
    method: 'POST', url: '/api/events', headers: { ...sameOriginHeaders, cookie: guestCookie },
    payload: { title: 'Guest event', startDate: '2026-10-21' },
  })).statusCode, 401);
  const guestAuthStatus = await app.inject({ url: '/api/auth/status', headers: { cookie: guestCookie } });
  assert.equal(guestAuthStatus.json().authenticated, false);

  const repeat = await app.inject({
    method: 'POST', url: `/api/invitations/${secret}/redeem`, headers: sameOriginHeaders, payload: {},
  });
  assert.equal(repeat.statusCode, 200);
  assert.equal(repeat.json().access.displayName, 'Aunt May');
  const invitations = await app.inject({ url: `/api/events/${eventA}/invitations`, headers: { cookie: organizerCookie } });
  assert.equal(invitations.json().invitations[0].status, 'redeemed');
  assert.equal(invitations.json().invitations[0].redemptionCount, 2);

  const revoked = await app.inject({
    method: 'POST', url: `/api/events/${eventA}/invitations/${invitationId}/revoke`, headers: organizerHeaders,
  });
  assert.equal(revoked.statusCode, 204);
  assert.equal((await app.inject({ url: `/api/events/${eventA}`, headers: { cookie: guestCookie } })).statusCode, 401);
  assert.equal((await app.inject(`/api/invitations/${secret}`)).statusCode, 410);
  assert.equal((await app.inject({
    method: 'POST', url: `/api/invitations/${secret}/redeem`, headers: sameOriginHeaders, payload: {},
  })).statusCode, 410);

  const contributor = await app.inject({
    method: 'POST', url: `/api/events/${eventA}/invitations`, headers: organizerHeaders,
    payload: { role: 'contributor' },
  });
  const contributorSecret = (contributor.json().invitePath as string).split('/').at(-1)!;
  const contributorRedeemed = await app.inject({
    method: 'POST', url: `/api/invitations/${contributorSecret}/redeem`, headers: sameOriginHeaders,
    payload: { nickname: 'Cousin Sam' },
  });
  assert.equal(contributorRedeemed.json().access.role, 'contributor');

  const expiring = await app.inject({
    method: 'POST', url: `/api/events/${eventA}/invitations`, headers: organizerHeaders,
    payload: { role: 'viewer', expiresInDays: 7 },
  });
  const expiredSecret = (expiring.json().invitePath as string).split('/').at(-1)!;
  const writableDatabase = new Database(join(dataRoot, 'db', 'nami.sqlite'));
  writableDatabase.prepare('UPDATE invitations SET expires_at = ? WHERE id = ?').run(Date.now() - 1, expiring.json().invitation.id);
  writableDatabase.close();
  assert.equal((await app.inject(`/api/invitations/${expiredSecret}`)).statusCode, 410);
});
