import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { buildFeedXml } from '../../src/server/feed.js';
import { insertArticle, markArticleDone, markArticlePurged, markArticleFailed } from '../../src/db/articles.js';

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

function makeDb() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  return db;
}

const BASE_URL = 'http://localhost:3000';
const CONFIG = { baseUrl: BASE_URL };

describe('buildFeedXml', () => {
  let db: Database.Database;

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
    markArticleDone(db, 'g1', 'g1.wav');

    const xml = buildFeedXml(db, CONFIG);
    expect(xml).toContain('My Article');
    expect(xml).toContain(`${BASE_URL}/audio/g1.wav`);
  });

  it('prefixes purged articles with [PURGED]', () => {
    insertArticle(db, { guid: 'g2', feed_url: 'https://example.com/feed', title: 'Gone', link: null, pub_date: null, content: null, image_url: null });
    markArticleDone(db, 'g2', 'g2.wav');
    markArticlePurged(db, 'g2');

    const xml = buildFeedXml(db, CONFIG);
    expect(xml).toContain('[PURGED] Gone');
    expect(xml).toContain(`${BASE_URL}/audio/unavailable.wav`);
  });

  it('prefixes TTS-failed articles with [TTS FAILED]', () => {
    insertArticle(db, { guid: 'g3', feed_url: 'https://example.com/feed', title: 'Broken', link: null, pub_date: null, content: null, image_url: null });
    markArticleFailed(db, 'g3', 'tts error');
    // Force status to failed without audio (simulate permanently failed)
    db.prepare("UPDATE articles SET status = 'failed' WHERE guid = 'g3'").run();

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
