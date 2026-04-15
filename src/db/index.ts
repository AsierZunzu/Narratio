import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

export type ArticleStatus = 'pending' | 'converting' | 'done' | 'failed' | 'purged';

export interface Article {
  guid: string;
  feed_url: string;
  title: string;
  link: string | null;
  pub_date: string | null;
  content: string | null;
  image_url: string | null;
  audio_file: string | null;
  status: ArticleStatus;
  tts_retries: number;
  tts_elapsed_ms: number | null;
  error: string | null;
  created_at: string;
}

const SCHEMA = `
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

let _db: Database.Database | null = null;

export function getDb(dbPath?: string): Database.Database {
  if (_db) return _db;

  const resolvedPath = dbPath ?? path.join(process.cwd(), 'data', 'narratio.db');
  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  _db = new Database(resolvedPath);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  _db.exec(SCHEMA);
  // Migration: add tts_elapsed_ms to existing databases that predate this column.
  try {
    _db.exec('ALTER TABLE articles ADD COLUMN tts_elapsed_ms INTEGER');
  } catch {
    // Column already exists — nothing to do.
  }
  return _db;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

export function resetDb(): void {
  closeDb();
}
