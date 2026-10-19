import multipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, open, rename, stat, unlink } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import sharp from 'sharp';
import { COOKIE_NAME, findSessionActor, requireActor, requireSameOrigin } from './auth.js';
import type { NamiDatabase } from './database.js';

const MAX_JPEG_BYTES = 25 * 1024 * 1024;
const MAX_INPUT_PIXELS = 100_000_000;
const PREVIEW_LONG_EDGE = 1600;

type EventRole = 'organizer' | 'contributor' | 'viewer';

type MediaRow = {
  id: string;
  event_id: string;
  original_name: string;
  size_bytes: number;
  width: number;
  height: number;
  preview_width: number;
  preview_height: number;
  preview_size_bytes: number;
  created_at: number;
  uploader_name: string;
};

class UploadProblem extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
  }
}

function findEventRole(database: NamiDatabase, actorId: string, eventId: string) {
  const row = database.prepare(`
    SELECT role FROM event_access WHERE actor_id = ? AND event_id = ?
  `).get(actorId, eventId) as { role: EventRole } | undefined;
  return row?.role;
}

function mediaQuery() {
  return `
    SELECT media.id, media.event_id, media.original_name, media.size_bytes,
           media.width, media.height, media.preview_width,
           media.preview_height, media.preview_size_bytes, media.created_at,
           actors.display_name AS uploader_name
    FROM media
    JOIN actors ON actors.id = media.uploaded_by
  `;
}

function serializeMedia(row: MediaRow) {
  const base = `/api/events/${encodeURIComponent(row.event_id)}/media/${encodeURIComponent(row.id)}`;
  return {
    id: row.id,
    originalName: row.original_name,
    sizeBytes: row.size_bytes,
    width: row.width,
    height: row.height,
    previewWidth: row.preview_width,
    previewHeight: row.preview_height,
    createdAt: row.created_at,
    uploaderName: row.uploader_name,
    previewPath: `${base}/preview`,
    downloadPath: `${base}/original`,
  };
}

