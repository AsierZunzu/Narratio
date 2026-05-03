import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import type { InferSelectModel } from 'drizzle-orm';

export const ttsServices = sqliteTable('tts_services', {
  id:         integer('id').primaryKey({ autoIncrement: true }),
  name:       text('name').notNull(),
  host:       text('host').notNull(),
  port:       integer('port').notNull(),
  created_at: text('created_at').notNull().default(sql`(datetime('now'))`),
});

export const feeds = sqliteTable('feeds', {
  id:                  integer('id').primaryKey({ autoIncrement: true }),
  name:                text('name').notNull(),
  rss_url:             text('rss_url').notNull(),
  slug:                text('slug').notNull().unique(),
  title:               text('title').notNull(),
  description:         text('description').notNull().default(''),
  author:              text('author').notNull().default('Narratio'),
  language:            text('language').notNull().default('en'),
  itunes_author:       text('itunes_author'),
  itunes_summary:      text('itunes_summary'),
  itunes_owner_name:   text('itunes_owner_name'),
  itunes_owner_email:  text('itunes_owner_email'),
  itunes_category:     text('itunes_category').notNull().default('Technology'),
  unavailable_message: text('unavailable_message'),
  tts_failed_message:  text('tts_failed_message'),
  max_audio_files:     integer('max_audio_files'),
  max_audio_size_mb:   integer('max_audio_size_mb'),
  tts_service_id:      integer('tts_service_id').notNull(),
  created_at:          text('created_at').notNull().default(sql`(datetime('now'))`),
});

export const articles = sqliteTable('articles', {
  guid:           text('guid').primaryKey(),
  feed_url:       text('feed_url').notNull(),
  feed_id:        integer('feed_id'),
  title:          text('title').notNull(),
  link:           text('link'),
  pub_date:       integer('pub_date', { mode: 'timestamp_ms' }),
  content:        text('content'),
  image_url:      text('image_url'),
  audio_file:     text('audio_file'),
  status:         text('status', { enum: ['pending', 'converting', 'done', 'failed', 'purged'] }).notNull().default('pending'),
  tts_retries:    integer('tts_retries').notNull().default(0),
  tts_elapsed_ms: integer('tts_elapsed_ms'),
  error:          text('error'),
  created_at:     text('created_at').notNull().default(sql`(datetime('now'))`),
});

export const workerState = sqliteTable('worker_state', {
  id:                   integer('id').primaryKey(),
  status:               text('status', { enum: ['idle', 'running'] }).notNull().default('idle'),
  updated_at:           text('updated_at').notNull().default(sql`(datetime('now'))`),
  trigger_requested_at: text('trigger_requested_at'),
});

export type TtsService = InferSelectModel<typeof ttsServices>;
export type Feed = InferSelectModel<typeof feeds>;
export type Article = InferSelectModel<typeof articles>;
export type ArticleStatus = 'pending' | 'converting' | 'done' | 'failed' | 'purged';
export type WorkerState = InferSelectModel<typeof workerState>;
export type WorkerStatus = 'idle' | 'running';
