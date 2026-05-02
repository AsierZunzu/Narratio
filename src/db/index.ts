import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import path from 'path';
import fs from 'fs';
import * as schema from './schema.js';

export type { Article, ArticleStatus, Feed, TtsService, WorkerState, WorkerStatus } from './schema.js';
export type Db = BetterSQLite3Database<typeof schema>;

const TTS_SERVICES_SQL = `
CREATE TABLE IF NOT EXISTS tts_services (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  host        TEXT NOT NULL,
  port        INTEGER NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

const FEEDS_SQL = `
CREATE TABLE IF NOT EXISTS feeds (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  name                 TEXT NOT NULL,
  rss_url              TEXT NOT NULL,
  slug                 TEXT NOT NULL UNIQUE,
  title                TEXT NOT NULL,
  description          TEXT NOT NULL DEFAULT '',
  author               TEXT NOT NULL DEFAULT 'Narratio',
  language             TEXT NOT NULL DEFAULT 'en',
  itunes_author        TEXT,
  itunes_summary       TEXT,
  itunes_owner_name    TEXT,
  itunes_owner_email   TEXT,
  itunes_category      TEXT NOT NULL DEFAULT 'Technology',
  unavailable_message  TEXT,
  tts_failed_message   TEXT,
  max_audio_files      INTEGER,
  max_audio_size_mb    INTEGER,
  tts_service_id       INTEGER NOT NULL REFERENCES tts_services(id),
  created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

const WORKER_STATE_SQL = `
CREATE TABLE IF NOT EXISTS worker_state (
  id          INTEGER PRIMARY KEY,
  status      TEXT NOT NULL DEFAULT 'idle',
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

const ARTICLES_SQL = `
CREATE TABLE IF NOT EXISTS articles (
  guid            TEXT PRIMARY KEY,
  feed_url        TEXT NOT NULL,
  feed_id         INTEGER REFERENCES feeds(id),
  title           TEXT NOT NULL,
  link            TEXT,
  pub_date        TEXT,
  content         TEXT,
  image_url       TEXT,
  audio_file      TEXT,
  status          TEXT NOT NULL DEFAULT 'pending',
  tts_retries     INTEGER NOT NULL DEFAULT 0,
  tts_elapsed_ms  INTEGER,
  error           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

let _sqlite: Database.Database | null = null;
let _db: Db | null = null;

// Older rows stored RFC 2822 strings ("Mon, 02 May 2026 ...") which sort
// lexicographically wrong. Rewrite anything that isn't already ISO 8601 UTC.
export function normaliseLegacyPubDates(sqlite: Database.Database): void {
  const rows = sqlite.prepare(
    "SELECT guid, pub_date FROM articles WHERE pub_date IS NOT NULL AND pub_date NOT GLOB '____-__-__T*Z'",
  ).all() as Array<{ guid: string; pub_date: string }>;
  if (rows.length === 0) return;
  const update = sqlite.prepare('UPDATE articles SET pub_date = ? WHERE guid = ?');
  const tx = sqlite.transaction(() => {
    for (const row of rows) {
      const t = Date.parse(row.pub_date);
      if (Number.isNaN(t)) continue;
      update.run(new Date(t).toISOString(), row.guid);
    }
  });
  tx();
}

function seedDefaultTtsService(sqlite: Database.Database): void {
  const ttsCount = (sqlite.prepare('SELECT COUNT(*) as c FROM tts_services').get() as { c: number }).c;
  if (ttsCount === 0) {
    const host = process.env['PIPER_HOST'] || 'localhost';
    const port = Number(process.env['PIPER_PORT'] || '10200');
    sqlite.prepare('INSERT INTO tts_services (name, host, port) VALUES (?, ?, ?)').run('Default', host, port);
  }
}

export function getDb(dbPath?: string): Db {
  if (_db) return _db;

  const resolvedPath = dbPath ?? path.join(process.cwd(), 'data', 'narratio.db');
  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  _sqlite = new Database(resolvedPath);
  _sqlite.pragma('journal_mode = WAL');
  _sqlite.pragma('foreign_keys = ON');
  _sqlite.exec(TTS_SERVICES_SQL);
  _sqlite.exec(FEEDS_SQL);
  _sqlite.exec(ARTICLES_SQL);
  _sqlite.exec(WORKER_STATE_SQL);
  _sqlite.prepare("INSERT OR IGNORE INTO worker_state (id, status) VALUES (1, 'idle')").run();

  try { _sqlite.exec('ALTER TABLE articles ADD COLUMN tts_elapsed_ms INTEGER'); } catch { /* already exists */ }
  try { _sqlite.exec('ALTER TABLE articles ADD COLUMN feed_id INTEGER REFERENCES feeds(id)'); } catch { /* already exists */ }

  normaliseLegacyPubDates(_sqlite);
  seedDefaultTtsService(_sqlite);

  _db = drizzle(_sqlite, { schema });
  return _db;
}

export function closeDb(): void {
  if (_sqlite) {
    _sqlite.close();
    _sqlite = null;
    _db = null;
  }
}

export function resetDb(): void {
  closeDb();
}
