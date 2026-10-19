import Database from 'better-sqlite3';
import { chmodSync } from 'node:fs';
import { join } from 'node:path';

export type NamiDatabase = Database.Database;

export function openDatabase(dataRoot: string): NamiDatabase {
  const path = join(dataRoot, 'db', 'nami.sqlite');
  const database = new Database(path);
  chmodSync(path, 0o600);
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');
  database.pragma('busy_timeout = 5000');
  database.exec(`
    CREATE TABLE IF NOT EXISTS actors (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('organizer')),
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS one_organizer
      ON actors (kind) WHERE kind = 'organizer';

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      actor_id TEXT NOT NULL REFERENCES actors(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS sessions_by_expiry ON sessions (expires_at);

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES actors(id) ON DELETE RESTRICT,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      start_date TEXT NOT NULL,
      end_date TEXT,
      timezone TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS events_by_owner ON events (owner_id, start_date);

    CREATE TABLE IF NOT EXISTS event_access (
      actor_id TEXT NOT NULL REFERENCES actors(id) ON DELETE CASCADE,
      event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('organizer', 'contributor', 'viewer')),
      created_at INTEGER NOT NULL,
      PRIMARY KEY (actor_id, event_id)
    );

    CREATE INDEX IF NOT EXISTS event_access_by_event ON event_access (event_id, role);
  `);
  return database;
}
