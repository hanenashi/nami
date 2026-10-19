import Database from 'better-sqlite3';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createHash, randomBytes } from 'node:crypto';
import { chmod, mkdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { hashOrganizerPassword, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, requireSameOrigin, verifyPassword } from './auth.js';
import { resetOrganizerPassphrase } from './admin-reset.js';
import type { NamiDatabase } from './database.js';

const COOKIE_NAME = 'nami_superadmin';
const SESSION_SECONDS = 60 * 60 * 24 * 7;
const passwordBody = {
  type: 'object', additionalProperties: false, required: ['password'],
  properties: { password: { type: 'string', minLength: PASSWORD_MIN_LENGTH, maxLength: PASSWORD_MAX_LENGTH } },
} as const;

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function currentHash(database: NamiDatabase) {
  return (database.prepare('SELECT password_hash FROM superadmin WHERE id = 1').get() as { password_hash: string } | undefined)?.password_hash;
}

function canDeleteGuest(database: NamiDatabase, actorId: string) {
  return Boolean(database.prepare(`
    SELECT 1 FROM actors WHERE id = ? AND kind = 'guest'
      AND NOT EXISTS (SELECT 1 FROM event_access WHERE actor_id = actors.id)
      AND NOT EXISTS (SELECT 1 FROM sessions WHERE actor_id = actors.id AND expires_at > ?)
      AND NOT EXISTS (SELECT 1 FROM media WHERE uploaded_by = actors.id)
      AND NOT EXISTS (SELECT 1 FROM upload_sessions WHERE actor_id = actors.id)
      AND NOT EXISTS (SELECT 1 FROM events WHERE owner_id = actors.id)
      AND NOT EXISTS (SELECT 1 FROM invitations WHERE created_by = actors.id)
      AND NOT EXISTS (
        SELECT 1 FROM invitations WHERE actor_id = actors.id
          AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)
      )
  `).get(actorId, Date.now(), Date.now()));
}

async function verifiedBackup(database: NamiDatabase, dataRoot: string, prefix: string, verify: (backup: NamiDatabase) => boolean) {
  const backupDir = join(dataRoot, 'backups');
  await mkdir(backupDir, { recursive: true, mode: 0o700 });
  await chmod(backupDir, 0o700);
  const backupPath = join(backupDir, `${prefix}-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(8).toString('hex')}.sqlite`);
  try {
    await database.backup(backupPath);
    await chmod(backupPath, 0o600);
    const backup = new Database(backupPath, { readonly: true });
    try {
      if (backup.pragma('integrity_check', { simple: true }) !== 'ok' ||
        (backup.pragma('foreign_key_check') as unknown[]).length || !verify(backup)) {
        throw new Error('SQLite backup verification failed. No account was changed.');
      }
    } finally { backup.close(); }
  } catch (error) {
    await unlink(backupPath).catch(() => {});
    throw error;
  }
  return backupPath;
}

function hasSession(database: NamiDatabase, token: string | undefined) {
  if (!token) return false;
  const now = Date.now();
  database.prepare('DELETE FROM superadmin_sessions WHERE expires_at <= ?').run(now);
  return Boolean(database.prepare('SELECT 1 FROM superadmin_sessions WHERE token_hash = ? AND expires_at > ?')
    .get(hashToken(token), now));
}

function requireSuperadmin(database: NamiDatabase) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!hasSession(database, request.cookies[COOKIE_NAME])) {
      reply.header('Cache-Control', 'no-store');
      return reply.code(401).send({ error: 'Please sign in as the superadmin.' });
    }
  };
}

