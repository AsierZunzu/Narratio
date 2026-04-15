import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runCleanup } from '../../src/services/cleanup.js';
import { insertArticle, markArticleDone, getArticleByGuid } from '../../src/db/articles.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS articles (
  guid TEXT PRIMARY KEY,
  feed_url TEXT NOT NULL,
  title TEXT NOT NULL,
  link TEXT,
  pub_date TEXT,
  content TEXT,
  image_url TEXT,
  audio_file TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  tts_retries INTEGER NOT NULL DEFAULT 0,
  tts_elapsed_ms INTEGER,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

function makeDb() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  return db;
}

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'narratio-cleanup-'));
}

function addDoneArticle(db: Database.Database, audioDir: string, guid: string, sizeBytes: number, pubDate: string) {
  insertArticle(db, {
    guid,
    feed_url: 'https://example.com/feed',
    title: `Article ${guid}`,
    link: null,
    pub_date: pubDate,
    content: null,
    image_url: null,
  });
  const filename = `${guid}.wav`;
  const filePath = path.join(audioDir, filename);
  fs.writeFileSync(filePath, Buffer.alloc(sizeBytes));
  markArticleDone(db, guid, filename, 0);
}

describe('runCleanup', () => {
  let db: Database.Database;
  let audioDir: string;

  beforeEach(() => {
    db = makeDb();
    audioDir = makeTempDir();
  });

  it('does nothing when no quotas are set', () => {
    addDoneArticle(db, audioDir, 'g1', 100, '2026-01-01');
    addDoneArticle(db, audioDir, 'g2', 100, '2026-01-02');

    runCleanup(db, { maxAudioFiles: Infinity, maxAudioSizeMb: Infinity, audioDir });

    expect(getArticleByGuid(db, 'g1')?.status).toBe('done');
    expect(getArticleByGuid(db, 'g2')?.status).toBe('done');
  });

  it('purges oldest files first when MAX_AUDIO_FILES exceeded', () => {
    addDoneArticle(db, audioDir, 'g1', 100, '2026-01-01');
    addDoneArticle(db, audioDir, 'g2', 100, '2026-01-02');
    addDoneArticle(db, audioDir, 'g3', 100, '2026-01-03');

    runCleanup(db, { maxAudioFiles: 2, maxAudioSizeMb: Infinity, audioDir });

    // g1 is oldest — should be purged
    expect(getArticleByGuid(db, 'g1')?.status).toBe('purged');
    expect(getArticleByGuid(db, 'g2')?.status).toBe('done');
    expect(getArticleByGuid(db, 'g3')?.status).toBe('done');
    expect(fs.existsSync(path.join(audioDir, 'g1.wav'))).toBe(false);
  });

  it('purges oldest files first when MAX_AUDIO_SIZE_MB exceeded', () => {
    // 3 files × 512 KB = 1.5 MB; limit is 1 MB.
    // After purging g1 (oldest, 512 KB): remaining = exactly 1.0 MB, which
    // does not exceed the limit, so purging stops.
    const halfMb = 512 * 1024;
    addDoneArticle(db, audioDir, 'g1', halfMb, '2026-01-01');
    addDoneArticle(db, audioDir, 'g2', halfMb, '2026-01-02');
    addDoneArticle(db, audioDir, 'g3', halfMb, '2026-01-03');

    runCleanup(db, { maxAudioFiles: Infinity, maxAudioSizeMb: 1, audioDir });

    expect(getArticleByGuid(db, 'g1')?.status).toBe('purged');
    expect(getArticleByGuid(db, 'g2')?.status).toBe('done');
    expect(getArticleByGuid(db, 'g3')?.status).toBe('done');
  });

  it('marks article purged even if file is already missing', () => {
    addDoneArticle(db, audioDir, 'g1', 100, '2026-01-01');
    addDoneArticle(db, audioDir, 'g2', 100, '2026-01-02');
    // Manually delete g1's file
    fs.unlinkSync(path.join(audioDir, 'g1.wav'));

    runCleanup(db, { maxAudioFiles: 1, maxAudioSizeMb: Infinity, audioDir });

    expect(getArticleByGuid(db, 'g1')?.status).toBe('purged');
    expect(getArticleByGuid(db, 'g2')?.status).toBe('done');
  });

  it('does not purge when within limits', () => {
    addDoneArticle(db, audioDir, 'g1', 100, '2026-01-01');
    addDoneArticle(db, audioDir, 'g2', 100, '2026-01-02');

    runCleanup(db, { maxAudioFiles: 5, maxAudioSizeMb: 100, audioDir });

    expect(getArticleByGuid(db, 'g1')?.status).toBe('done');
    expect(getArticleByGuid(db, 'g2')?.status).toBe('done');
  });
});
