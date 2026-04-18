import { eq, lt, inArray, and, asc, desc, sql, count } from 'drizzle-orm';
import type { Db, ArticleStatus } from './index.js';
import { articles } from './schema.js';

export type { Article, ArticleStatus } from './index.js';

export interface InsertArticleParams {
  guid: string;
  feed_url: string;
  feed_id?: number | null;
  title: string;
  link: string | null;
  pub_date: string | null;
  content: string | null;
  image_url: string | null;
}

export function insertArticle(db: Db, params: InsertArticleParams): boolean {
  const result = db.insert(articles).values(params).onConflictDoNothing().run();
  return result.changes > 0;
}

export function getArticleByGuid(db: Db, guid: string) {
  return db.select().from(articles).where(eq(articles.guid, guid)).get();
}

export function markArticleConverting(db: Db, guid: string): void {
  db.update(articles).set({ status: 'converting' }).where(eq(articles.guid, guid)).run();
}

export function resetConvertingArticles(db: Db): number {
  const result = db.update(articles).set({ status: 'pending' }).where(eq(articles.status, 'converting')).run();
  return result.changes;
}

export function markArticleDone(db: Db, guid: string, audioFile: string, elapsedMs: number): void {
  db.update(articles)
    .set({ status: 'done', audio_file: audioFile, tts_elapsed_ms: elapsedMs, error: null })
    .where(eq(articles.guid, guid))
    .run();
}

export function markArticleFailed(db: Db, guid: string, error: string): void {
  db.update(articles)
    .set({ status: 'failed', tts_retries: sql`${articles.tts_retries} + 1`, error })
    .where(eq(articles.guid, guid))
    .run();
}

export function markArticlePermanentlyFailed(db: Db, guid: string, error: string): void {
  db.update(articles)
    .set({ status: 'failed', tts_retries: sql`${articles.tts_retries} + 1`, error })
    .where(eq(articles.guid, guid))
    .run();
}

export function markArticlePurged(db: Db, guid: string): void {
  db.update(articles)
    .set({ status: 'purged', audio_file: null })
    .where(eq(articles.guid, guid))
    .run();
}

export function resetFailedRetries(db: Db): number {
  const result = db.update(articles)
    .set({ tts_retries: 0, status: 'pending' })
    .where(eq(articles.status, 'failed'))
    .run();
  return result.changes;
}

export function getPendingArticles(db: Db) {
  return db.select().from(articles).where(eq(articles.status, 'pending')).orderBy(asc(articles.created_at)).all();
}

export function getPendingArticlesByFeed(db: Db, feedId: number) {
  return db.select().from(articles)
    .where(and(eq(articles.status, 'pending'), eq(articles.feed_id, feedId)))
    .orderBy(asc(articles.created_at))
    .all();
}

export function getRetryableArticles(db: Db, maxRetries: number) {
  return db.select().from(articles)
    .where(and(eq(articles.status, 'failed'), lt(articles.tts_retries, maxRetries)))
    .orderBy(asc(articles.created_at))
    .all();
}

export function getRetryableArticlesByFeed(db: Db, feedId: number, maxRetries: number) {
  return db.select().from(articles)
    .where(and(eq(articles.status, 'failed'), lt(articles.tts_retries, maxRetries), eq(articles.feed_id, feedId)))
    .orderBy(asc(articles.created_at))
    .all();
}

export function getPublishedArticles(db: Db) {
  return db.select().from(articles)
    .where(inArray(articles.status, ['done', 'purged', 'failed']))
    .orderBy(desc(articles.pub_date), desc(articles.created_at))
    .all();
}

export function getPublishedArticlesByFeed(db: Db, feedId: number) {
  return db.select().from(articles)
    .where(and(inArray(articles.status, ['done', 'purged', 'failed']), eq(articles.feed_id, feedId)))
    .orderBy(desc(articles.pub_date), desc(articles.created_at))
    .all();
}

export function getDoneArticlesOrderedByDate(db: Db) {
  return db.select().from(articles)
    .where(eq(articles.status, 'done'))
    .orderBy(asc(articles.pub_date), asc(articles.created_at))
    .all();
}

export function getDoneArticlesOrderedByDateByFeed(db: Db, feedId: number) {
  return db.select().from(articles)
    .where(and(eq(articles.status, 'done'), eq(articles.feed_id, feedId)))
    .orderBy(asc(articles.pub_date), asc(articles.created_at))
    .all();
}

export function countDoneArticles(db: Db): number {
  const result = db.select({ count: count() }).from(articles).where(eq(articles.status, 'done')).get();
  return result?.count ?? 0;
}

export function countArticlesByFeed(db: Db, feedId: number): number {
  const result = db.select({ count: count() }).from(articles).where(eq(articles.feed_id, feedId)).get();
  return result?.count ?? 0;
}

export function updateArticleStatus(db: Db, guid: string, status: ArticleStatus): void {
  db.update(articles).set({ status }).where(eq(articles.guid, guid)).run();
}

export function getAllArticles(db: Db) {
  return db.select().from(articles)
    .orderBy(desc(articles.pub_date), desc(articles.created_at))
    .all();
}

export function deleteArticle(db: Db, guid: string): boolean {
  const result = db.delete(articles).where(eq(articles.guid, guid)).run();
  return result.changes > 0;
}

export function resetAllArticlesForRegen(db: Db): number {
  const result = db.update(articles)
    .set({ tts_retries: 0, status: 'pending', audio_file: null, error: null, tts_elapsed_ms: null })
    .where(inArray(articles.status, ['done', 'failed', 'purged', 'converting']))
    .run();
  return result.changes;
}

export function resetArticleRetries(db: Db, guid: string): boolean {
  const result = db.update(articles)
    .set({ tts_retries: 0, status: 'pending', error: null })
    .where(and(eq(articles.guid, guid), eq(articles.status, 'failed')))
    .run();
  return result.changes > 0;
}
