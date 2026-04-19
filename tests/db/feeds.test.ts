import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../src/db/schema.js';
import { TEST_SCHEMA_SQL } from '../helpers/schema.js';
import {
  getFeeds,
  getFeedById,
  getFeedBySlug,
  insertFeed,
  updateFeed,
  deleteFeed,
  deleteFeedWithArticles,
} from '../../src/db/feeds.js';
import { insertArticle, markArticleDone, markArticlePurged, countArticlesByFeed } from '../../src/db/articles.js';
import { insertTtsService } from '../../src/db/tts-services.js';
import type { Db } from '../../src/db/index.js';

function makeDb(): Db {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(TEST_SCHEMA_SQL);
  return drizzle(sqlite, { schema });
}

function seedTtsService(db: Db) {
  return insertTtsService(db, { name: 'Test TTS', host: 'localhost', port: 10200 });
}

function baseFeed(ttsServiceId: number) {
  return {
    name: 'Tech News',
    rss_url: 'https://example.com/feed.xml',
    slug: 'tech-news',
    title: 'Tech News Podcast',
    tts_service_id: ttsServiceId,
  };
}

describe('insertFeed', () => {
  it('inserts and returns the new feed', () => {
    const db = makeDb();
    const tts = seedTtsService(db);
    const feed = insertFeed(db, baseFeed(tts.id));
    expect(feed.id).toBeGreaterThan(0);
    expect(feed.slug).toBe('tech-news');
    expect(feed.title).toBe('Tech News Podcast');
    expect(feed.description).toBe('');
    expect(feed.author).toBe('Narratio');
    expect(feed.language).toBe('en');
    expect(feed.itunes_category).toBe('Technology');
    expect(feed.tts_service_id).toBe(tts.id);
  });

  it('stores optional fields', () => {
    const db = makeDb();
    const tts = seedTtsService(db);
    const feed = insertFeed(db, {
      ...baseFeed(tts.id),
      description: 'Latest tech news',
      author: 'Alice',
      language: 'es',
      max_audio_files: 50,
      max_audio_size_mb: 500,
      unavailable_message: 'Gone',
      tts_failed_message: 'Failed',
    });
    expect(feed.description).toBe('Latest tech news');
    expect(feed.author).toBe('Alice');
    expect(feed.language).toBe('es');
    expect(feed.max_audio_files).toBe(50);
    expect(feed.max_audio_size_mb).toBe(500);
    expect(feed.unavailable_message).toBe('Gone');
    expect(feed.tts_failed_message).toBe('Failed');
  });

  it('rejects duplicate slug', () => {
    const db = makeDb();
    const tts = seedTtsService(db);
    insertFeed(db, baseFeed(tts.id));
    expect(() => insertFeed(db, baseFeed(tts.id))).toThrow();
  });
});

describe('getFeeds', () => {
  it('returns all feeds', () => {
    const db = makeDb();
    const tts = seedTtsService(db);
    insertFeed(db, { ...baseFeed(tts.id), slug: 'feed-1', rss_url: 'https://a.com/f' });
    insertFeed(db, { ...baseFeed(tts.id), slug: 'feed-2', rss_url: 'https://b.com/f' });
    expect(getFeeds(db)).toHaveLength(2);
  });

  it('returns empty array when no feeds', () => {
    const db = makeDb();
    expect(getFeeds(db)).toHaveLength(0);
  });
});

describe('getFeedById', () => {
  it('returns the feed by id', () => {
    const db = makeDb();
    const tts = seedTtsService(db);
    const created = insertFeed(db, baseFeed(tts.id));
    const found = getFeedById(db, created.id);
    expect(found?.slug).toBe('tech-news');
  });

  it('returns undefined for unknown id', () => {
    const db = makeDb();
    expect(getFeedById(db, 999)).toBeUndefined();
  });
});

