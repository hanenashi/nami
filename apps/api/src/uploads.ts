import { Server, Upload } from '@tus/server';
import { FileStore, type Configstore } from '@tus/file-store';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { mkdir, open, readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { COOKIE_NAME, findSessionActor, requireActor, requireSameOrigin } from './auth.js';
import { publishStagedJpeg, serializeMedia, UploadProblem } from './media.js';
import type { NamiDatabase } from './database.js';

const MAX_BYTES = 25 * 1024 * 1024;
const MAX_SESSIONS = 10;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const ORPHAN_GRACE_MS = 60 * 60 * 1000;
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const route = new RegExp(`^/api/events/(${uuid})/uploads(?:/(${uuid}))?$`);
const problem = (status_code: number, body: string) => ({ status_code, body });
type Session = { actor_id: string; event_id: string; metadata: string };

export async function pruneUploads(db: NamiDatabase, directory: string, now = Date.now(), busy = new Set<string>()) {
  const sessions = db.prepare('SELECT id, metadata FROM upload_sessions').all() as { id: string; metadata: string }[];
  const active = new Set(sessions.map(row => row.id));
  let removed = 0;
  for (const session of sessions) {
    if (busy.has(session.id)) continue;
    const path = join(directory, session.id);
    let modifiedAt = 0;
    try { modifiedAt = (await stat(path)).mtimeMs; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const createdAt = Date.parse((JSON.parse(session.metadata) as { creation_date?: string }).creation_date ?? '');
    if (!Number.isFinite(createdAt) || Math.max(createdAt, modifiedAt) >= now - RETENTION_MS) continue;
    // Drop the ledger row first. A crash after this leaves only an orphan file,
    // which the second pass can remove after its grace period.
    db.prepare('DELETE FROM upload_sessions WHERE id = ?').run(session.id);
    active.delete(session.id);
    try { await unlink(path); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    removed += 1;
  }
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !new RegExp(`^${uuid}$`).test(entry.name) || active.has(entry.name) || busy.has(entry.name)) continue;
    const path = join(directory, entry.name);
    try {
      if ((await stat(path)).mtimeMs < now - ORPHAN_GRACE_MS) {
        await unlink(path);
        removed += 1;
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  return removed;
}

// This first transport increment only stages bytes. JPEG validation and gallery
// publication still use /media until durable finalization is implemented.
export async function registerUploads(app: FastifyInstance, db: NamiDatabase, dataRoot: string, secure: boolean) {
  const directory = join(dataRoot, 'uploads');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const get = (id: string) => db.prepare('SELECT actor_id, event_id, metadata FROM upload_sessions WHERE id = ?').get(id) as Session | undefined;
  const configstore: Configstore = {
    async get(id) {
      const row = get(id);
      return row ? new Upload(JSON.parse(row.metadata)) : undefined;
    },
    async set(id, value) {
      db.transaction(() => {
        const actor = value.metadata?.actor;
        const count = db.prepare('SELECT count(*) AS count FROM upload_sessions WHERE actor_id = ?').get(actor) as { count: number };
        if (count.count >= MAX_SESSIONS) throw problem(429, 'Cancel an existing upload before starting another.');
        db.prepare('INSERT INTO upload_sessions (id, actor_id, event_id, metadata) VALUES (?, ?, ?, ?)')
          .run(id, actor, value.metadata?.event, JSON.stringify(value));
      })();
    },
    async delete(id) { db.prepare('DELETE FROM upload_sessions WHERE id = ?').run(id); },
  };
  class PrivateStore extends FileStore {
    override async create(upload: Upload) {
      const path = join(directory, upload.id);
      const file = await open(path, 'wx', 0o600);
      await file.close();
      try {
        await configstore.set(upload.id, upload);
        upload.storage = { type: 'file', path };
        return upload;
      } catch (error) {
        await unlink(path);
        throw error;
      }
    }
  }
  const store = new PrivateStore({ directory, configstore });
  const finalizing = new Set<string>();
  const inFlight = new Map<string, number>();
  await pruneUploads(db, directory);
  const pruning = setInterval(() => {
    void pruneUploads(db, directory, Date.now(), new Set([...finalizing, ...inFlight.keys()])).catch(error => app.log.error(error));
  }, 60 * 60 * 1000);
  pruning.unref();
  app.addHook('onClose', async () => clearInterval(pruning));
  // Fixed-length, empty creation only. No deferred allocation, concatenation,
  // public GET or expiry promise until lifecycle reconciliation is implemented.
  store.extensions = ['creation', 'termination'];
  function authorize(request: Request, uploadId?: string) {
    const match = route.exec(new URL(request.url).pathname);
    if (!match) throw problem(404, 'Upload not found.');
    const actor = findSessionActor(db, app.parseCookie(request.headers.get('cookie') ?? '')[COOKIE_NAME]);
    if (!actor) throw problem(401, 'This session is no longer active.');
    const access = db.prepare('SELECT role FROM event_access WHERE actor_id = ? AND event_id = ?')
      .get(actor.id, match[1]) as { role: string } | undefined;
    if (!access) throw problem(404, 'Upload not found.');
    if (access.role === 'viewer') throw problem(403, 'This invitation cannot upload photos.');
    if (request.method !== 'POST' && uploadId) {
      const session = get(uploadId);
      if (!session || session.actor_id !== actor.id || session.event_id !== match[1]) throw problem(404, 'Upload not found.');
    }
    return { actor: actor.id, event: match[1] };
  }
  const server = new Server({
    path: '/api/uploads', datastore: store, maxSize: MAX_BYTES, allowedOrigins: [],
    namingFunction: () => randomUUID(),
    getFileIdFromRequest: (request) => route.exec(new URL(request.url).pathname)?.[2],
    generateUrl: (request, { id }) => `/api/events/${authorize(request).event}/uploads/${id}`,
    onIncomingRequest: async (request, id) => { authorize(request, id); },
    onUploadCreate: async (request, upload) => {
      if (!upload.size || request.headers.has('upload-defer-length') || request.headers.has('content-type') || Number(request.headers.get('content-length') ?? 0) !== 0) {
        throw problem(400, 'Create an empty upload with a fixed positive Upload-Length.');
      }
      return { metadata: authorize(request) };
    },
    onUploadFinish: async (request, upload) => { authorize(request, upload.id); return {}; },
  });
  await app.register(async (scope) => {
    scope.addContentTypeParser('application/offset+octet-stream', (_request, _payload, done) => done(null));
    scope.route({
      method: ['POST', 'OPTIONS'], url: '/api/events/:eventId/uploads',
      onRequest: [requireSameOrigin(secure), requireActor(db)],
      handler: async (request, reply) => {
        if (request.method === 'OPTIONS') {
          // OPTIONS does not run Tus's incoming-request hook.
          const headers = new Headers({ cookie: request.headers.cookie ?? '' });
          try { authorize(new Request(`http://localhost${request.url}`, { headers, method: 'OPTIONS' })); }
          catch (error) { const failure = error as ReturnType<typeof problem>; return reply.code(failure.status_code).send({ error: failure.body }); }
        }
        reply.hijack();
        reply.raw.setHeader('Cache-Control', 'no-store');
        reply.raw.setHeader('X-Content-Type-Options', 'nosniff');
        reply.raw.setHeader('Referrer-Policy', 'no-referrer');
        reply.raw.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
        await server.handle(request.raw, reply.raw);
      },
    });
    scope.post<{ Params: { eventId: string; uploadId: string }; Body: { originalName?: string } }>(
      '/api/events/:eventId/uploads/:uploadId/finalize',
      { onRequest: [requireSameOrigin(secure), requireActor(db)], bodyLimit: 1024,
        schema: { body: { type: 'object', required: ['originalName'], additionalProperties: false,
          properties: { originalName: { type: 'string', minLength: 1, maxLength: 255 } } } } },
      async (request, reply) => {
        reply.header('Cache-Control', 'no-store');
        const { eventId, uploadId } = request.params;
        const actorId = request.namiActor!.id;
        const role = db.prepare('SELECT role FROM event_access WHERE actor_id = ? AND event_id = ?')
          .get(actorId, eventId) as { role: string } | undefined;
        if (!role) return reply.code(404).send({ error: 'Upload not found.' });
        if (role.role === 'viewer') return reply.code(403).send({ error: 'This invitation cannot upload photos.' });
        if (!new RegExp(`^${uuid}$`).test(eventId) || !new RegExp(`^${uuid}$`).test(uploadId)) {
          return reply.code(404).send({ error: 'Upload not found.' });
        }
        const existing = db.prepare('SELECT id, event_id, uploaded_by FROM media WHERE id = ?')
          .get(uploadId) as { id: string; event_id: string; uploaded_by: string } | undefined;
        if (existing && existing.event_id === eventId && existing.uploaded_by === actorId) {
          const media = db.prepare(`SELECT media.id, media.event_id, media.original_name,
            media.size_bytes, media.width, media.height, media.preview_width,
            media.preview_height, media.preview_size_bytes, media.created_at,
            actors.display_name AS uploader_name FROM media
            JOIN actors ON actors.id = media.uploaded_by WHERE media.id = ?`).get(uploadId);
          db.prepare('DELETE FROM upload_sessions WHERE id = ?').run(uploadId);
          await unlink(join(directory, uploadId)).catch(() => {});
          return reply.code(200).send({ media: serializeMedia(media as Parameters<typeof serializeMedia>[0]), duplicate: false });
        }
        const session = get(uploadId);
        if (!session || session.actor_id !== actorId || session.event_id !== eventId) {
          return reply.code(404).send({ error: 'Upload not found.' });
        }
        if (finalizing.has(uploadId)) return reply.code(409).send({ error: 'This photo is already being processed.' });
        const expected = new Upload(JSON.parse(session.metadata)).size;
        const path = join(directory, uploadId);
        let size;
        try { size = (await stat(path)).size; }
        catch { return reply.code(409).send({ error: 'The upload file is missing.' }); }
        if (size !== expected) return reply.code(409).send({ error: 'Finish uploading before adding this photo.' });
        finalizing.add(uploadId);
        try {
          const result = await publishStagedJpeg({
            database: db, dataRoot, mediaId: uploadId, stagingPath: path,
            eventId, actorId, originalName: request.body.originalName!,
            stillAuthorized: () => {
              const current = findSessionActor(db, request.cookies[COOKIE_NAME]);
              const access = current && db.prepare('SELECT role FROM event_access WHERE actor_id = ? AND event_id = ?')
                .get(current.id, eventId) as { role: string } | undefined;
              return Boolean(current && current.id === actorId && access && access.role !== 'viewer');
            },
          });
          db.prepare('DELETE FROM upload_sessions WHERE id = ?').run(uploadId);
          await unlink(path).catch(() => {});
          return reply.code(result.duplicate ? 200 : 201).send(result);
        } catch (error) {
          if (error instanceof UploadProblem) return reply.code(error.statusCode).send({ error: error.message });
          throw error;
        } finally { finalizing.delete(uploadId); }
      },
    );
    scope.route({
      method: ['HEAD', 'PATCH', 'DELETE'], url: '/api/events/:eventId/uploads/:uploadId',
      onRequest: [async (request, reply) => {
        // Same-origin browser HEAD requests may omit Origin. It is read-only;
        // cookie authentication and upload ownership are still mandatory.
        if (request.method !== 'HEAD' || request.headers.origin) await requireSameOrigin(secure)(request, reply);
      }, requireActor(db)],
      handler: async (request, reply) => {
        const id = (request.params as { uploadId: string }).uploadId;
        inFlight.set(id, (inFlight.get(id) ?? 0) + 1);
        let released = false;
        const release = () => {
          if (released) return;
          released = true;
          const count = (inFlight.get(id) ?? 1) - 1;
          if (count) inFlight.set(id, count);
          else inFlight.delete(id);
        };
        reply.raw.once('finish', release);
        reply.raw.once('close', release);
        reply.hijack();
        reply.raw.setHeader('Cache-Control', 'no-store');
        reply.raw.setHeader('X-Content-Type-Options', 'nosniff');
        reply.raw.setHeader('Referrer-Policy', 'no-referrer');
        reply.raw.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
        await server.handle(request.raw, reply.raw);
      },
    });
  });
}