export async function setSuperadminPassphrase(dataRoot: string, passphrase: string) {
  const passwordHash = await hashOrganizerPassword(passphrase);
  const path = join(dataRoot, 'db', 'nami.sqlite');
  if (!await stat(path).then(file => file.isFile(), () => false)) {
    throw new Error('NAMI database not found. Start NAMI once before setting the superadmin passphrase.');
  }
  const database = new Database(path, { fileMustExist: true });
  try {
    database.pragma('busy_timeout = 5000');
    database.pragma('foreign_keys = ON');
    if (database.pragma('integrity_check', { simple: true }) !== 'ok' ||
      (database.pragma('foreign_key_check') as unknown[]).length) {
      throw new Error('Database integrity check failed. No credentials were changed.');
    }
    const previous = currentHash(database);
    const backupPath = await verifiedBackup(database, dataRoot, 'superadmin-before-setup',
      backup => currentHash(backup) === previous);

    database.transaction(() => {
      const current = currentHash(database);
      if (current !== previous) throw new Error('Superadmin credentials changed during setup. No credentials were changed.');
      const now = Date.now();
      if (current) {
        database.prepare('UPDATE superadmin SET password_hash = ?, updated_at = ? WHERE id = 1')
          .run(passwordHash, now);
      } else {
        database.prepare('INSERT INTO superadmin (id, password_hash, created_at, updated_at) VALUES (1, ?, ?, ?)')
          .run(passwordHash, now, now);
      }
      database.prepare('DELETE FROM superadmin_sessions').run();
    })();
    return backupPath;
  } finally { database.close(); }
}