describe('getFeedBySlug', () => {
  it('returns the feed by slug', () => {
    const db = makeDb();
    const tts = seedTtsService(db);
    insertFeed(db, baseFeed(tts.id));
    const found = getFeedBySlug(db, 'tech-news');
    expect(found?.title).toBe('Tech News Podcast');
  });

  it('returns undefined for unknown slug', () => {
    const db = makeDb();
    expect(getFeedBySlug(db, 'nope')).toBeUndefined();
  });
});

describe('updateFeed', () => {
  it('updates specified fields', () => {
    const db = makeDb();
    const tts = seedTtsService(db);
    const created = insertFeed(db, baseFeed(tts.id));
    const updated = updateFeed(db, created.id, { title: 'New Title', author: 'Bob' });
    expect(updated?.title).toBe('New Title');
    expect(updated?.author).toBe('Bob');
    expect(updated?.slug).toBe('tech-news');
  });

  it('returns undefined for unknown id', () => {
    const db = makeDb();
    const result = updateFeed(db, 999, { title: 'X' });
    expect(result).toBeUndefined();
  });
});

describe('deleteFeed', () => {
  it('removes the feed and returns true', () => {
    const db = makeDb();
    const tts = seedTtsService(db);
    const created = insertFeed(db, baseFeed(tts.id));
    expect(deleteFeed(db, created.id)).toBe(true);
    expect(getFeedById(db, created.id)).toBeUndefined();
  });

  it('returns false for unknown id', () => {
    const db = makeDb();
    expect(deleteFeed(db, 999)).toBe(false);
  });
});

describe('deleteFeedWithArticles', () => {
  it('cascades articles for target feed only and returns audio filenames', () => {
    const db = makeDb();
    const tts = seedTtsService(db);
    const feedA = insertFeed(db, { ...baseFeed(tts.id), slug: 'feed-a', rss_url: 'https://a.com/f' });
    const feedB = insertFeed(db, { ...baseFeed(tts.id), slug: 'feed-b', rss_url: 'https://b.com/f' });

    // Feed A: 3 articles with varied statuses
    insertArticle(db, { guid: 'a1', feed_url: feedA.rss_url, feed_id: feedA.id, title: 'A1', link: null, pub_date: null, content: null, image_url: null });
    markArticleDone(db, 'a1', 'a1.wav', 100);
    insertArticle(db, { guid: 'a2', feed_url: feedA.rss_url, feed_id: feedA.id, title: 'A2', link: null, pub_date: null, content: null, image_url: null });
    // a2 stays pending — audio_file remains null
    insertArticle(db, { guid: 'a3', feed_url: feedA.rss_url, feed_id: feedA.id, title: 'A3', link: null, pub_date: null, content: null, image_url: null });
    markArticleDone(db, 'a3', 'a3.wav', 200);
    markArticlePurged(db, 'a3'); // clears audio_file

    // Feed B: one article we must keep
    insertArticle(db, { guid: 'b1', feed_url: feedB.rss_url, feed_id: feedB.id, title: 'B1', link: null, pub_date: null, content: null, image_url: null });
    markArticleDone(db, 'b1', 'b1.wav', 50);

    const result = deleteFeedWithArticles(db, feedA.id);

    expect(result.articleCount).toBe(3);
    expect(result.audioFiles.sort()).toEqual(['a1.wav']);

    expect(getFeedById(db, feedA.id)).toBeUndefined();
    expect(countArticlesByFeed(db, feedA.id)).toBe(0);

    expect(getFeedById(db, feedB.id)).toBeDefined();
    expect(countArticlesByFeed(db, feedB.id)).toBe(1);
  });

  it('deletes feed with no articles and returns empty filenames', () => {
    const db = makeDb();
    const tts = seedTtsService(db);
    const feed = insertFeed(db, baseFeed(tts.id));
    const result = deleteFeedWithArticles(db, feed.id);
    expect(result.articleCount).toBe(0);
    expect(result.audioFiles).toEqual([]);
    expect(getFeedById(db, feed.id)).toBeUndefined();
  });
});
