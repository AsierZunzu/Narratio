import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import path from 'path';
import fs from 'fs';
import * as schema from './schema.js';

export type { Article, ArticleStatus, Feed, TtsService } from './schema.js';
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

function toSlug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'default';
}

function seedFromEnv(sqlite: Database.Database): void {
  const ttsCount = (sqlite.prepare('SELECT COUNT(*) as c FROM tts_services').get() as { c: number }).c;
  if (ttsCount === 0) {
    const host = process.env['PIPER_HOST'] || 'localhost';
    const port = Number(process.env['PIPER_PORT'] || '10200');
    sqlite.prepare('INSERT INTO tts_services (name, host, port) VALUES (?, ?, ?)').run('Default', host, port);
  }

  const feedCount = (sqlite.prepare('SELECT COUNT(*) as c FROM feeds').get() as { c: number }).c;
  if (feedCount === 0) {
    const rssUrl = process.env['RSS_URL'];
    if (!rssUrl) return;

    const ttsRow = sqlite.prepare('SELECT id FROM tts_services LIMIT 1').get() as { id: number };
    const ttsServiceId = ttsRow.id;
    const title = process.env['PODCAST_TITLE'] || 'Narratio';
    const slug = toSlug(title);
    const maxAudioFiles = process.env['MAX_AUDIO_FILES'] ? Number(process.env['MAX_AUDIO_FILES']) : null;
    const maxAudioSizeMb = process.env['MAX_AUDIO_SIZE_MB'] ? Number(process.env['MAX_AUDIO_SIZE_MB']) : null;

    sqlite.prepare(`
      INSERT INTO feeds (
        name, rss_url, slug, title, description, author, language,
        itunes_author, itunes_summary, itunes_owner_name, itunes_owner_email, itunes_category,
        unavailable_message, tts_failed_message, max_audio_files, max_audio_size_mb, tts_service_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      title, rssUrl, slug, title,
      process.env['PODCAST_DESCRIPTION'] || '',
      process.env['PODCAST_AUTHOR'] || 'Narratio Worker',
      process.env['PODCAST_LANGUAGE'] || 'en',
      process.env['PODCAST_ITUNES_AUTHOR'] || process.env['PODCAST_AUTHOR'] || 'Narratio Worker',
      process.env['PODCAST_ITUNES_SUMMARY'] || process.env['PODCAST_DESCRIPTION'] || '',
      process.env['PODCAST_ITUNES_OWNER_NAME'] || process.env['PODCAST_AUTHOR'] || 'Narratio Worker',
      process.env['PODCAST_ITUNES_OWNER_EMAIL'] || 'worker@example.com',
      process.env['PODCAST_ITUNES_CATEGORY'] || 'Technology',
      process.env['UNAVAILABLE_MESSAGE'] || 'This content is no longer available on the server.',
      process.env['TTS_FAILED_MESSAGE'] || 'This podcast episode could not be generated due to a text-to-speech error.',
      maxAudioFiles,
      maxAudioSizeMb,
      ttsServiceId,
    );

    const feedRow = sqlite.prepare('SELECT id FROM feeds WHERE slug = ?').get(slug) as { id: number };
    sqlite.prepare('UPDATE articles SET feed_id = ? WHERE feed_url = ?').run(feedRow.id, rssUrl);
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

  try { _sqlite.exec('ALTER TABLE articles ADD COLUMN tts_elapsed_ms INTEGER'); } catch { /* already exists */ }
  try { _sqlite.exec('ALTER TABLE articles ADD COLUMN feed_id INTEGER REFERENCES feeds(id)'); } catch { /* already exists */ }

  seedFromEnv(_sqlite);

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
