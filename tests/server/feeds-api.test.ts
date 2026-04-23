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
import { insertArticle, markArticleDone } from '../../src/db/articles.js';
import { insertFeed } from '../../src/db/feeds.js';
import { insertTtsService } from '../../src/db/tts-services.js';
import { resetDb } from '../../src/db/index.js';
import type { Db } from '../../src/db/index.js';

function makeTempDb(): { db: Db; dbPath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narratio-feeds-api-'));
  const dbPath = path.join(dir, 'test.db');
  const sqlite = new Database(dbPath);
  sqlite.exec(SCHEMA_SQL);
  const db = drizzle(sqlite, { schema });
  return { db, dbPath };
}

function seedTts(db: Db): number {
  return insertTtsService(db, { name: 'Test TTS', host: 'localhost', port: 10200 }).id;
}

const feedPayload = (ttsServiceId: number, slug = 'my-feed') => ({
  name: 'My Feed',
  rss_url: 'https://example.com/rss',
  slug,
  title: 'My Podcast',
  tts_service_id: ttsServiceId,
});

describe('GET /api/feeds', () => {
  it('returns empty array when no feeds', async () => {
    resetDb();
    const { dbPath } = makeTempDb();
    const app = createApp(dbPath);
    const res = await request(app).get('/api/feeds');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns feeds list with tts_service_name', async () => {
    resetDb();
    const { db, dbPath } = makeTempDb();
    const ttsId = seedTts(db);
    insertFeed(db, feedPayload(ttsId));
    db.$client.close();

    const app = createApp(dbPath);
    const res = await request(app).get('/api/feeds');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].slug).toBe('my-feed');
    expect(res.body[0].tts_service_name).toBe('Test TTS');
  });
});

