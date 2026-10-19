import Database from 'better-sqlite3';
import { chmodSync } from 'node:fs';
import { join } from 'node:path';

export type NamiDatabase = Database.Database;

function migrateActorsForGuests(database: NamiDatabase) {
  const table = database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'actors'").get() as { sql: string } | undefined;
  if (!table || table.sql.includes("'guest'")) return;

  database.pragma('foreign_keys = OFF');
  try {
    database.exec(`
      BEGIN IMMEDIATE;

      CREATE TABLE actors_next (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('organizer', 'guest', 'member')),
        display_name TEXT NOT NULL,
        password_hash TEXT,
        created_at INTEGER NOT NULL,
        CHECK (
          (kind = 'organizer' AND password_hash IS NOT NULL)
          OR (kind IN ('guest', 'member') AND password_hash IS NULL)
        )
      );

      INSERT INTO actors_next (id, kind, display_name, password_hash, created_at)
      SELECT id, kind, display_name, password_hash, created_at FROM actors;

      DROP TABLE actors;
      ALTER TABLE actors_next RENAME TO actors;

      CREATE UNIQUE INDEX one_organizer
        ON actors (kind) WHERE kind = 'organizer';

      COMMIT;
    `);
  } catch (error) {
    if (database.inTransaction) database.exec('ROLLBACK');
    throw error;
  } finally {
    database.pragma('foreign_keys = ON');
  }

  const foreignKeyErrors = database.pragma('foreign_key_check') as unknown[];
  if (foreignKeyErrors.length > 0) throw new Error('Database migration failed its foreign-key check.');
}

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
      kind TEXT NOT NULL CHECK (kind IN ('organizer', 'guest', 'member')),
      display_name TEXT NOT NULL,
      password_hash TEXT,
      created_at INTEGER NOT NULL,
      CHECK (
        (kind = 'organizer' AND password_hash IS NOT NULL)
        OR (kind IN ('guest', 'member') AND password_hash IS NULL)
      )
    );
  `);

  migrateActorsForGuests(database);

  database.exec(`

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

    CREATE TABLE IF NOT EXISTS invitations (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      created_by TEXT NOT NULL REFERENCES actors(id) ON DELETE RESTRICT,
      role TEXT NOT NULL CHECK (role IN ('contributor', 'viewer')),
      secret_hash TEXT NOT NULL UNIQUE,
      actor_id TEXT REFERENCES actors(id) ON DELETE RESTRICT,
      expires_at INTEGER,
      revoked_at INTEGER,
      created_at INTEGER NOT NULL,
      last_redeemed_at INTEGER,
      redemption_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS invitations_by_event ON invitations (event_id, created_at);

    CREATE TABLE IF NOT EXISTS media (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      uploaded_by TEXT NOT NULL REFERENCES actors(id) ON DELETE RESTRICT,
      original_name TEXT NOT NULL,
      media_type TEXT NOT NULL CHECK (media_type = 'image/jpeg'),
      size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
      sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
      width INTEGER NOT NULL CHECK (width > 0),
      height INTEGER NOT NULL CHECK (height > 0),
      preview_width INTEGER NOT NULL CHECK (preview_width > 0),
      preview_height INTEGER NOT NULL CHECK (preview_height > 0),
      preview_size_bytes INTEGER NOT NULL CHECK (preview_size_bytes > 0),
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS upload_sessions (
      id TEXT PRIMARY KEY,
      actor_id TEXT NOT NULL REFERENCES actors(id) ON DELETE RESTRICT,
      event_id TEXT NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
      metadata TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS uploads_by_actor ON upload_sessions (actor_id);

    CREATE INDEX IF NOT EXISTS media_by_event ON media (event_id, created_at);

    CREATE TABLE IF NOT EXISTS superadmin (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS superadmin_sessions (
      token_hash TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS superadmin_sessions_by_expiry ON superadmin_sessions (expires_at);
  `);
  return database;
}
