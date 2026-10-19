import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import type { NamiDatabase } from './database.js';

export const COOKIE_NAME = 'nami_session';
const SESSION_SECONDS = 60 * 60 * 24 * 7;
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 256;
const SCRYPT_N = 32_768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LENGTH = 64;
const SETUP_ATTEMPTS_PER_MINUTE = 5;
const LOGIN_ATTEMPTS_PER_MINUTE = 15;

type Organizer = { id: string; display_name: string; password_hash: string };
export type SessionActor = { id: string; kind: 'organizer' | 'guest' | 'member'; display_name: string };
type SetupBody = { displayName: string; password: string };
type LoginBody = { password: string };

const authBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['password'],
  properties: {
    password: { type: 'string', minLength: 1, maxLength: PASSWORD_MAX_LENGTH },
  },
} as const;

const setupBodySchema = {
  ...authBodySchema,
  required: ['displayName', 'password'],
  properties: {
    displayName: { type: 'string', minLength: 1, maxLength: 80 },
    password: { type: 'string', minLength: PASSWORD_MIN_LENGTH, maxLength: PASSWORD_MAX_LENGTH },
  },
} as const;

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function deriveKey(password: string, salt: Buffer) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, SCRYPT_KEY_LENGTH, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
      maxmem: 64 * 1024 * 1024,
    }, (error, key) => error ? reject(error) : resolve(key));
  });
}

export async function hashOrganizerPassword(password: string) {
  const length = Array.from(password).length;
  if (length < PASSWORD_MIN_LENGTH || length > PASSWORD_MAX_LENGTH) {
    throw new Error(`The passphrase must be ${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} characters long.`);
  }
  const salt = randomBytes(16);
  const key = await deriveKey(password, salt);
  return ['scrypt', SCRYPT_N, SCRYPT_R, SCRYPT_P, salt.toString('base64url'), key.toString('base64url')].join('$');
}

export async function verifyPassword(password: string, encoded: string) {
  const [algorithm, n, r, p, salt, expected] = encoded.split('$');
  if (algorithm !== 'scrypt' || !n || !r || !p || !salt || !expected) return false;
  const expectedBuffer = Buffer.from(expected, 'base64url');
  const actual = await new Promise<Buffer>((resolve, reject) => {
    scrypt(password, Buffer.from(salt, 'base64url'), expectedBuffer.length, {
      N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024,
    }, (error, key) => error ? reject(error) : resolve(key));
  });
  return actual.length === expectedBuffer.length && timingSafeEqual(actual, expectedBuffer);
}

function findOrganizer(database: NamiDatabase) {
  return database.prepare("SELECT id, display_name, password_hash FROM actors WHERE kind = 'organizer'").get() as Organizer | undefined;
}

export function findSessionActor(database: NamiDatabase, token: string | undefined) {
  if (!token) return undefined;
  const now = Date.now();
  database.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
  return database.prepare(`
    SELECT actors.id, actors.kind, actors.display_name
    FROM sessions JOIN actors ON actors.id = sessions.actor_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
  `).get(hashToken(token), now) as SessionActor | undefined;
}

export function issueSession(database: NamiDatabase, reply: FastifyReply, actorId: string, secureCookies: boolean) {
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  database.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
  database.prepare('INSERT INTO sessions (token_hash, actor_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(hashToken(token), actorId, now, now + SESSION_SECONDS * 1000);
  reply.setCookie(COOKIE_NAME, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'strict',
    secure: secureCookies,
    maxAge: SESSION_SECONDS,
  });
}

export function requireSameOrigin(secureCookies: boolean) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const origin = request.headers.origin;
    const host = request.headers.host;
    const expected = host ? `${secureCookies ? 'https' : 'http'}://${host}` : undefined;
    if (!origin || origin !== expected) {
      return reply.code(403).send({ error: 'This request did not come from NAMI.' });
    }
  };
}