async function removeIfPresent(path: string) {
  try {
    await unlink(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

async function hasJpegSignature(path: string) {
  const handle = await open(path, 'r');
  try {
    const signature = Buffer.alloc(3);
    const { bytesRead } = await handle.read(signature, 0, signature.length, 0);
    return bytesRead === 3 && signature[0] === 0xff && signature[1] === 0xd8 && signature[2] === 0xff;
  } finally {
    await handle.close();
  }
}

export async function registerMedia(
  app: FastifyInstance,
  database: NamiDatabase,
  dataRoot: string,
  secureCookies: boolean,
) {
  await app.register(multipart, {
    limits: { files: 1, fields: 0, parts: 1, fileSize: MAX_JPEG_BYTES },
  });
  const signedIn = requireActor(database);
  const sameOrigin = requireSameOrigin(secureCookies);

  app.get<{ Params: { eventId: string } }>('/api/events/:eventId/media', {
    preHandler: signedIn,
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!findEventRole(database, request.namiActor!.id, request.params.eventId)) {
      return reply.code(404).send({ error: 'Event not found.' });
    }
    const rows = database.prepare(`${mediaQuery()}
      WHERE media.event_id = ?
      ORDER BY media.created_at DESC, media.id DESC
    `).all(request.params.eventId) as MediaRow[];
    return { media: rows.map(serializeMedia) };
  });

  app.post<{ Params: { eventId: string } }>('/api/events/:eventId/media', {
    preHandler: [sameOrigin, signedIn],
    config: { rateLimit: { max: 10, timeWindow: '1 minute', groupId: 'jpeg-upload' } },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const role = findEventRole(database, request.namiActor!.id, request.params.eventId);
    if (!role) return reply.code(404).send({ error: 'Event not found.' });
    if (role === 'viewer') return reply.code(403).send({ error: 'This invitation can view photos but cannot add them.' });

    const mediaId = randomUUID();
    const stagingPath = join(dataRoot, 'staging', `${mediaId}.upload`);
    const previewStagingPath = join(dataRoot, 'staging', `${mediaId}.preview`);
    const originalPath = join(dataRoot, 'originals', `${mediaId}.jpg`);
    const previewPath = join(dataRoot, 'previews', `${mediaId}.jpg`);
    let sizeBytes = 0;
    let originalName = 'photo.jpg';
    let committed = false;
    const hash = createHash('sha256');
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        sizeBytes += chunk.length;
        hash.update(chunk);
        callback(null, chunk);
      },
    });

    try {
      let received = false;
      for await (const part of request.parts()) {
        if (part.type !== 'file' || part.fieldname !== 'photo' || received) {
          throw new UploadProblem(400, 'Choose one JPEG to upload.');
        }
        received = true;
        originalName = basename(part.filename.replaceAll('\\', '/') || 'photo.jpg').slice(0, 255);
        await pipeline(part.file, meter, createWriteStream(stagingPath, { flags: 'wx', mode: 0o600 }));
        if (part.file.truncated) throw new UploadProblem(413, 'That JPEG is larger than the 25 MB limit.');
      }
      if (!received) throw new UploadProblem(400, 'Choose one JPEG to upload.');
      if (sizeBytes === 0) throw new UploadProblem(400, 'That file is empty.');
      if (!await hasJpegSignature(stagingPath)) throw new UploadProblem(415, 'That file is not a valid JPEG.');

      let metadata;
      try {
        metadata = await sharp(stagingPath, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
      } catch {
        throw new UploadProblem(415, 'That file is not a valid JPEG.');
      }
      if (metadata.format !== 'jpeg' || !metadata.width || !metadata.height) {
        throw new UploadProblem(415, 'That file is not a valid JPEG.');
      }

      const previewHandle = await open(previewStagingPath, 'wx', 0o600);
      await previewHandle.close();
      let preview;
      try {
        preview = await sharp(stagingPath, { limitInputPixels: MAX_INPUT_PIXELS })
          .rotate()
          .resize({ width: PREVIEW_LONG_EDGE, height: PREVIEW_LONG_EDGE, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 82, mozjpeg: true })
          .toFile(previewStagingPath);
      } catch {
        throw new UploadProblem(415, 'NAMI could not make a safe preview from that JPEG.');
      }
      await chmod(previewStagingPath, 0o600);
      await rename(stagingPath, originalPath);
      await rename(previewStagingPath, previewPath);

      const createdAt = Date.now();
      // No asynchronous work between this authorization check and the insert.
      const actor = findSessionActor(database, request.cookies[COOKIE_NAME]);
      const currentRole = actor && findEventRole(database, actor.id, request.params.eventId);
      if (!actor || actor.id !== request.namiActor!.id || !currentRole || currentRole === 'viewer') {
        throw new UploadProblem(403, 'Your access changed before the photo was saved.');
      }
      database.prepare(`
        INSERT INTO media (
          id, event_id, uploaded_by, original_name, media_type, size_bytes,
          sha256, width, height, preview_width, preview_height,
          preview_size_bytes, created_at
        ) VALUES (?, ?, ?, ?, 'image/jpeg', ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        mediaId, request.params.eventId, request.namiActor!.id, originalName,
        sizeBytes, hash.digest('hex'), metadata.width, metadata.height,
        preview.width, preview.height, preview.size, createdAt,
      );
      committed = true;
      const row = database.prepare(`${mediaQuery()} WHERE media.id = ?`).get(mediaId) as MediaRow;
      return reply.code(201).send({ media: serializeMedia(row) });
    } catch (error) {
      if (!committed) await Promise.all([
        removeIfPresent(stagingPath),
        removeIfPresent(previewStagingPath),
        removeIfPresent(originalPath),
        removeIfPresent(previewPath),
      ]);
      if (error instanceof app.multipartErrors.RequestFileTooLargeError) {
        return reply.code(413).send({ error: 'That JPEG is larger than the 25 MB limit.' });
      }
      if (error instanceof app.multipartErrors.FilesLimitError || error instanceof app.multipartErrors.PartsLimitError || error instanceof app.multipartErrors.FieldsLimitError) {
        return reply.code(400).send({ error: 'Choose one JPEG at a time.' });
      }
      if (error instanceof UploadProblem) return reply.code(error.statusCode).send({ error: error.message });
      throw error;
    }
  });

  function findAuthorizedMedia(actorId: string, eventId: string, mediaId: string) {
    if (!findEventRole(database, actorId, eventId)) return undefined;
    return database.prepare(`${mediaQuery()}
      WHERE media.id = ? AND media.event_id = ?
    `).get(mediaId, eventId) as MediaRow | undefined;
  }

  app.get<{ Params: { eventId: string; mediaId: string } }>('/api/events/:eventId/media/:mediaId/preview', {
    preHandler: signedIn,
  }, async (request, reply) => {
    const row = findAuthorizedMedia(request.namiActor!.id, request.params.eventId, request.params.mediaId);
    if (!row) return reply.code(404).send({ error: 'Photo not found.' });
    reply.header('Cache-Control', 'private, no-store');
    reply.header('Content-Length', row.preview_size_bytes);
    reply.type('image/jpeg');
    return reply.send(createReadStream(join(dataRoot, 'previews', `${row.id}.jpg`)));
  });

  app.get<{ Params: { eventId: string; mediaId: string } }>('/api/events/:eventId/media/:mediaId/original', {
    preHandler: signedIn,
  }, async (request, reply) => {
    const row = findAuthorizedMedia(request.namiActor!.id, request.params.eventId, request.params.mediaId);
    if (!row) return reply.code(404).send({ error: 'Photo not found.' });
    const file = await stat(join(dataRoot, 'originals', `${row.id}.jpg`));
    if (file.size !== row.size_bytes) throw new Error('Stored original size does not match its database record.');
    reply.header('Cache-Control', 'private, no-store');
    reply.header('Content-Length', row.size_bytes);
    reply.header('Content-Disposition', `attachment; filename="nami-${row.id}.jpg"`);
    reply.type('image/jpeg');
    return reply.send(createReadStream(join(dataRoot, 'originals', `${row.id}.jpg`)));
  });
}
