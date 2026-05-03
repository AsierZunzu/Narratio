import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../src/db/schema.js';
import { TEST_SCHEMA_SQL as SCHEMA_SQL } from '../helpers/schema.js';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { processFeed, normalisePubDate } from '../../src/services/rss.js';
import { getArticleByGuid } from '../../src/db/articles.js';
import type { Db } from '../../src/db/index.js';

function makeDb(): Db {
  const sqlite = new Database(':memory:');
  sqlite.exec(SCHEMA_SQL);
  return drizzle(sqlite, { schema });
}

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'narratio-rss-'));
}

// We mock the rss-parser and synthesise at module level
vi.mock('rss-parser', () => {
  const items: Array<Record<string, unknown>> = [];
  class Parser {
    static _items = items;
    parseString() {
      return Promise.resolve({ items });
    }
  }
  return { default: Parser };
});

// processFeed now fetches the feed XML itself; stub global fetch so tests
// don't hit the network. The body is ignored because parseString is mocked.
vi.stubGlobal('fetch', vi.fn(async () => ({
  ok: true,
  status: 200,
  statusText: 'OK',
  headers: new Headers({ 'content-type': 'application/rss+xml; charset=utf-8' }),
  arrayBuffer: async () => new ArrayBuffer(0),
})));

vi.mock('../../src/services/tts.js', () => ({
  synthesise: vi.fn(),
}));

import { synthesise } from '../../src/services/tts.js';
import ParserDefault from 'rss-parser';

const mockSynthesize = synthesise as ReturnType<typeof vi.fn>;
const MockParser = ParserDefault as unknown as { _items: Array<Record<string, unknown>> };

function setFeedItems(items: Array<Record<string, unknown>>) {
  MockParser._items.length = 0;
  MockParser._items.push(...items);
}

describe('processFeed', () => {
  let db: Db;
  let tmpDir: string;

  const baseOpts = () => ({
    feedId: 1,
    feedUrl: 'https://example.com/feed',
    fetchTimeoutMs: 5000,
    maxRetries: 3,
    tts: { host: '127.0.0.1', port: 10200, timeoutMs: 5000, outputDir: '' },
    audioDir: '',
  });

  beforeEach(() => {
    db = makeDb();
    tmpDir = makeTempDir();
    mockSynthesize.mockReset();
  });

  it('inserts new articles from feed', async () => {
    setFeedItems([{ title: 'Article 1', guid: 'g1' }]);
    mockSynthesize.mockResolvedValue(path.join(tmpDir, 'g1.wav'));

    await processFeed(db, baseOpts());

    const article = getArticleByGuid(db, 'g1');
    expect(article).toBeDefined();
    expect(article?.title).toBe('Article 1');
  });

  it('marks article done when TTS succeeds', async () => {
    setFeedItems([{ title: 'Success', guid: 'g2' }]);
    mockSynthesize.mockResolvedValue(path.join(tmpDir, 'g2.wav'));

    await processFeed(db, baseOpts());

    const article = getArticleByGuid(db, 'g2');
    expect(article?.status).toBe('done');
  });

  it('marks article failed when TTS throws', async () => {
    setFeedItems([{ title: 'Fail', guid: 'g3' }]);
    mockSynthesize.mockRejectedValue(new Error('connection refused'));

    await processFeed(db, baseOpts());

    const article = getArticleByGuid(db, 'g3');
    expect(article?.status).toBe('failed');
    expect(article?.tts_retries).toBe(1);
    expect(article?.error).toContain('connection refused');
  });

  it('skips duplicate articles', async () => {
    setFeedItems([{ title: 'Dupe', guid: 'g4' }]);
    mockSynthesize.mockResolvedValue(path.join(tmpDir, 'g4.wav'));

    await processFeed(db, baseOpts());
    mockSynthesize.mockClear();
    setFeedItems([{ title: 'Dupe', guid: 'g4' }]);
    await processFeed(db, baseOpts());

    // synthesise should only be called once across both runs (the second run the
    // article is already done, so it won't be in pending or retryable lists)
    expect(mockSynthesize).not.toHaveBeenCalled();
  });

  it('retries failed articles within retry limit', async () => {
    setFeedItems([{ title: 'Retry', guid: 'g5' }]);
    // First call fails, second call succeeds (retry)
    mockSynthesize
      .mockRejectedValueOnce(new Error('transient error'))
      .mockResolvedValue(path.join(tmpDir, 'g5.wav'));

    await processFeed(db, baseOpts());

    // After first processFeed: article is failed with 1 retry.
    // Run again to trigger retry path.
    setFeedItems([]);
    await processFeed(db, baseOpts());

    const article = getArticleByGuid(db, 'g5');
    expect(article?.status).toBe('done');
  });

  it('stores pub_date as ISO 8601 so lexicographic order matches chronology', async () => {
    setFeedItems([
      { title: 'Older', guid: 'date-old', pubDate: 'Fri, 01 May 2026 09:00:00 GMT' },
      { title: 'Newer', guid: 'date-new', pubDate: 'Mon, 04 May 2026 09:00:00 GMT' },
    ]);
    mockSynthesize.mockResolvedValue(path.join(tmpDir, 'x.wav'));

    await processFeed(db, baseOpts());

    const older = getArticleByGuid(db, 'date-old');
    const newer = getArticleByGuid(db, 'date-new');
    expect(older?.pub_date?.toISOString()).toBe('2026-05-01T09:00:00.000Z');
    expect(newer?.pub_date?.toISOString()).toBe('2026-05-04T09:00:00.000Z');
    expect(newer!.pub_date!.getTime() > older!.pub_date!.getTime()).toBe(true);
  });

  it('prefers isoDate when both date fields present', async () => {
    setFeedItems([
      { title: 'A', guid: 'date-iso', pubDate: 'garbage', isoDate: '2026-05-02T12:00:00.000Z' },
    ]);
    mockSynthesize.mockResolvedValue(path.join(tmpDir, 'x.wav'));

    await processFeed(db, baseOpts());

    const a = getArticleByGuid(db, 'date-iso');
    expect(a?.pub_date?.toISOString()).toBe('2026-05-02T12:00:00.000Z');
  });

  describe('normalisePubDate', () => {
    it('converts RFC 2822 to a Date', () => {
      expect(normalisePubDate('Mon, 02 May 2026 09:00:00 GMT')?.toISOString()).toBe('2026-05-02T09:00:00.000Z');
    });
    it('parses ISO 8601 to a Date', () => {
      expect(normalisePubDate('2026-05-02T09:00:00.000Z')?.toISOString()).toBe('2026-05-02T09:00:00.000Z');
    });
    it('returns null for missing or unparseable input', () => {
      expect(normalisePubDate(null)).toBeNull();
      expect(normalisePubDate(undefined)).toBeNull();
      expect(normalisePubDate('')).toBeNull();
      expect(normalisePubDate('not a date')).toBeNull();
    });
  });

  it('permanently fails article after exhausting retries', async () => {
    setFeedItems([{ title: 'Exhaust', guid: 'g6' }]);
    mockSynthesize.mockRejectedValue(new Error('always fails'));

    // maxRetries = 1: after 1 failure it should be permanently failed
    const opts = { ...baseOpts(), maxRetries: 1 };
    await processFeed(db, opts);

    const article = getArticleByGuid(db, 'g6');
    expect(article?.status).toBe('failed');
  });
});
