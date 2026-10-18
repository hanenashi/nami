import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { buildApp } from './app.js';

const port = Number(process.env.PORT ?? '3000');
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535');

const app = await buildApp({
  dataRoot: resolve(process.env.NAMI_DATA_DIR ?? '../nami-data'),
  webRoot: fileURLToPath(new URL('../../web/dist/', import.meta.url)),
  logger: true,
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().catch(() => { process.exitCode = 1; });
  });
}
await app.listen({ host: process.env.HOST ?? '127.0.0.1', port });
