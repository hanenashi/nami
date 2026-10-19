import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { chmod, mkdir, stat, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { emitKeypressEvents } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { hashOrganizerPassword, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from './auth.js';

type OrganizerRow = { id: string; password_hash: string };

export async function resetOrganizerPassphrase(dataRoot: string, passphrase: string) {
  const newHash = await hashOrganizerPassword(passphrase);
  const databasePath = join(dataRoot, 'db', 'nami.sqlite');
  if (!await stat(databasePath).then(file => file.isFile(), () => false)) {
    throw new Error('NAMI database not found at the configured data root. No account was changed.');
  }
  const database = new Database(databasePath, { fileMustExist: true });
  try {
    database.pragma('busy_timeout = 5000');
    database.pragma('foreign_keys = ON');
    if (database.pragma('integrity_check', { simple: true }) !== 'ok' ||
      (database.pragma('foreign_key_check') as unknown[]).length) {
      throw new Error('Database integrity check failed. No account was changed.');
    }
    const organizer = database.prepare("SELECT id, password_hash FROM actors WHERE kind = 'organizer'").get() as OrganizerRow | undefined;
    if (!organizer) throw new Error('No organizer account exists. No account was changed.');

    const backupDir = join(dataRoot, 'backups');
    await mkdir(backupDir, { recursive: true, mode: 0o700 });
    await chmod(backupDir, 0o700);
    const backupPath = join(backupDir, `organizer-before-reset-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.sqlite`);
    try {
      await database.backup(backupPath);
      await chmod(backupPath, 0o600);
      const backup = new Database(backupPath, { readonly: true });
      try {
        const saved = backup.prepare("SELECT id, password_hash FROM actors WHERE kind = 'organizer'").get() as OrganizerRow | undefined;
        if (backup.pragma('integrity_check', { simple: true }) !== 'ok' ||
          (backup.pragma('foreign_key_check') as unknown[]).length ||
          saved?.id !== organizer.id || saved.password_hash !== organizer.password_hash) {
          throw new Error('The SQLite backup could not be verified. No account was changed.');
        }
      } finally { backup.close(); }
    } catch (error) {
      await unlink(backupPath).catch(() => {});
      throw error;
    }

    database.transaction(() => {
      const changed = database.prepare("UPDATE actors SET password_hash = ? WHERE id = ? AND kind = 'organizer' AND password_hash = ?")
        .run(newHash, organizer.id, organizer.password_hash).changes;
      if (changed !== 1) throw new Error('Organizer credentials changed during reset. No account was changed.');
      database.prepare('DELETE FROM sessions WHERE actor_id = ?').run(organizer.id);
    })();
    return backupPath;
  } finally { database.close(); }
}

export function readHidden(prompt: string): Promise<string> {
  return new Promise((resolveInput, rejectInput) => {
    let value = '';
    process.stdin.setRawMode(true);
    const finish = (error?: Error) => {
      process.stdin.removeListener('keypress', onKey);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
      if (error) rejectInput(error);
      else resolveInput(value);
    };
    const onKey = (character: string | undefined, key: { name?: string; ctrl?: boolean; meta?: boolean }) => {
      if (key.ctrl && key.name === 'c') return finish(new Error('Cancelled. No account was changed.'));
      if (key.name === 'return' || key.name === 'enter') return finish();
      if (key.name === 'backspace') { value = value.slice(0, -1); return; }
      if (character && !key.ctrl && !key.meta && !character.startsWith('\x1b') && value.length < 1024) value += character;
    };
    process.stdin.on('keypress', onKey);
    process.stdin.resume();
    process.stdout.write(prompt);
  });
}

async function main() {
  if (process.argv.length !== 2 || !process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Run this command interactively in the NAMI container. Do not pass the passphrase as an argument.');
  }
  emitKeypressEvents(process.stdin);
  const first = await readHidden(`New organizer passphrase (${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} characters): `);
  const length = Array.from(first).length;
  if (length < PASSWORD_MIN_LENGTH || length > PASSWORD_MAX_LENGTH) {
    throw new Error(`The passphrase must be ${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} characters long. No account was changed.`);
  }
  const second = await readHidden('Repeat new passphrase: ');
  if (first !== second) throw new Error('Passphrases did not match. No account was changed.');
  const backupPath = await resetOrganizerPassphrase(resolve(process.env.NAMI_DATA_DIR ?? '../nami-data'), first);
  process.stdout.write(`Organizer passphrase changed. Existing organizer sessions were signed out. SQLite backup: ${backupPath}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Reset failed.'}\n`);
    process.exitCode = 1;
  });
}
