export const TEST_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS tts_services (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  host        TEXT NOT NULL,
  port        INTEGER NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
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
  tts_service_id       INTEGER NOT NULL,
  created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS worker_state (
  id                    INTEGER PRIMARY KEY,
  status                TEXT NOT NULL DEFAULT 'idle',
  updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
  trigger_requested_at  TEXT
);
INSERT OR IGNORE INTO worker_state (id, status) VALUES (1, 'idle');
CREATE TABLE IF NOT EXISTS articles (
  guid            TEXT PRIMARY KEY,
  feed_url        TEXT NOT NULL,
  feed_id         INTEGER,
  title           TEXT NOT NULL,
  link            TEXT,
  pub_date        INTEGER,
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
