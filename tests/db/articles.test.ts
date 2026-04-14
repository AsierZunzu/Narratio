import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  insertArticle,
  getArticleByGuid,
  markArticleDone,
  markArticleFailed,
  markArticlePurged,
  resetFailedRetries,
  getPendingArticles,
  getRetryableArticles,
  getPublishedArticles,
} from '../../src/db/articles.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS articles (
  guid         TEXT PRIMARY KEY,
  feed_url     TEXT NOT NULL,
  title        TEXT NOT NULL,
  link         TEXT,
  pub_date     TEXT,
  content      TEXT,
  image_url    TEXT,
  audio_file   TEXT,
  status       TEXT NOT NULL DEFAULT 'pending',
  tts_retries  INTEGER NOT NULL DEFAULT 0,
  error        TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

function makeDb() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  return db;
}

const BASE_ARTICLE = {
  guid: 'test-guid-1',
  feed_url: 'https://example.com/feed',
  title: 'Test Article',
  link: 'https://example.com/article',
  pub_date: '2026-01-01T00:00:00Z',
  content: 'Hello world',
  image_url: null,
};

describe('insertArticle', () => {
  it('inserts a new article and returns true', () => {
    const db = makeDb();
    const inserted = insertArticle(db, BASE_ARTICLE);
    expect(inserted).toBe(true);
    const row = getArticleByGuid(db, BASE_ARTICLE.guid);
    expect(row?.title).toBe('Test Article');
    expect(row?.status).toBe('pending');
  });

  it('skips duplicate guid and returns false', () => {
    const db = makeDb();
    insertArticle(db, BASE_ARTICLE);
    const second = insertArticle(db, BASE_ARTICLE);
    expect(second).toBe(false);
  });
});

describe('markArticleDone', () => {
  it('sets status to done and stores audio_file', () => {
    const db = makeDb();
    insertArticle(db, BASE_ARTICLE);
    markArticleDone(db, BASE_ARTICLE.guid, 'test-guid-1.wav');
    const row = getArticleByGuid(db, BASE_ARTICLE.guid);
    expect(row?.status).toBe('done');
    expect(row?.audio_file).toBe('test-guid-1.wav');
    expect(row?.error).toBeNull();
  });
});

describe('markArticleFailed', () => {
  it('increments tts_retries and stores error', () => {
    const db = makeDb();
    insertArticle(db, BASE_ARTICLE);
    markArticleFailed(db, BASE_ARTICLE.guid, 'TTS timeout');
    const row = getArticleByGuid(db, BASE_ARTICLE.guid);
    expect(row?.status).toBe('failed');
    expect(row?.tts_retries).toBe(1);
    expect(row?.error).toBe('TTS timeout');
  });

  it('increments retries on each failure', () => {
    const db = makeDb();
    insertArticle(db, BASE_ARTICLE);
    markArticleFailed(db, BASE_ARTICLE.guid, 'err1');
    markArticleFailed(db, BASE_ARTICLE.guid, 'err2');
    const row = getArticleByGuid(db, BASE_ARTICLE.guid);
    expect(row?.tts_retries).toBe(2);
  });
});

describe('markArticlePurged', () => {
  it('sets status to purged and clears audio_file', () => {
    const db = makeDb();
    insertArticle(db, BASE_ARTICLE);
    markArticleDone(db, BASE_ARTICLE.guid, 'audio.wav');
    markArticlePurged(db, BASE_ARTICLE.guid);
    const row = getArticleByGuid(db, BASE_ARTICLE.guid);
    expect(row?.status).toBe('purged');
    expect(row?.audio_file).toBeNull();
  });
});

describe('resetFailedRetries', () => {
  it('resets all failed articles to pending with 0 retries', () => {
    const db = makeDb();
    insertArticle(db, BASE_ARTICLE);
    markArticleFailed(db, BASE_ARTICLE.guid, 'error');
    const count = resetFailedRetries(db);
    expect(count).toBe(1);
    const row = getArticleByGuid(db, BASE_ARTICLE.guid);
    expect(row?.status).toBe('pending');
    expect(row?.tts_retries).toBe(0);
  });
});

describe('getPendingArticles', () => {
  it('returns only pending articles', () => {
    const db = makeDb();
    insertArticle(db, BASE_ARTICLE);
    insertArticle(db, { ...BASE_ARTICLE, guid: 'guid-2', title: 'Done' });
    markArticleDone(db, 'guid-2', 'guid-2.wav');
    const pending = getPendingArticles(db);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.guid).toBe(BASE_ARTICLE.guid);
  });
});

describe('getRetryableArticles', () => {
  it('returns failed articles below the retry limit', () => {
    const db = makeDb();
    insertArticle(db, BASE_ARTICLE);
    markArticleFailed(db, BASE_ARTICLE.guid, 'err'); // tts_retries = 1
    const retryable = getRetryableArticles(db, 3);
    expect(retryable).toHaveLength(1);
  });

  it('excludes articles at or above retry limit', () => {
    const db = makeDb();
    insertArticle(db, BASE_ARTICLE);
    markArticleFailed(db, BASE_ARTICLE.guid, 'e');
    markArticleFailed(db, BASE_ARTICLE.guid, 'e');
    markArticleFailed(db, BASE_ARTICLE.guid, 'e'); // tts_retries = 3
    const retryable = getRetryableArticles(db, 3);
    expect(retryable).toHaveLength(0);
  });
});

describe('getPublishedArticles', () => {
  it('returns done, purged, and failed articles', () => {
    const db = makeDb();
    insertArticle(db, { ...BASE_ARTICLE, guid: 'g1' });
    insertArticle(db, { ...BASE_ARTICLE, guid: 'g2' });
    insertArticle(db, { ...BASE_ARTICLE, guid: 'g3' });
    insertArticle(db, { ...BASE_ARTICLE, guid: 'g4' });
    markArticleDone(db, 'g1', 'g1.wav');
    markArticlePurged(db, 'g2');
    markArticleFailed(db, 'g3', 'err');
    // g4 stays pending — should NOT appear
    const published = getPublishedArticles(db);
    const guids = published.map((a) => a.guid);
    expect(guids).toContain('g1');
    expect(guids).toContain('g2');
    expect(guids).toContain('g3');
    expect(guids).not.toContain('g4');
  });
});
