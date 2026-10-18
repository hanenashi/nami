import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const dataRoot = await mkdtemp(join(tmpdir(), 'nami-browser-'));
const server = spawn(process.execPath, ['apps/api/dist/server.js'], {
  stdio: 'inherit',
  env: { ...process.env, NAMI_DATA_DIR: dataRoot, HOST: '127.0.0.1', PORT: '3100' },
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { server.kill(signal); });
}
server.once('exit', (code) => {
  void rm(dataRoot, { recursive: true, force: true }).then(() => { process.exitCode = code ?? 0; });
});
