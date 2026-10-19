import { resolve } from 'node:path';
import { emitKeypressEvents } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from './auth.js';
import { readHidden } from './admin-reset.js';
import { setSuperadminPassphrase } from './superadmin.js';

async function main() {
  if (process.argv.length !== 2 || !process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Run this command interactively in the NAMI container. Do not pass a passphrase as an argument.');
  }
  emitKeypressEvents(process.stdin);
  const first = await readHidden(`Superadmin passphrase (${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} characters): `);
  if (Array.from(first).length < PASSWORD_MIN_LENGTH || Array.from(first).length > PASSWORD_MAX_LENGTH) {
    throw new Error('The passphrase must be 12–256 characters long. No credentials were changed.');
  }
  const second = await readHidden('Repeat superadmin passphrase: ');
  if (first !== second) throw new Error('Passphrases did not match. No credentials were changed.');
  const backup = await setSuperadminPassphrase(resolve(process.env.NAMI_DATA_DIR ?? '../nami-data'), first);
  process.stdout.write(`Superadmin access is ready. Existing superadmin sessions were signed out. SQLite backup: ${backup}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Setup failed.'}\n`);
    process.exitCode = 1;
  });
}