export function registerSuperadmin(app: FastifyInstance, database: NamiDatabase, dataRoot: string, secureCookies: boolean) {
  const sameOrigin = requireSameOrigin(secureCookies);
  const adminOnly = requireSuperadmin(database);

  app.get('/api/superadmin/status', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return { configured: Boolean(currentHash(database)), authenticated: hasSession(database, request.cookies[COOKIE_NAME]) };
  });

  app.post<{ Body: { password: string } }>('/api/superadmin/login', {
    schema: { body: passwordBody }, preHandler: sameOrigin,
    config: { rateLimit: { max: 5, timeWindow: '1 minute', groupId: 'superadmin-login' } },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const hash = currentHash(database);
    if (!hash || !await verifyPassword(request.body.password, hash)) {
      return reply.code(401).send({ error: 'That passphrase didn’t work.' });
    }
    if (currentHash(database) !== hash) return reply.code(401).send({ error: 'That passphrase didn’t work.' });
    const token = randomBytes(32).toString('base64url');
    const now = Date.now();
    database.prepare('INSERT INTO superadmin_sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)')
      .run(hashToken(token), now, now + SESSION_SECONDS * 1000);
    reply.setCookie(COOKIE_NAME, token, {
      path: '/', httpOnly: true, sameSite: 'strict', secure: secureCookies, maxAge: SESSION_SECONDS,
    });
    return { authenticated: true };
  });

  app.post('/api/superadmin/logout', { preHandler: [sameOrigin, adminOnly] }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const token = request.cookies[COOKIE_NAME];
    if (token) database.prepare('DELETE FROM superadmin_sessions WHERE token_hash = ?').run(hashToken(token));
    reply.clearCookie(COOKIE_NAME, { path: '/', httpOnly: true, sameSite: 'strict', secure: secureCookies });
    return reply.code(204).send();
  });

  app.get('/api/superadmin/people', { preHandler: adminOnly }, async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const actors = database.prepare(`
      SELECT actors.id, actors.kind, actors.display_name, actors.created_at,
        (SELECT count(*) FROM sessions WHERE actor_id = actors.id AND expires_at > ?) AS sessions,
        (SELECT count(*) FROM media WHERE uploaded_by = actors.id) AS photos
      FROM actors ORDER BY CASE actors.kind WHEN 'organizer' THEN 0 ELSE 1 END, actors.created_at
    `).all(Date.now()) as { id: string; kind: string; display_name: string; created_at: number; sessions: number; photos: number }[];
    const access = database.prepare(`
      SELECT event_access.actor_id, event_access.event_id, event_access.role, events.title
      FROM event_access JOIN events ON events.id = event_access.event_id
      ORDER BY events.start_date DESC
    `).all() as { actor_id: string; event_id: string; role: string; title: string }[];
    return { people: actors.map(actor => ({
      id: actor.id, kind: actor.kind, displayName: actor.display_name,
      createdAt: actor.created_at, sessions: actor.sessions, photos: actor.photos,
      canPermanentlyDelete: canDeleteGuest(database, actor.id),
      events: access.filter(item => item.actor_id === actor.id).map(item => ({ id: item.event_id, title: item.title, role: item.role })),
    })) };
  });

  app.post<{ Params: { actorId: string } }>('/api/superadmin/people/:actorId/signout', {
    preHandler: [sameOrigin, adminOnly],
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const actor = database.prepare('SELECT id FROM actors WHERE id = ?').get(request.params.actorId);
    if (!actor) return reply.code(404).send({ error: 'Person not found.' });
    database.prepare('DELETE FROM sessions WHERE actor_id = ?').run(request.params.actorId);
    return reply.code(204).send();
  });

  app.post<{ Params: { actorId: string } }>('/api/superadmin/people/:actorId/disable', {
    preHandler: [sameOrigin, adminOnly],
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const actor = database.prepare('SELECT kind FROM actors WHERE id = ?').get(request.params.actorId) as { kind: string } | undefined;
    if (!actor) return reply.code(404).send({ error: 'Person not found.' });
    if (actor.kind !== 'guest') return reply.code(403).send({ error: 'Only guest access can be disabled here.' });
    database.transaction(() => {
      database.prepare('UPDATE invitations SET revoked_at = COALESCE(revoked_at, ?) WHERE actor_id = ?')
        .run(Date.now(), request.params.actorId);
      database.prepare('DELETE FROM event_access WHERE actor_id = ?').run(request.params.actorId);
      database.prepare('DELETE FROM sessions WHERE actor_id = ?').run(request.params.actorId);
    })();
    return reply.code(204).send();
  });

  app.post<{ Params: { actorId: string }; Body: { confirmName: string } }>('/api/superadmin/people/:actorId/delete', {
    schema: { body: { type: 'object', additionalProperties: false, required: ['confirmName'],
      properties: { confirmName: { type: 'string', maxLength: 80 } } } },
    preHandler: [sameOrigin, adminOnly],
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const actor = database.prepare('SELECT kind, display_name FROM actors WHERE id = ?')
      .get(request.params.actorId) as { kind: string; display_name: string } | undefined;
    if (!actor) return reply.code(404).send({ error: 'Person not found.' });
    if (actor.kind !== 'guest') return reply.code(403).send({ error: 'Only inactive guests can be permanently deleted.' });
    if (actor.display_name !== request.body.confirmName) {
      return reply.code(400).send({ error: 'The confirmation name did not match.' });
    }
    if (!canDeleteGuest(database, request.params.actorId)) {
      return reply.code(409).send({ error: 'This guest still has access, a session, photos, an invitation, or an unfinished upload.' });
    }
    await verifiedBackup(database, dataRoot, 'guest-before-delete', backup =>
      Boolean(backup.prepare('SELECT 1 FROM actors WHERE id = ? AND kind = ? AND display_name = ?')
        .get(request.params.actorId, 'guest', actor.display_name)));
    database.transaction(() => {
      const current = database.prepare('SELECT display_name FROM actors WHERE id = ? AND kind = ?')
        .get(request.params.actorId, 'guest') as { display_name: string } | undefined;
      if (current?.display_name !== actor.display_name || !canDeleteGuest(database, request.params.actorId)) {
        throw new Error('Guest state changed during deletion. No account was deleted.');
      }
      database.prepare('DELETE FROM invitations WHERE actor_id = ?').run(request.params.actorId);
      database.prepare('DELETE FROM sessions WHERE actor_id = ?').run(request.params.actorId);
      const deleted = database.prepare("DELETE FROM actors WHERE id = ? AND kind = 'guest'").run(request.params.actorId);
      if (deleted.changes !== 1) throw new Error('Guest state changed during deletion. No account was deleted.');
    })();
    return reply.code(204).send();
  });

  app.post<{ Body: { password: string } }>('/api/superadmin/organizer/reset', {
    schema: { body: passwordBody }, preHandler: [sameOrigin, adminOnly],
    config: { rateLimit: { max: 5, timeWindow: '1 hour', groupId: 'superadmin-reset' } },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    await resetOrganizerPassphrase(dataRoot, request.body.password);
    return { reset: true, backupCreated: true };
  });
}
