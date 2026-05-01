import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import * as schema from '../../src/db/schema.js';
import { articles } from '../../src/db/schema.js';
import { TEST_SCHEMA_SQL as SCHEMA_SQL } from '../helpers/schema.js';
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
  requeueArticleForTts,
  getArticlesPage,
  getArticleStatusCounts,
} from '../../src/db/articles.js';

function makeDb() {
  const sqlite = new Database(':memory:');
  sqlite.exec(SCHEMA_SQL);
  return drizzle(sqlite, { schema });
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
    markArticleDone(db, BASE_ARTICLE.guid, 'test-guid-1.wav', 0);
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
    markArticleDone(db, BASE_ARTICLE.guid, 'audio.wav', 0);
    markArticlePurged(db, BASE_ARTICLE.guid);
    const row = getArticleByGuid(db, BASE_ARTICLE.guid);
    expect(row?.status).toBe('purged');
    expect(row?.audio_file).toBeNull();
  });
});

describe('requeueArticleForTts', () => {
  it('resets a done article to pending and returns its audio_file', () => {
    const db = makeDb();
    insertArticle(db, BASE_ARTICLE);
    markArticleDone(db, BASE_ARTICLE.guid, 'a.wav', 1234);
    db.update(articles).set({ tts_retries: 2 }).where(eq(articles.guid, BASE_ARTICLE.guid)).run();

    const result = requeueArticleForTts(db, BASE_ARTICLE.guid);
    expect(result).toEqual({ audio_file: 'a.wav' });

    const row = getArticleByGuid(db, BASE_ARTICLE.guid);
    expect(row?.status).toBe('pending');
    expect(row?.audio_file).toBeNull();
    expect(row?.tts_retries).toBe(0);
    expect(row?.error).toBeNull();
    expect(row?.tts_elapsed_ms).toBeNull();
  });

  it('resets a purged article to pending with null audio_file', () => {
    const db = makeDb();
    insertArticle(db, BASE_ARTICLE);
    markArticleDone(db, BASE_ARTICLE.guid, 'a.wav', 500);
    markArticlePurged(db, BASE_ARTICLE.guid);

    const result = requeueArticleForTts(db, BASE_ARTICLE.guid);
    expect(result).toEqual({ audio_file: null });

    const row = getArticleByGuid(db, BASE_ARTICLE.guid);
    expect(row?.status).toBe('pending');
    expect(row?.audio_file).toBeNull();
    expect(row?.tts_retries).toBe(0);
    expect(row?.error).toBeNull();
    expect(row?.tts_elapsed_ms).toBeNull();
  });

  it('resets a failed article to pending and clears the error', () => {
    const db = makeDb();
    insertArticle(db, BASE_ARTICLE);
    db.update(articles)
      .set({ status: 'failed', error: 'boom', tts_retries: 5 })
      .where(eq(articles.guid, BASE_ARTICLE.guid))
      .run();

    const result = requeueArticleForTts(db, BASE_ARTICLE.guid);
    expect(result).toEqual({ audio_file: null });

    const row = getArticleByGuid(db, BASE_ARTICLE.guid);
    expect(row?.status).toBe('pending');
    expect(row?.error).toBeNull();
    expect(row?.tts_retries).toBe(0);
    expect(row?.tts_elapsed_ms).toBeNull();
  });

  it('returns null and does not change a converting article', () => {
    const db = makeDb();
    insertArticle(db, BASE_ARTICLE);
    db.update(articles).set({ status: 'converting' }).where(eq(articles.guid, BASE_ARTICLE.guid)).run();

    const result = requeueArticleForTts(db, BASE_ARTICLE.guid);
    expect(result).toBeNull();

    const row = getArticleByGuid(db, BASE_ARTICLE.guid);
    expect(row?.status).toBe('converting');
  });

  it('returns null for an unknown guid', () => {
    const db = makeDb();
    const result = requeueArticleForTts(db, 'does-not-exist');
    expect(result).toBeNull();
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
    markArticleDone(db, 'guid-2', 'guid-2.wav', 0);
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
    markArticleDone(db, 'g1', 'g1.wav', 0);
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

describe('getArticlesPage / getArticleStatusCounts', () => {
  function seed() {
    const db = makeDb();
    // 5 pending, 3 done, 2 failed, 1 purged
    for (let i = 0; i < 5; i++) {
      insertArticle(db, { guid: `p${i}`, feed_url: 'f', title: `Pending Apple ${i}`, link: null, pub_date: `2026-01-${String(10 + i).padStart(2, '0')}`, content: 'apple', image_url: null });
    }
    for (let i = 0; i < 3; i++) {
      insertArticle(db, { guid: `d${i}`, feed_url: 'f', title: `Done Banana ${i}`, link: null, pub_date: `2026-02-${String(10 + i).padStart(2, '0')}`, content: 'banana', image_url: null });
      markArticleDone(db, `d${i}`, `d${i}.wav`, 100);
    }
    for (let i = 0; i < 2; i++) {
      insertArticle(db, { guid: `f${i}`, feed_url: 'f', title: `Failed ${i}`, link: null, pub_date: '2026-03-01', content: 'cherry', image_url: null });
      markArticleFailed(db, `f${i}`, 'err');
    }
    insertArticle(db, { guid: 'pu1', feed_url: 'f', title: 'Purged Apple', link: null, pub_date: '2026-04-01', content: 'apple slice', image_url: null });
    markArticlePurged(db, 'pu1');
    return db;
  }

  it('paginates ordered results with limit and offset', () => {
    const db = seed();
    const page1 = getArticlesPage(db, { limit: 5, offset: 0 });
    const page2 = getArticlesPage(db, { limit: 5, offset: 5 });
    expect(page1).toHaveLength(5);
    expect(page2).toHaveLength(5);
    const ids1 = page1.map((a) => a.guid);
    const ids2 = page2.map((a) => a.guid);
    expect(ids1.some((g) => ids2.includes(g))).toBe(false);
  });

  it('filters by status', () => {
    const db = seed();
    const done = getArticlesPage(db, { status: 'done', limit: 100, offset: 0 });
    expect(done).toHaveLength(3);
    expect(done.every((a) => a.status === 'done')).toBe(true);
  });

  it('filters by case-insensitive search across title and content', () => {
    const db = seed();
    const matches = getArticlesPage(db, { search: 'APPLE', limit: 100, offset: 0 });
    // 5 pending titled "Pending Apple ...", and 1 purged "Purged Apple"
    expect(matches.length).toBe(6);
  });

  it('combines status and search', () => {
    const db = seed();
    const matches = getArticlesPage(db, { status: 'pending', search: 'apple', limit: 100, offset: 0 });
    expect(matches).toHaveLength(5);
  });

  it('returns counts grouped by status', () => {
    const db = seed();
    const counts = getArticleStatusCounts(db);
    expect(counts.all).toBe(11);
    expect(counts.pending).toBe(5);
    expect(counts.done).toBe(3);
    expect(counts.failed).toBe(2);
    expect(counts.purged).toBe(1);
    expect(counts.converting).toBe(0);
  });

  it('counts honor the search filter', () => {
    const db = seed();
    const counts = getArticleStatusCounts(db, 'apple');
    expect(counts.all).toBe(6);
    expect(counts.pending).toBe(5);
    expect(counts.purged).toBe(1);
    expect(counts.done).toBe(0);
  });
});
