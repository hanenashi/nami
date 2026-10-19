import Fastify, { LogController } from 'fastify';
import fastifyStatic from '@fastify/static';
import { access, mkdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { registerAuth } from './auth.js';
import { openDatabase } from './database.js';
import { registerEvents } from './events.js';
import { registerInvitations } from './invitations.js';
import { registerUploads } from './uploads.js';
import { registerMedia } from './media.js';
import { registerSuperadmin } from './superadmin.js';

export const dataDirectories = ['db', 'staging', 'uploads', 'originals', 'previews', 'backups'] as const;

export async function buildApp(options: { dataRoot: string; webRoot: string; logger?: boolean; secureCookies?: boolean }) {
  // Fail startup if storage is unusable; the entire data tree is separate from static assets.
  await Promise.all(dataDirectories.map(async (directory) => {
    const path = join(options.dataRoot, directory);
    await mkdir(path, { recursive: true, mode: 0o700 });
    await access(path, constants.R_OK | constants.W_OK);
  }));
  await access(join(options.webRoot, 'index.html'), constants.R_OK);

  const app = Fastify({
    logger: options.logger ?? false,
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: 32 * 1024,
  });
  const database = openDatabase(options.dataRoot);
  app.addHook('onClose', async () => database.close());
  app.addHook('onSend', async (_request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Content-Security-Policy', "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  });
  app.get('/api/health', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return { status: 'ok', service: 'nami' };
  });
  await registerAuth(app, database, options.secureCookies ?? false);
  registerSuperadmin(app, database, options.dataRoot, options.secureCookies ?? false);
  registerEvents(app, database, options.dataRoot, options.secureCookies ?? false);
  registerInvitations(app, database, options.secureCookies ?? false);
  await registerMedia(app, database, options.dataRoot, options.secureCookies ?? false);
  await registerUploads(app, database, options.dataRoot, options.secureCookies ?? false);
  await app.register(fastifyStatic, { root: options.webRoot, dotfiles: 'deny' });
  app.get('/organizer', async (_request, reply) => reply.sendFile('index.html'));
  app.get('/superadmin', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return reply.sendFile('index.html', { cacheControl: false });
  });
  app.get('/organizer/events/:eventId', async (_request, reply) => reply.sendFile('index.html'));
  app.get('/invite/:secret', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return reply.sendFile('index.html', { cacheControl: false });
  });
  app.get('/events/:eventId', async (_request, reply) => reply.sendFile('index.html'));
  // Unknown API/data paths must stay 404, rather than receiving the SPA shell.
  return app;
}
