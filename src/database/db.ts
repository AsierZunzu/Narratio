import Database from 'better-sqlite3'
import { join, dirname } from 'path'
import { existsSync, mkdirSync } from 'fs'

const DATA_DIR = join(process.cwd(), 'data')
const DB_PATH = join(DATA_DIR, 'podcast.db')

export interface PublishedArticle {
  id: string
  title: string
  link: string
  pub_date: string
  content: string
  audio_path: string | null
  is_purged: number
  image_url: string | null
}

export interface AudioArticle {
  id: string
  audio_path: string
  pub_date: string
}

export interface RetryArticle {
  id: string
  title: string
  content: string
}

export class PodcastDatabase {
  private readonly _db: Database.Database

  constructor(path: string = DB_PATH) {
    const dir = dirname(path)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    this._db = new Database(path)
    this._db.pragma('journal_mode = WAL')
    this._initSchema()
  }

  private _initSchema(): void {
    this._db.exec(`
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT
      );

      CREATE TABLE IF NOT EXISTS articles (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        link TEXT NOT NULL,
        pub_date TEXT NOT NULL,
        content TEXT NOT NULL,
        audio_path TEXT,
        processed_at TEXT,
        is_purged INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `)

    for (const stmt of [
      'ALTER TABLE articles ADD COLUMN tts_retry_count INTEGER DEFAULT 0',
      'ALTER TABLE articles ADD COLUMN tts_failed_at TEXT',
      'ALTER TABLE articles ADD COLUMN tts_error TEXT',
      'ALTER TABLE articles ADD COLUMN image_url TEXT',
    ]) {
      try { this._db.exec(stmt) } catch { /* column already exists */ }
    }

    this._migratePubDatesToIso()
  }

  private _migratePubDatesToIso(): void {
    const rows = this._db.prepare('SELECT id, pub_date FROM articles').all() as { id: string; pub_date: string }[]
    const update = this._db.prepare('UPDATE articles SET pub_date = ? WHERE id = ?')
    for (const row of rows) {
      // Skip already-ISO dates (starts with a 4-digit year)
      if (/^\d{4}-/.test(row.pub_date)) continue
      const iso = new Date(row.pub_date).toISOString()
      if (!isNaN(new Date(iso).getTime())) {
        update.run(iso, row.id)
      }
    }
  }

  // Metadata

  getFeedUrl(): string | undefined {
    const row = this._db.prepare('SELECT value FROM metadata WHERE key = \'feed_url\'').get() as { value: string } | undefined
    return row?.value
  }

  setFeedUrl(url: string): void {
    this._db.prepare('INSERT INTO metadata (key, value) VALUES (\'feed_url\', ?)').run(url)
  }

  getFeedImageUrl(): string | undefined {
    const row = this._db.prepare('SELECT value FROM metadata WHERE key = \'feed_image_url\'').get() as { value: string } | undefined
    return row?.value
  }

  setFeedImageUrl(url: string): void {
    this._db.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (\'feed_image_url\', ?)').run(url)
  }

  // Articles — write

  insertArticle(id: string, title: string, link: string, pubDate: string, content: string, imageUrl: string | null, audioPath: string | null = null): void {
    this._db.prepare(
      'INSERT INTO articles (id, title, link, pub_date, content, image_url, audio_path) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, title, link, pubDate, content, imageUrl, audioPath)
  }

  markArticleAudioSuccess(id: string, audioPath: string): void {
    this._db.prepare(`
      UPDATE articles
      SET audio_path      = ?,
          processed_at    = ?,
          tts_retry_count = 0,
          tts_failed_at   = NULL,
          tts_error       = NULL
      WHERE id = ?
    `).run(audioPath, new Date().toISOString(), id)
  }

  markArticleAudioFailure(id: string, error: string): void {
    this._db.prepare(`
      UPDATE articles
      SET tts_retry_count = tts_retry_count + 1,
          tts_failed_at   = ?,
          tts_error       = ?
      WHERE id = ?
    `).run(new Date().toISOString(), error, id)
  }

  markArticlePurged(id: string): void {
    this._db.prepare(
      'UPDATE articles SET audio_path = NULL, processed_at = NULL, is_purged = 1 WHERE id = ?'
    ).run(id)
  }

  // Articles — read

  getPublishedArticles(): PublishedArticle[] {
    return this._db.prepare(
      'SELECT * FROM articles WHERE audio_path IS NOT NULL OR is_purged = 1 ORDER BY pub_date DESC'
    ).all() as PublishedArticle[]
  }

  getActiveAudioArticles(): AudioArticle[] {
    return this._db.prepare(
      'SELECT id, audio_path, pub_date FROM articles WHERE audio_path IS NOT NULL AND is_purged = 0'
    ).all() as AudioArticle[]
  }

  getRetryEligibleArticles(maxRetries: number): RetryArticle[] {
    return this._db.prepare(`
      SELECT id, title, content
      FROM   articles
      WHERE  audio_path IS NULL
        AND  is_purged  = 0
        AND  tts_retry_count > 0
        AND  tts_retry_count < ?
    `).all(maxRetries) as RetryArticle[]
  }

  getArticleRetryCount(id: string): number {
    const row = this._db.prepare('SELECT tts_retry_count FROM articles WHERE id = ?').get(id) as { tts_retry_count: number }
    return row.tts_retry_count
  }

  getArticle(id: string): { audio_path: string | null; is_purged: number } | undefined {
    return this._db.prepare('SELECT audio_path, is_purged FROM articles WHERE id = ?').get(id) as
      | { audio_path: string | null; is_purged: number }
      | undefined
  }

  // Lifecycle

  reset(): void {
    this._db.exec('DELETE FROM articles')
    this._db.exec('DELETE FROM metadata')
  }

  close(): void {
    this._db.close()
  }
}

export const db = new PodcastDatabase()