describe('POST /api/feeds', () => {
  it('creates a feed and returns 201', async () => {
    resetDb();
    const { db, dbPath } = makeTempDb();
    const ttsId = seedTts(db);
    db.$client.close();

    const app = createApp(dbPath);
    const res = await request(app).post('/api/feeds').send(feedPayload(ttsId));
    expect(res.status).toBe(201);
    expect(res.body.slug).toBe('my-feed');
    expect(res.body.id).toBeTypeOf('number');
  });

  it('returns 400 for missing required fields', async () => {
    resetDb();
    const { dbPath } = makeTempDb();
    const app = createApp(dbPath);
    const res = await request(app).post('/api/feeds').send({ name: 'Incomplete' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid slug', async () => {
    resetDb();
    const { db, dbPath } = makeTempDb();
    const ttsId = seedTts(db);
    db.$client.close();

    const app = createApp(dbPath);
    const res = await request(app).post('/api/feeds').send(feedPayload(ttsId, 'Bad Slug!!'));
    expect(res.status).toBe(400);
  });

  it('returns 400 for unknown tts_service_id', async () => {
    resetDb();
    const { dbPath } = makeTempDb();
    const app = createApp(dbPath);
    const res = await request(app).post('/api/feeds').send(feedPayload(9999));
    expect(res.status).toBe(400);
  });

  it('returns 409 for duplicate slug', async () => {
    resetDb();
    const { db, dbPath } = makeTempDb();
    const ttsId = seedTts(db);
    insertFeed(db, feedPayload(ttsId));
    db.$client.close();

    const app = createApp(dbPath);
    const res = await request(app).post('/api/feeds').send(feedPayload(ttsId));
    expect(res.status).toBe(409);
  });
});

describe('PUT /api/feeds/:id', () => {
  it('updates a feed and returns the updated record', async () => {
    resetDb();
    const { db, dbPath } = makeTempDb();
    const ttsId = seedTts(db);
    const feed = insertFeed(db, feedPayload(ttsId));
    db.$client.close();

    const app = createApp(dbPath);
    const res = await request(app).put(`/api/feeds/${feed.id}`).send({ title: 'Updated Title' });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Updated Title');
    expect(res.body.slug).toBe('my-feed');
  });

  it('returns 404 for unknown feed id', async () => {
    resetDb();
    const { dbPath } = makeTempDb();
    const app = createApp(dbPath);
    const res = await request(app).put('/api/feeds/9999').send({ title: 'X' });
    expect(res.status).toBe(404);
  });

  it('returns 400 for invalid slug in update', async () => {
    resetDb();
    const { db, dbPath } = makeTempDb();
    const ttsId = seedTts(db);
    const feed = insertFeed(db, feedPayload(ttsId));
    db.$client.close();

    const app = createApp(dbPath);
    const res = await request(app).put(`/api/feeds/${feed.id}`).send({ slug: 'Bad Slug!!' });
    expect(res.status).toBe(400);
  });

  it('returns 409 when updated slug conflicts with another feed', async () => {
    resetDb();
    const { db, dbPath } = makeTempDb();
    const ttsId = seedTts(db);
    const feed1 = insertFeed(db, feedPayload(ttsId, 'feed-one'));
    insertFeed(db, feedPayload(ttsId, 'feed-two'));
    db.$client.close();

    const app = createApp(dbPath);
    const res = await request(app).put(`/api/feeds/${feed1.id}`).send({ slug: 'feed-two' });
    expect(res.status).toBe(409);
  });
});

describe('DELETE /api/feeds/:id', () => {
  it('deletes a feed with no articles and returns 204', async () => {
    resetDb();
    const { db, dbPath } = makeTempDb();
    const ttsId = seedTts(db);
    const feed = insertFeed(db, feedPayload(ttsId));
    db.$client.close();

    const app = createApp(dbPath);
    const res = await request(app).delete(`/api/feeds/${feed.id}`);
    expect(res.status).toBe(204);

    const check = await request(app).get('/api/feeds');
    expect(check.body).toHaveLength(0);
  });

  it('returns 404 for unknown feed id', async () => {
    resetDb();
    const { dbPath } = makeTempDb();
    const app = createApp(dbPath);
    const res = await request(app).delete('/api/feeds/9999');
    expect(res.status).toBe(404);
  });

  it('cascades articles and audio files, returns 204', async () => {
    resetDb();
    const { db, dbPath } = makeTempDb();
    const audioDir = fs.mkdtempSync(path.join(os.tmpdir(), 'narratio-audio-'));
    const ttsId = seedTts(db);
    const feedA = insertFeed(db, feedPayload(ttsId, 'feed-a'));
    const feedB = insertFeed(db, feedPayload(ttsId, 'feed-b'));

    insertArticle(db, { guid: 'a1', feed_url: feedA.rss_url, feed_id: feedA.id, title: 'A1', link: null, pub_date: null, content: null, image_url: null });
    markArticleDone(db, 'a1', 'a1.wav', 0);
    insertArticle(db, { guid: 'a2', feed_url: feedA.rss_url, feed_id: feedA.id, title: 'A2', link: null, pub_date: null, content: null, image_url: null });
    markArticleDone(db, 'a2', 'a2.wav', 0);
    insertArticle(db, { guid: 'b1', feed_url: feedB.rss_url, feed_id: feedB.id, title: 'B1', link: null, pub_date: null, content: null, image_url: null });
    markArticleDone(db, 'b1', 'b1.wav', 0);
    db.$client.close();

    // Write real WAV files
    const wavA1 = path.join(audioDir, 'a1.wav');
    const wavA2 = path.join(audioDir, 'a2.wav');
    const wavB1 = path.join(audioDir, 'b1.wav');
    fs.writeFileSync(wavA1, Buffer.from('RIFFxxxxWAVE'));
    fs.writeFileSync(wavA2, Buffer.from('RIFFxxxxWAVE'));
    fs.writeFileSync(wavB1, Buffer.from('RIFFxxxxWAVE'));

    const app = createApp(dbPath, audioDir);
    const res = await request(app).delete(`/api/feeds/${feedA.id}`);
    expect(res.status).toBe(204);

    // Feed A rows gone, feed B intact
    const list = await request(app).get('/api/feeds');
    expect(list.body).toHaveLength(1);
    expect(list.body[0].slug).toBe('feed-b');

    // Feed A WAVs gone; feed B WAV intact
    expect(fs.existsSync(wavA1)).toBe(false);
    expect(fs.existsSync(wavA2)).toBe(false);
    expect(fs.existsSync(wavB1)).toBe(true);
  });

  it('returns 204 even when audio files are already missing (ENOENT)', async () => {
    resetDb();
    const { db, dbPath } = makeTempDb();
    const audioDir = fs.mkdtempSync(path.join(os.tmpdir(), 'narratio-audio-'));
    const ttsId = seedTts(db);
    const feed = insertFeed(db, feedPayload(ttsId));
    insertArticle(db, { guid: 'a1', feed_url: feed.rss_url, feed_id: feed.id, title: 'A1', link: null, pub_date: null, content: null, image_url: null });
    markArticleDone(db, 'a1', 'ghost.wav', 0);
    db.$client.close();

    // Do NOT create ghost.wav

    const app = createApp(dbPath, audioDir);
    const res = await request(app).delete(`/api/feeds/${feed.id}`);
    expect(res.status).toBe(204);

    const list = await request(app).get('/api/feeds');
    expect(list.body).toHaveLength(0);
  });
});

describe('GET /api/tts-services', () => {
  it('returns 200 with an array', async () => {
    resetDb();
    const { dbPath } = makeTempDb();
    const app = createApp(dbPath);
    const res = await request(app).get('/api/tts-services');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('includes seeded TTS services', async () => {
    resetDb();
    const { db, dbPath } = makeTempDb();
    seedTts(db);
    db.$client.close();

    const app = createApp(dbPath);
    const res = await request(app).get('/api/tts-services');
    expect(res.status).toBe(200);
    expect(res.body.some((s: { name: string }) => s.name === 'Test TTS')).toBe(true);
  });
});
