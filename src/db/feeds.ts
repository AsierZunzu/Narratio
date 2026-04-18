import { eq, count } from 'drizzle-orm';
import type { Db } from './index.js';
import { feeds } from './schema.js';

export type { Feed } from './schema.js';

export interface InsertFeedParams {
  name: string;
  rss_url: string;
  slug: string;
  title: string;
  description?: string;
  author?: string;
  language?: string;
  itunes_author?: string | null;
  itunes_summary?: string | null;
  itunes_owner_name?: string | null;
  itunes_owner_email?: string | null;
  itunes_category?: string;
  unavailable_message?: string | null;
  tts_failed_message?: string | null;
  max_audio_files?: number | null;
  max_audio_size_mb?: number | null;
  tts_service_id: number;
}

export type UpdateFeedParams = Partial<InsertFeedParams>;

export function getFeeds(db: Db) {
  return db.select().from(feeds).all();
}

export function getFeedById(db: Db, id: number) {
  return db.select().from(feeds).where(eq(feeds.id, id)).get();
}

export function getFeedBySlug(db: Db, slug: string) {
  return db.select().from(feeds).where(eq(feeds.slug, slug)).get();
}

export function insertFeed(db: Db, params: InsertFeedParams) {
  const result = db.insert(feeds).values(params).returning().get();
  if (!result) throw new Error('Failed to insert feed');
  return result;
}

export function updateFeed(db: Db, id: number, params: UpdateFeedParams) {
  return db.update(feeds).set(params).where(eq(feeds.id, id)).returning().get();
}

export function deleteFeed(db: Db, id: number): boolean {
  const result = db.delete(feeds).where(eq(feeds.id, id)).run();
  return result.changes > 0;
}

export function countFeedsByTtsService(db: Db, ttsServiceId: number): number {
  const result = db.select({ count: count() }).from(feeds).where(eq(feeds.tts_service_id, ttsServiceId)).get();
  return result?.count ?? 0;
}
