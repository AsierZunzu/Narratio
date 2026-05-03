import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { getDb, resetDb } from '../../src/db/index.js';
import { articles } from '../../src/db/schema.js';
import { eq } from 'drizzle-orm';

const tmpFiles: string[] = [];

afterEach(() => {
  resetDb();
  for (const f of tmpFiles.splice(0)) {
    try { fs.rmSync(f, { force: true }); } catch { /* ignore */ }
  }
});

function newTmpDb(): string {
  const p = path.join(os.tmpdir(), `narratio-mig-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  tmpFiles.push(p);
  return p;
}

function seedLegacyArticlesTable(dbPath: string, rows: Array<{ guid: string; pub_date: string | null }>): void {
  const sqlite = new Database(dbPath);
  sqlite.exec(`
    CREATE TABLE articles (
      guid            TEXT PRIMARY KEY,
      feed_url        TEXT NOT NULL,
      feed_id         INTEGER,
      title           TEXT NOT NULL,
      link            TEXT,
      pub_date        TEXT,
      content         TEXT,
      image_url       TEXT,
      audio_file      TEXT,
      status          TEXT NOT NULL DEFAULT 'pending',
      tts_retries     INTEGER NOT NULL DEFAULT 0,
      tts_elapsed_ms  INTEGER,
      error           TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  const stmt = sqlite.prepare('INSERT INTO articles (guid, feed_url, title, pub_date) VALUES (?, ?, ?, ?)');
  for (const r of rows) stmt.run(r.guid, 'https://example.com/feed', `T-${r.guid}`, r.pub_date);
  sqlite.close();
}

describe('articles.pub_date TEXT → INTEGER migration', () => {
  it('converts mixed RFC 2822 / ISO 8601 / SQLite datetime values to ms epoch', () => {
    const dbPath = newTmpDb();
    seedLegacyArticlesTable(dbPath, [
      { guid: 'iso',    pub_date: '2026-05-02T09:00:00.000Z' },
      { guid: 'rfc',    pub_date: 'Mon, 02 May 2026 09:00:00 GMT' },
      { guid: 'sqlite', pub_date: '2026-05-02 09:00:00' },
      { guid: 'bad',    pub_date: 'not-a-date' },
      { guid: 'null',   pub_date: null },
    ]);

    const db = getDb(dbPath);
    const rows = db.select().from(articles).all();
    const byGuid = Object.fromEntries(rows.map((r) => [r.guid, r]));

    const expectedMs = new Date('2026-05-02T09:00:00.000Z').getTime();
    expect(byGuid['iso']!.pub_date?.getTime()).toBe(expectedMs);
    expect(byGuid['rfc']!.pub_date?.getTime()).toBe(expectedMs);
    expect(byGuid['sqlite']!.pub_date).toBeInstanceOf(Date);
    expect(byGuid['bad']!.pub_date).toBeNull();
    expect(byGuid['null']!.pub_date).toBeNull();

    const cols = (db.$client.prepare('PRAGMA table_info(articles)').all() as Array<{ name: string; type: string }>);
    expect(cols.find((c) => c.name === 'pub_date')?.type.toUpperCase()).toBe('INTEGER');
    expect(cols.find((c) => c.name === 'pub_date_old')).toBeUndefined();
  });

  it('is idempotent on databases that already have INTEGER pub_date', () => {
    const dbPath = newTmpDb();
    const db1 = getDb(dbPath);
    db1.insert(articles).values({
      guid: 'g1', feed_url: 'f', title: 'T', pub_date: new Date('2026-01-01T00:00:00Z'),
    }).run();
    resetDb();

    const db2 = getDb(dbPath);
    const row = db2.select().from(articles).where(eq(articles.guid, 'g1')).get();
    expect(row?.pub_date?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });
});
