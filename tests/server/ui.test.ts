import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import Database from 'better-sqlite3';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { createApp } from '../../src/server/index.js';
import { insertArticle, markArticleDone, markArticleFailed } from '../../src/db/articles.js';
import { getDb, resetDb } from '../../src/db/index.js';

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
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

function makeTempDb(): { db: Database.Database; dbPath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narratio-ui-'));
  const dbPath = path.join(dir, 'test.db');
  const db = new Database(dbPath);
  db.exec(SCHEMA);
  return { db, dbPath };
}

// Override AUDIO_DIR behaviour: the server uses process.cwd()/data/audio,
// so we point it at a temp dir via a helper that creates the audio files.
function makeTempAudioDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'narratio-audio-'));
}

// We need a way to seed audio files in the path the server will look for them.
// Since the server hard-codes DATA_DIR = process.cwd()/data, we mock fs operations
// by seeding files there. Instead, we use a lightweight approach: patch process.cwd
// or simply test the API layer and trust the file-deletion logic is correct.
// For these tests we don't create real WAV files — we verify DB state and HTTP status.

describe('GET /', () => {
  it('returns 200 with text/html', async () => {
    resetDb();
    const { dbPath } = makeTempDb();
    const app = createApp(dbPath);
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('Narratio');
    expect(res.text).toContain('articles-table');
  });
});

describe('GET /api/articles', () => {
  it('returns empty array when no articles', async () => {
    resetDb();
    const { dbPath } = makeTempDb();
    const app = createApp(dbPath);
    const res = await request(app).get('/api/articles');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns all articles as JSON', async () => {
    resetDb();
    const { db, dbPath } = makeTempDb();
    insertArticle(db, { guid: 'g1', feed_url: 'https://x.com/feed', title: 'Article 1', link: null, pub_date: null, content: null, image_url: null });
    insertArticle(db, { guid: 'g2', feed_url: 'https://x.com/feed', title: 'Article 2', link: null, pub_date: null, content: null, image_url: null });
    db.close();

    const app = createApp(dbPath);
    const res = await request(app).get('/api/articles');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body.map((a: { guid: string }) => a.guid)).toContain('g1');
  });
});

describe('DELETE /api/articles/:guid', () => {
  it('returns 204 and removes article from DB', async () => {
    resetDb();
    const { db, dbPath } = makeTempDb();
    insertArticle(db, { guid: 'del1', feed_url: 'https://x.com/feed', title: 'To Delete', link: null, pub_date: null, content: null, image_url: null });
    db.close();

    const app = createApp(dbPath);
    const res = await request(app).delete('/api/articles/del1');
    expect(res.status).toBe(204);

    // Verify removed
    const check = await request(app).get('/api/articles');
    expect(check.body.find((a: { guid: string }) => a.guid === 'del1')).toBeUndefined();
  });

  it('returns 404 for unknown guid', async () => {
    resetDb();
    const { dbPath } = makeTempDb();
    const app = createApp(dbPath);
    const res = await request(app).delete('/api/articles/nonexistent');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/articles/:guid/retry', () => {
  it('returns 204 and resets retries on failed article', async () => {
    resetDb();
    const { db, dbPath } = makeTempDb();
    insertArticle(db, { guid: 'ret1', feed_url: 'https://x.com/feed', title: 'Retry Me', link: null, pub_date: null, content: null, image_url: null });
    markArticleFailed(db, 'ret1', 'some error');
    db.close();

    const app = createApp(dbPath);
    const res = await request(app).post('/api/articles/ret1/retry');
    expect(res.status).toBe(204);

    const check = await request(app).get('/api/articles');
    const article = check.body.find((a: { guid: string }) => a.guid === 'ret1');
    expect(article?.status).toBe('pending');
    expect(article?.tts_retries).toBe(0);
  });

  it('returns 404 for non-failed article', async () => {
    resetDb();
    const { db, dbPath } = makeTempDb();
    insertArticle(db, { guid: 'ret2', feed_url: 'https://x.com/feed', title: 'Pending', link: null, pub_date: null, content: null, image_url: null });
    db.close();

    const app = createApp(dbPath);
    const res = await request(app).post('/api/articles/ret2/retry');
    expect(res.status).toBe(404);
  });

  it('returns 404 for unknown guid', async () => {
    resetDb();
    const { dbPath } = makeTempDb();
    const app = createApp(dbPath);
    const res = await request(app).post('/api/articles/nobody/retry');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/articles/:guid/purge', () => {
  it('returns 204 and marks done article as purged', async () => {
    resetDb();
    const { db, dbPath } = makeTempDb();
    insertArticle(db, { guid: 'pur1', feed_url: 'https://x.com/feed', title: 'Purge Me', link: null, pub_date: null, content: null, image_url: null });
    // Mark done with a non-existent audio file — the unlink will silently fail
    markArticleDone(db, 'pur1', 'pur1.wav');
    db.close();

    const app = createApp(dbPath);
    const res = await request(app).post('/api/articles/pur1/purge');
    expect(res.status).toBe(204);

    const check = await request(app).get('/api/articles');
    const article = check.body.find((a: { guid: string }) => a.guid === 'pur1');
    expect(article?.status).toBe('purged');
  });

  it('returns 404 for non-done article', async () => {
    resetDb();
    const { db, dbPath } = makeTempDb();
    insertArticle(db, { guid: 'pur2', feed_url: 'https://x.com/feed', title: 'Pending', link: null, pub_date: null, content: null, image_url: null });
    db.close();

    const app = createApp(dbPath);
    const res = await request(app).post('/api/articles/pur2/purge');
    expect(res.status).toBe(404);
  });

  it('returns 404 for unknown guid', async () => {
    resetDb();
    const { dbPath } = makeTempDb();
    const app = createApp(dbPath);
    const res = await request(app).post('/api/articles/nobody/purge');
    expect(res.status).toBe(404);
  });
});
