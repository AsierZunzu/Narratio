import { eq, lt, inArray, and, asc, desc, sql, count, isNotNull, like, or, type SQL } from 'drizzle-orm';
import type { Db, ArticleStatus } from './index.js';
import { articles } from './schema.js';

export type { Article, ArticleStatus } from './index.js';

export interface InsertArticleParams {
  guid: string;
  feed_url: string;
  feed_id?: number | null;
  title: string;
  link: string | null;
  pub_date: Date | null;
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

export function countArticlesByFeed(db: Db, feedId: number): number {
  const result = db.select({ count: count() }).from(articles).where(eq(articles.feed_id, feedId)).get();
  return result?.count ?? 0;
}

export function getAudioFilesByFeed(db: Db, feedId: number): string[] {
  const rows = db.select({ audio_file: articles.audio_file }).from(articles)
    .where(and(eq(articles.feed_id, feedId), isNotNull(articles.audio_file)))
    .all();
  return rows.map((r) => r.audio_file).filter((f): f is string => f !== null);
}

export function deleteArticlesByFeed(db: Db, feedId: number): number {
  const result = db.delete(articles).where(eq(articles.feed_id, feedId)).run();
  return result.changes;
}

export function updateArticleStatus(db: Db, guid: string, status: ArticleStatus): void {
  db.update(articles).set({ status }).where(eq(articles.guid, guid)).run();
}

export function getAllArticles(db: Db) {
  return db.select().from(articles)
    .orderBy(desc(articles.pub_date), desc(articles.created_at))
    .all();
}

export interface ArticlesPageOptions {
  status?: ArticleStatus;
  search?: string;
  limit: number;
  offset: number;
}

function buildArticlesFilter(opts: { status?: ArticleStatus; search?: string }): SQL | undefined {
  const clauses: SQL[] = [];
  if (opts.status) clauses.push(eq(articles.status, opts.status));
  if (opts.search) {
    const term = `%${opts.search.toLowerCase()}%`;
    const titleMatch = like(sql`lower(${articles.title})`, term);
    const contentMatch = like(sql`lower(${articles.content})`, term);
    const matcher = or(titleMatch, contentMatch);
    if (matcher) clauses.push(matcher);
  }
  if (clauses.length === 0) return undefined;
  if (clauses.length === 1) return clauses[0];
  return and(...clauses);
}

export function getArticlesPage(db: Db, opts: ArticlesPageOptions) {
  const where = buildArticlesFilter(opts);
  const base = db.select().from(articles);
  const filtered = where ? base.where(where) : base;
  return filtered
    .orderBy(desc(articles.pub_date), desc(articles.created_at))
    .limit(opts.limit)
    .offset(opts.offset)
    .all();
}

export type ArticleStatusCounts = Record<'all' | ArticleStatus, number>;

export function getArticleStatusCounts(db: Db, search?: string): ArticleStatusCounts {
  const where = buildArticlesFilter({ search });
  const base = db.select({ status: articles.status, c: count() }).from(articles);
  const filtered = where ? base.where(where) : base;
  const rows = filtered.groupBy(articles.status).all();
  const result: ArticleStatusCounts = {
    all: 0, pending: 0, converting: 0, done: 0, failed: 0, purged: 0,
  };
  for (const r of rows) {
    if (r.status in result) result[r.status as ArticleStatus] = r.c;
    result.all += r.c;
  }
  return result;
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

export function requeueArticleForTts(db: Db, guid: string): { audio_file: string | null } | null {
  const row = db.select({ audio_file: articles.audio_file, status: articles.status })
    .from(articles).where(eq(articles.guid, guid)).get();
  if (!row) return null;
  if (!['done', 'purged', 'failed'].includes(row.status)) return null;
  db.update(articles)
    .set({ status: 'pending', audio_file: null, error: null, tts_retries: 0, tts_elapsed_ms: null })
    .where(eq(articles.guid, guid))
    .run();
  return { audio_file: row.audio_file };
}
