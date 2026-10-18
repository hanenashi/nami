import Fastify, { LogController } from 'fastify';
import fastifyStatic from '@fastify/static';
import { access, mkdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';

export const dataDirectories = ['db', 'staging', 'originals', 'previews', 'backups'] as const;

export async function buildApp(options: { dataRoot: string; webRoot: string; logger?: boolean }) {
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
  });
  app.addHook('onSend', async (_request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Content-Security-Policy', "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  });
  app.get('/api/health', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return { status: 'ok', service: 'nami' };
  });
  await app.register(fastifyStatic, { root: options.webRoot, dotfiles: 'deny' });
  // Unknown API/data paths must stay 404, rather than receiving the SPA shell.
  return app;
}
