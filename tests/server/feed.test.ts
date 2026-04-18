import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../src/db/schema.js';
import { TEST_SCHEMA_SQL as SCHEMA_SQL } from '../helpers/schema.js';
import { buildFeedXml } from '../../src/server/feed.js';
import { insertArticle, markArticleDone, markArticlePurged, markArticleFailed, updateArticleStatus } from '../../src/db/articles.js';
import { insertFeed } from '../../src/db/feeds.js';
import { insertTtsService } from '../../src/db/tts-services.js';
import type { Db, Feed } from '../../src/db/index.js';

function makeDb(): Db {
  const sqlite = new Database(':memory:');
  sqlite.exec(SCHEMA_SQL);
  return drizzle(sqlite, { schema });
}

const BASE_URL = 'http://localhost:3000';

function seedFeed(db: Db): Feed {
  const tts = insertTtsService(db, { name: 'Test TTS', host: 'localhost', port: 10200 });
  return insertFeed(db, {
    name: 'Test Feed',
    rss_url: 'https://example.com/feed',
    slug: 'test-feed',
    title: 'Test Podcast',
    description: 'Test description',
    author: 'Test Author',
    language: 'en',
    itunes_owner_email: 'test@example.com',
    itunes_category: 'Technology',
    tts_service_id: tts.id,
  });
}

describe('buildFeedXml', () => {
  let db: Db;
  let feed: Feed;

  beforeEach(() => {
    db = makeDb();
    feed = seedFeed(db);
  });

  it('returns valid RSS XML', () => {
    const xml = buildFeedXml(db, feed, BASE_URL);
    expect(xml).toContain('<?xml');
    expect(xml).toContain('<rss');
    expect(xml).toContain('</rss>');
  });

  it('includes feed title', () => {
    const xml = buildFeedXml(db, feed, BASE_URL);
    expect(xml).toContain('Test Podcast');
  });

  it('uses /rss/:slug as the feed URL', () => {
    const xml = buildFeedXml(db, feed, BASE_URL);
    expect(xml).toContain(`${BASE_URL}/rss/test-feed`);
  });

  it('includes done articles with their audio URL', () => {
    insertArticle(db, { guid: 'g1', feed_url: feed.rss_url, feed_id: feed.id, title: 'My Article', link: null, pub_date: null, content: 'Hello', image_url: null });
    markArticleDone(db, 'g1', 'g1.wav', 0);

    const xml = buildFeedXml(db, feed, BASE_URL);
    expect(xml).toContain('My Article');
    expect(xml).toContain(`${BASE_URL}/audio/g1.wav`);
  });

  it('prefixes purged articles with [PURGED]', () => {
    insertArticle(db, { guid: 'g2', feed_url: feed.rss_url, feed_id: feed.id, title: 'Gone', link: null, pub_date: null, content: null, image_url: null });
    markArticleDone(db, 'g2', 'g2.wav', 0);
    markArticlePurged(db, 'g2');

    const xml = buildFeedXml(db, feed, BASE_URL);
    expect(xml).toContain('[PURGED] Gone');
    expect(xml).toContain(`${BASE_URL}/audio/unavailable.wav`);
  });

  it('prefixes TTS-failed articles with [TTS FAILED]', () => {
    insertArticle(db, { guid: 'g3', feed_url: feed.rss_url, feed_id: feed.id, title: 'Broken', link: null, pub_date: null, content: null, image_url: null });
    markArticleFailed(db, 'g3', 'tts error');
    updateArticleStatus(db, 'g3', 'failed');

    const xml = buildFeedXml(db, feed, BASE_URL);
    expect(xml).toContain('[TTS FAILED] Broken');
    expect(xml).toContain(`${BASE_URL}/audio/tts-failed.wav`);
  });

  it('excludes articles from other feeds', () => {
    const tts2 = insertTtsService(db, { name: 'TTS 2', host: 'localhost', port: 10201 });
    const feed2 = insertFeed(db, { name: 'Other Feed', rss_url: 'https://other.com/feed', slug: 'other-feed', title: 'Other', tts_service_id: tts2.id });
    insertArticle(db, { guid: 'other1', feed_url: feed2.rss_url, feed_id: feed2.id, title: 'Other Article', link: null, pub_date: null, content: null, image_url: null });
    markArticleDone(db, 'other1', 'other1.wav', 0);

    const xml = buildFeedXml(db, feed, BASE_URL);
    expect(xml).not.toContain('Other Article');
  });

  it('excludes pending articles', () => {
    insertArticle(db, { guid: 'g4', feed_url: feed.rss_url, feed_id: feed.id, title: 'Pending Article', link: null, pub_date: null, content: null, image_url: null });

    const xml = buildFeedXml(db, feed, BASE_URL);
    expect(xml).not.toContain('Pending Article');
  });

  it('returns empty item list for empty DB', () => {
    const xml = buildFeedXml(db, feed, BASE_URL);
    expect(xml).not.toContain('<item>');
  });
});