export function requireOrganizer(database: NamiDatabase) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const actor = findSessionActor(database, request.cookies[COOKIE_NAME]);
    if (!actor || actor.kind !== 'organizer') {
      reply.header('Cache-Control', 'no-store');
      return reply.code(401).send({ error: 'Please sign in as the organizer.' });
    }
    request.namiActor = actor;
  };
}

export function requireActor(database: NamiDatabase) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const actor = findSessionActor(database, request.cookies[COOKIE_NAME]);
    if (!actor) {
      reply.header('Cache-Control', 'no-store');
      return reply.code(401).send({ error: 'This session is no longer active.' });
    }
    request.namiActor = actor;
  };
}

declare module 'fastify' {
  interface FastifyRequest {
    namiActor?: SessionActor;
  }
}

export async function registerAuth(app: FastifyInstance, database: NamiDatabase, secureCookies: boolean) {
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  const sameOrigin = requireSameOrigin(secureCookies);

  app.get('/api/auth/status', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const organizer = findOrganizer(database);
    const actor = findSessionActor(database, request.cookies[COOKIE_NAME]);
    const signedInOrganizer = actor?.kind === 'organizer' ? actor : undefined;
    return {
      setupRequired: !organizer,
      authenticated: Boolean(signedInOrganizer),
      organizer: signedInOrganizer ? { displayName: signedInOrganizer.display_name } : null,
    };
  });

  app.post<{ Body: SetupBody }>('/api/auth/setup', {
    schema: { body: setupBodySchema },
    preHandler: sameOrigin,
    config: { rateLimit: { max: SETUP_ATTEMPTS_PER_MINUTE, timeWindow: '1 minute', groupId: 'organizer-setup' } },
  }, async (request, reply) => {
    if (findOrganizer(database)) return reply.code(409).send({ error: 'NAMI has already been set up.' });
    const displayName = request.body.displayName.trim();
    if (!displayName) return reply.code(400).send({ error: 'Please enter your name.' });
    const passwordHash = await hashOrganizerPassword(request.body.password);
    const actorId = randomUUID();
    try {
      database.prepare(`
        INSERT INTO actors (id, kind, display_name, password_hash, created_at)
        VALUES (?, 'organizer', ?, ?, ?)
      `).run(actorId, displayName, passwordHash, Date.now());
    } catch (error) {
      if (findOrganizer(database)) return reply.code(409).send({ error: 'NAMI has already been set up.' });
      throw error;
    }
    issueSession(database, reply, actorId, secureCookies);
    return reply.code(201).send({ authenticated: true, organizer: { displayName } });
  });

  app.post<{ Body: LoginBody }>('/api/auth/login', {
    schema: { body: authBodySchema },
    preHandler: sameOrigin,
    config: { rateLimit: { max: LOGIN_ATTEMPTS_PER_MINUTE, timeWindow: '1 minute', groupId: 'organizer-login' } },
  }, async (request, reply) => {
    const organizer = findOrganizer(database);
    if (!organizer) return reply.code(409).send({ error: 'NAMI still needs to be set up.' });
    if (!await verifyPassword(request.body.password, organizer.password_hash)) {
      return reply.code(401).send({ error: 'That passphrase didn’t work.' });
    }
    // A host-side reset may have changed the hash while scrypt was running.
    const current = findOrganizer(database);
    if (!current || current.id !== organizer.id || current.password_hash !== organizer.password_hash) {
      return reply.code(401).send({ error: 'That passphrase didn’t work.' });
    }
    issueSession(database, reply, organizer.id, secureCookies);
    return { authenticated: true, organizer: { displayName: organizer.display_name } };
  });

  app.post('/api/auth/logout', { preHandler: sameOrigin }, async (request, reply) => {
    const token = request.cookies[COOKIE_NAME];
    if (token) database.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
    reply.clearCookie(COOKIE_NAME, { path: '/', httpOnly: true, sameSite: 'strict', secure: secureCookies });
    return reply.code(204).send();
  });
}
