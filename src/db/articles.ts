import type { Database } from 'better-sqlite3';
import type { Article, ArticleStatus } from './index.js';

export interface InsertArticleParams {
  guid: string;
  feed_url: string;
  title: string;
  link: string | null;
  pub_date: string | null;
  content: string | null;
  image_url: string | null;
}

export function insertArticle(db: Database, params: InsertArticleParams): boolean {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO articles (guid, feed_url, title, link, pub_date, content, image_url)
    VALUES (@guid, @feed_url, @title, @link, @pub_date, @content, @image_url)
  `);
  const result = stmt.run(params);
  return result.changes > 0;
}

export function getArticleByGuid(db: Database, guid: string): Article | undefined {
  return db.prepare('SELECT * FROM articles WHERE guid = ?').get(guid) as Article | undefined;
}

export function markArticleDone(db: Database, guid: string, audioFile: string): void {
  db.prepare(`
    UPDATE articles SET status = 'done', audio_file = ?, error = NULL WHERE guid = ?
  `).run(audioFile, guid);
}

export function markArticleFailed(db: Database, guid: string, error: string): void {
  db.prepare(`
    UPDATE articles
    SET status = 'failed', tts_retries = tts_retries + 1, error = ?
    WHERE guid = ?
  `).run(error, guid);
}

export function markArticlePermanentlyFailed(db: Database, guid: string): void {
  db.prepare(`
    UPDATE articles SET status = 'failed' WHERE guid = ?
  `).run(guid);
}

export function markArticlePurged(db: Database, guid: string): void {
  db.prepare(`
    UPDATE articles SET status = 'purged', audio_file = NULL WHERE guid = ?
  `).run(guid);
}

export function resetFailedRetries(db: Database): number {
  const result = db.prepare(`
    UPDATE articles SET tts_retries = 0, status = 'pending' WHERE status = 'failed'
  `).run();
  return result.changes;
}

export function getPendingArticles(db: Database): Article[] {
  return db.prepare(`
    SELECT * FROM articles WHERE status = 'pending' ORDER BY created_at ASC
  `).all() as Article[];
}

export function getRetryableArticles(db: Database, maxRetries: number): Article[] {
  return db.prepare(`
    SELECT * FROM articles
    WHERE status = 'failed' AND tts_retries < ?
    ORDER BY created_at ASC
  `).all(maxRetries) as Article[];
}

export function getPublishedArticles(db: Database): Article[] {
  return db.prepare(`
    SELECT * FROM articles
    WHERE status IN ('done', 'purged', 'failed')
    ORDER BY pub_date DESC, created_at DESC
  `).all() as Article[];
}

export function getDoneArticlesOrderedByDate(db: Database): Article[] {
  return db.prepare(`
    SELECT * FROM articles
    WHERE status = 'done'
    ORDER BY pub_date ASC, created_at ASC
  `).all() as Article[];
}

export function countDoneArticles(db: Database): number {
  const row = db.prepare(`SELECT COUNT(*) as count FROM articles WHERE status = 'done'`).get() as { count: number };
  return row.count;
}

export function updateArticleStatus(db: Database, guid: string, status: ArticleStatus): void {
  db.prepare('UPDATE articles SET status = ? WHERE guid = ?').run(status, guid);
}
