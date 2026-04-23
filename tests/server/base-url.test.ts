import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../src/db/schema.js';
import { TEST_SCHEMA_SQL as SCHEMA_SQL } from '../helpers/schema.js';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { createApp } from '../../src/server/index.js';
import { insertFeed } from '../../src/db/feeds.js';
import { insertTtsService } from '../../src/db/tts-services.js';
import { insertArticle, markArticleDone } from '../../src/db/articles.js';
import { resetDb } from '../../src/db/index.js';
import type { Db } from '../../src/db/index.js';

function makeTempDb(): { db: Db; dbPath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narratio-baseurl-'));
  const dbPath = path.join(dir, 'test.db');
  const sqlite = new Database(dbPath);
  sqlite.exec(SCHEMA_SQL);
  const db = drizzle(sqlite, { schema });
  return { db, dbPath };
}

function seed(db: Db): void {
  const tts = insertTtsService(db, { name: 'TTS', host: 'localhost', port: 10200 });
  const feed = insertFeed(db, {
    name: 'Feed',
    rss_url: 'https://example.com/rss',
    slug: 'my-feed',
    title: 'Pod',
    tts_service_id: tts.id,
  });
  insertArticle(db, {
    guid: 'g1', feed_url: feed.rss_url, feed_id: feed.id, title: 'A', link: null,
    pub_date: null, content: null, image_url: null,
  });
  markArticleDone(db, 'g1', 'g1.wav', 0);
}

function setupApp() {
  resetDb();
  const { db, dbPath } = makeTempDb();
  seed(db);
  db.$client.close();
  return createApp(dbPath);
}

const originalBaseUrl = process.env['BASE_URL'];

afterEach(() => {
  if (originalBaseUrl === undefined) delete process.env['BASE_URL'];
  else process.env['BASE_URL'] = originalBaseUrl;
});

describe('GET /rss/:slug — BASE_URL handling', () => {
  it('uses Host header when BASE_URL is unset', async () => {
    delete process.env['BASE_URL'];
    const app = setupApp();
    const res = await request(app).get('/rss/my-feed').set('Host', 'podcast.example.org:8080');
    expect(res.status).toBe(200);
    expect(res.text).toContain('http://podcast.example.org:8080/audio/');
  });

  it('overrides Host header when BASE_URL is set', async () => {
    process.env['BASE_URL'] = 'https://public.example.com';
    const app = setupApp();
    const res = await request(app).get('/rss/my-feed').set('Host', 'internal:3000');
    expect(res.status).toBe(200);
    expect(res.text).toContain('https://public.example.com/audio/');
    expect(res.text).not.toContain('internal:3000');
  });

  it('BASE_URL with trailing slash does not produce double-slashes', async () => {
    process.env['BASE_URL'] = 'https://public.example.com/';
    const app = setupApp();
    const res = await request(app).get('/rss/my-feed');
    expect(res.status).toBe(200);
    expect(res.text).not.toMatch(/https:\/\/public\.example\.com\/\/audio/);
    expect(res.text).toContain('https://public.example.com/audio/');
  });

  it('honors X-Forwarded-Proto via trust proxy when BASE_URL is unset', async () => {
    delete process.env['BASE_URL'];
    const app = setupApp();
    const res = await request(app)
      .get('/rss/my-feed')
      .set('Host', 'podcast.example.org')
      .set('X-Forwarded-Proto', 'https');
    expect(res.status).toBe(200);
    expect(res.text).toContain('https://podcast.example.org/audio/');
  });
});
