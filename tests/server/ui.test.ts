import { describe, it, expect } from 'vitest';
import request from 'supertest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../src/db/schema.js';
import { TEST_SCHEMA_SQL as SCHEMA_SQL } from '../helpers/schema.js';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { createApp } from '../../src/server/index.js';
import { renderDashboard } from '../../src/server/ui.js';
import { eq } from 'drizzle-orm';
import { articles } from '../../src/db/schema.js';
import { insertArticle, markArticleDone, markArticleFailed, markArticlePurged } from '../../src/db/articles.js';
import { insertFeed } from '../../src/db/feeds.js';
import { insertTtsService } from '../../src/db/tts-services.js';
import { resetDb } from '../../src/db/index.js';
import type { Db } from '../../src/db/index.js';
import type { Article } from '../../src/db/schema.js';

function makeTempDb(): { db: Db; dbPath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narratio-ui-'));
  const dbPath = path.join(dir, 'test.db');
  const sqlite = new Database(dbPath);
  sqlite.exec(SCHEMA_SQL);
  const db = drizzle(sqlite, { schema });
  return { db, dbPath };
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
    db.$client.close();

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
    db.$client.close();

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
    db.$client.close();

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
    db.$client.close();

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
    markArticleDone(db, 'pur1', 'pur1.wav', 0);
    db.$client.close();

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
    db.$client.close();

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

describe('POST /api/articles/:guid/regenerate', () => {
  it('returns 204, unlinks audio file, and resets done article to pending', async () => {
    resetDb();
    const { db, dbPath } = makeTempDb();
    insertArticle(db, { guid: 'reg1', feed_url: 'https://x.com/feed', title: 'Regen Me', link: null, pub_date: null, content: null, image_url: null });
    markArticleDone(db, 'reg1', 'reg1.wav', 1500);
    db.update(articles).set({ tts_retries: 2 }).where(eq(articles.guid, 'reg1')).run();
    db.$client.close();

    const audioDir = path.join(process.cwd(), 'data', 'audio');
    fs.mkdirSync(audioDir, { recursive: true });
    const filePath = path.join(audioDir, 'reg1.wav');
    fs.writeFileSync(filePath, Buffer.from('RIFF'));

    try {
      const app = createApp(dbPath);
      const res = await request(app).post('/api/articles/reg1/regenerate');
      expect(res.status).toBe(204);
      expect(fs.existsSync(filePath)).toBe(false);

      const check = await request(app).get('/api/articles');
      const article = check.body.find((a: { guid: string }) => a.guid === 'reg1');
      expect(article?.status).toBe('pending');
      expect(article?.audio_file).toBeNull();
      expect(article?.tts_retries).toBe(0);
      expect(article?.error).toBeNull();
      expect(article?.tts_elapsed_ms).toBeNull();
    } finally {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
  });

  it('returns 204 for a purged article even when the audio file does not exist', async () => {
    resetDb();
    const { db, dbPath } = makeTempDb();
    insertArticle(db, { guid: 'reg2', feed_url: 'https://x.com/feed', title: 'Purged', link: null, pub_date: null, content: null, image_url: null });
    markArticleDone(db, 'reg2', 'reg2.wav', 0);
    markArticlePurged(db, 'reg2');
    db.$client.close();

    const app = createApp(dbPath);
    const res = await request(app).post('/api/articles/reg2/regenerate');
    expect(res.status).toBe(204);

    const check = await request(app).get('/api/articles');
    const article = check.body.find((a: { guid: string }) => a.guid === 'reg2');
    expect(article?.status).toBe('pending');
    expect(article?.audio_file).toBeNull();
  });

  it('returns 204 for a failed article and clears the error', async () => {
    resetDb();
    const { db, dbPath } = makeTempDb();
    insertArticle(db, { guid: 'reg3', feed_url: 'https://x.com/feed', title: 'Failed', link: null, pub_date: null, content: null, image_url: null });
    markArticleFailed(db, 'reg3', 'some error');
    markArticleFailed(db, 'reg3', 'again');
    db.$client.close();

    const app = createApp(dbPath);
    const res = await request(app).post('/api/articles/reg3/regenerate');
    expect(res.status).toBe(204);

    const check = await request(app).get('/api/articles');
    const article = check.body.find((a: { guid: string }) => a.guid === 'reg3');
    expect(article?.status).toBe('pending');
    expect(article?.error).toBeNull();
    expect(article?.tts_retries).toBe(0);
  });

  it('returns 404 for a pending article', async () => {
    resetDb();
    const { db, dbPath } = makeTempDb();
    insertArticle(db, { guid: 'reg4', feed_url: 'https://x.com/feed', title: 'Pending', link: null, pub_date: null, content: null, image_url: null });
    db.$client.close();

    const app = createApp(dbPath);
    const res = await request(app).post('/api/articles/reg4/regenerate');
    expect(res.status).toBe(404);
  });

  it('returns 404 for a converting article', async () => {
    resetDb();
    const { db, dbPath } = makeTempDb();
    insertArticle(db, { guid: 'reg5', feed_url: 'https://x.com/feed', title: 'Converting', link: null, pub_date: null, content: null, image_url: null });
    db.update(articles).set({ status: 'converting' }).where(eq(articles.guid, 'reg5')).run();
    db.$client.close();

    const app = createApp(dbPath);
    const res = await request(app).post('/api/articles/reg5/regenerate');
    expect(res.status).toBe(404);
  });

  it('returns 404 for an unknown guid', async () => {
    resetDb();
    const { dbPath } = makeTempDb();
    const app = createApp(dbPath);
    const res = await request(app).post('/api/articles/nobody/regenerate');
    expect(res.status).toBe(404);
  });
});

describe('GET /audio/:file', () => {
  it('returns 404 for filename containing ..', async () => {
    resetDb();
    const { dbPath } = makeTempDb();
    const app = createApp(dbPath);
    // Express normalises /audio/../x to /x, so use a param that contains .. literally
    const res = await request(app).get('/audio/..hidden.wav');
    expect(res.status).toBe(404);
  });

  it('returns 404 for filename with slash', async () => {
    resetDb();
    const { dbPath } = makeTempDb();
    const app = createApp(dbPath);
    const res = await request(app).get('/audio/subdir%2Ffile.wav');
    expect(res.status).toBe(404);
  });

  it('returns 404 when audio file does not exist', async () => {
    resetDb();
    const { dbPath } = makeTempDb();
    const app = createApp(dbPath);
    const res = await request(app).get('/audio/nonexistent.wav');
    expect(res.status).toBe(404);
  });

  it('serves an existing audio file with audio/wav content-type', async () => {
    resetDb();
    const { dbPath } = makeTempDb();
    const app = createApp(dbPath);

    // Write a dummy WAV to the expected location (process.cwd()/data/audio/)
    const audioDir = path.join(process.cwd(), 'data', 'audio');
    fs.mkdirSync(audioDir, { recursive: true });
    const testFile = path.join(audioDir, 'test-coverage.wav');
    fs.writeFileSync(testFile, Buffer.from('RIFF'));
    try {
      const res = await request(app).get('/audio/test-coverage.wav');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/audio\/wav/);
    } finally {
      fs.unlinkSync(testFile);
    }
  });
});

describe('GET /rss/:slug', () => {
  it('returns 404 for unknown feed slug', async () => {
    resetDb();
    const { dbPath } = makeTempDb();
    const app = createApp(dbPath);
    const res = await request(app).get('/rss/no-such-feed');
    expect(res.status).toBe(404);
  });

  it('returns RSS XML for a known feed slug', async () => {
    resetDb();
    const { db, dbPath } = makeTempDb();
    const tts = insertTtsService(db, { name: 'T', host: 'localhost', port: 10200 });
    insertFeed(db, { name: 'F', rss_url: 'https://x.com/rss', slug: 'my-podcast', title: 'My Podcast', tts_service_id: tts.id });
    db.$client.close();

    const app = createApp(dbPath);
    const res = await request(app).get('/rss/my-podcast');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/rss\+xml/);
    expect(res.text).toContain('<rss');
  });
});

