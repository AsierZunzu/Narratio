import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import path from 'path';
import fs from 'fs';
import * as schema from './schema.js';

export type { Article, ArticleStatus } from './schema.js';
export type Db = BetterSQLite3Database<typeof schema>;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS articles (
  guid            TEXT PRIMARY KEY,
  feed_url        TEXT NOT NULL,
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

export function getDb(dbPath?: string): Db {
  if (_db) return _db;

  const resolvedPath = dbPath ?? path.join(process.cwd(), 'data', 'narratio.db');
  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  _sqlite = new Database(resolvedPath);
  _sqlite.pragma('journal_mode = WAL');
  _sqlite.pragma('foreign_keys = ON');
  _sqlite.exec(SCHEMA_SQL);
  // Migration: add tts_elapsed_ms to existing databases that predate this column.
  try {
    _sqlite.exec('ALTER TABLE articles ADD COLUMN tts_elapsed_ms INTEGER');
  } catch {
    // Column already exists — nothing to do.
  }

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
