import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../src/db/schema.js';
import { buildFeedXml } from '../../src/server/feed.js';
import { insertArticle, markArticleDone, markArticlePurged, markArticleFailed, updateArticleStatus } from '../../src/db/articles.js';
import type { Db } from '../../src/db/index.js';

const SCHEMA_SQL = `
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

function makeDb(): Db {
  const sqlite = new Database(':memory:');
  sqlite.exec(SCHEMA_SQL);
  return drizzle(sqlite, { schema });
}

const BASE_URL = 'http://localhost:3000';
const CONFIG = { baseUrl: BASE_URL };

describe('buildFeedXml', () => {
  let db: Db;

  beforeEach(() => {
    db = makeDb();
    // Set required env for feed builder
    process.env['PODCAST_TITLE'] = 'Test Podcast';
    process.env['PODCAST_DESCRIPTION'] = 'Test description';
    process.env['PODCAST_AUTHOR'] = 'Test Author';
    process.env['PODCAST_LANGUAGE'] = 'en';
    process.env['PODCAST_ITUNES_OWNER_EMAIL'] = 'test@example.com';
    process.env['PODCAST_ITUNES_CATEGORY'] = 'Technology';
  });

  it('returns valid RSS XML', () => {
    const xml = buildFeedXml(db, CONFIG);
    expect(xml).toContain('<?xml');
    expect(xml).toContain('<rss');
    expect(xml).toContain('</rss>');
  });

  it('includes feed title', () => {
    const xml = buildFeedXml(db, CONFIG);
    expect(xml).toContain('Test Podcast');
  });

  it('includes done articles with their audio URL', () => {
    insertArticle(db, { guid: 'g1', feed_url: 'https://example.com/feed', title: 'My Article', link: null, pub_date: null, content: 'Hello', image_url: null });
    markArticleDone(db, 'g1', 'g1.wav', 0);

    const xml = buildFeedXml(db, CONFIG);
    expect(xml).toContain('My Article');
    expect(xml).toContain(`${BASE_URL}/audio/g1.wav`);
  });

  it('prefixes purged articles with [PURGED]', () => {
    insertArticle(db, { guid: 'g2', feed_url: 'https://example.com/feed', title: 'Gone', link: null, pub_date: null, content: null, image_url: null });
    markArticleDone(db, 'g2', 'g2.wav', 0);
    markArticlePurged(db, 'g2');

    const xml = buildFeedXml(db, CONFIG);
    expect(xml).toContain('[PURGED] Gone');
    expect(xml).toContain(`${BASE_URL}/audio/unavailable.wav`);
  });

  it('prefixes TTS-failed articles with [TTS FAILED]', () => {
    insertArticle(db, { guid: 'g3', feed_url: 'https://example.com/feed', title: 'Broken', link: null, pub_date: null, content: null, image_url: null });
    markArticleFailed(db, 'g3', 'tts error');
    // Ensure status is 'failed' (already set by markArticleFailed, but explicit for clarity)
    updateArticleStatus(db, 'g3', 'failed');

    const xml = buildFeedXml(db, CONFIG);
    expect(xml).toContain('[TTS FAILED] Broken');
    expect(xml).toContain(`${BASE_URL}/audio/tts-failed.wav`);
  });

  it('excludes pending articles', () => {
    insertArticle(db, { guid: 'g4', feed_url: 'https://example.com/feed', title: 'Pending Article', link: null, pub_date: null, content: null, image_url: null });

    const xml = buildFeedXml(db, CONFIG);
    expect(xml).not.toContain('Pending Article');
  });

  it('returns empty item list for empty DB', () => {
    const xml = buildFeedXml(db, CONFIG);
    expect(xml).not.toContain('<item>');
  });
});