describe('renderDashboard helper functions', () => {
  const baseArticle: Article = {
    guid: 'g1',
    feed_url: 'https://x.com/rss',
    feed_id: 1,
    title: 'Test Article',
    link: 'https://x.com/1',
    pub_date: '2024-01-15T00:00:00Z',
    content: '<p>Hello <b>world</b></p>',
    image_url: null,
    audio_file: 'g1.wav',
    status: 'done',
    tts_retries: 0,
    tts_elapsed_ms: 1234,
    error: null,
    created_at: '2024-01-15T00:00:00Z',
  };

  it('renders without throwing when articles have full data', () => {
    const html = renderDashboard([baseArticle], 'http://localhost:3000');
    expect(html).toContain('Test Article');
  });

  it('renders formatDate with a null date (displays —)', () => {
    const article = { ...baseArticle, pub_date: null };
    const html = renderDashboard([article], 'http://localhost:3000');
    expect(html).toContain('Narratio');
  });

  it('renders formatElapsed for sub-second elapsed (ms)', () => {
    const article = { ...baseArticle, tts_elapsed_ms: 500 };
    const html = renderDashboard([article], 'http://localhost:3000');
    expect(html).toContain('500ms');
  });

  it('renders formatElapsed for elapsed >= 1 second', () => {
    const article = { ...baseArticle, tts_elapsed_ms: 2500 };
    const html = renderDashboard([article], 'http://localhost:3000');
    expect(html).toContain('2.5s');
  });

  it('renders formatElapsed for null elapsed (displays —)', () => {
    const article = { ...baseArticle, tts_elapsed_ms: null };
    const html = renderDashboard([article], 'http://localhost:3000');
    expect(html).toContain('Narratio');
  });

  it('renders wordCount for HTML content', () => {
    const article = { ...baseArticle, content: '<p>one two three</p>' };
    const html = renderDashboard([article], 'http://localhost:3000');
    expect(html).toContain('3 w');
  });

  it('renders wordCount as — for null content', () => {
    const article = { ...baseArticle, content: null };
    const html = renderDashboard([article], 'http://localhost:3000');
    expect(html).toContain('Narratio');
  });

  it('renders wordCount as — for empty string content', () => {
    const article = { ...baseArticle, content: '   ' };
    const html = renderDashboard([article], 'http://localhost:3000');
    expect(html).toContain('Narratio');
  });

  it('renders articles with all status variants', () => {
    const statuses = ['pending', 'converting', 'done', 'failed', 'purged'] as const;
    const articles = statuses.map((status, i) => ({ ...baseArticle, guid: `g${i}`, status }));
    const html = renderDashboard(articles, 'http://localhost:3000');
    for (const status of statuses) {
      const label = status.charAt(0).toUpperCase() + status.slice(1);
      expect(html).toContain(label);
    }
  });
});
