import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import type { InferSelectModel } from 'drizzle-orm';

export const articles = sqliteTable('articles', {
  guid:          text('guid').primaryKey(),
  feed_url:      text('feed_url').notNull(),
  title:         text('title').notNull(),
  link:          text('link'),
  pub_date:      text('pub_date'),
  content:       text('content'),
  image_url:     text('image_url'),
  audio_file:    text('audio_file'),
  status:        text('status', { enum: ['pending', 'converting', 'done', 'failed', 'purged'] }).notNull().default('pending'),
  tts_retries:   integer('tts_retries').notNull().default(0),
  tts_elapsed_ms: integer('tts_elapsed_ms'),
  error:         text('error'),
  created_at:    text('created_at').notNull().default(sql`(datetime('now'))`),
});

export type Article = InferSelectModel<typeof articles>;
export type ArticleStatus = 'pending' | 'converting' | 'done' | 'failed' | 'purged';
