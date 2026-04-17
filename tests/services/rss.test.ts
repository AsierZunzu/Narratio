import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../src/db/schema.js';
import net from 'net';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { processFeed } from '../../src/services/rss.js';
import { getArticleByGuid, getPublishedArticles } from '../../src/db/articles.js';
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

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'narratio-rss-'));
}

const FAKE_WAV = Buffer.alloc(44, 0); // minimal non-empty buffer

function buildFeedXml(items: Array<{ title: string; guid: string; content?: string; link?: string }>) {
  const itemsXml = items
    .map(
      (i) => `
    <item>
      <title>${i.title}</title>
      <guid>${i.guid}</guid>
      ${i.link ? `<link>${i.link}</link>` : ''}
      ${i.content ? `<description>${i.content}</description>` : ''}
    </item>`,
    )
    .join('');
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>Test</title>${itemsXml}</channel></rss>`;
}

// We mock the rss-parser and synthesise at module level
vi.mock('rss-parser', () => {
  const items: Array<Record<string, unknown>> = [];
  const Parser = vi.fn().mockImplementation(() => ({
    parseURL: vi.fn().mockResolvedValue({ items }),
  }));
  // Expose items array so tests can mutate it
  (Parser as unknown as { _items: typeof items })._items = items;
  return { default: Parser };
});

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
