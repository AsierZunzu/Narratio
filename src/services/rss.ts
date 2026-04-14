import Parser from 'rss-parser';
import type { Database } from 'better-sqlite3';
import path from 'path';
import { htmlToText } from '../utils/html.js';
import { logger } from '../utils/logger.js';
import {
  insertArticle,
  getPendingArticles,
  getRetryableArticles,
  markArticleDone,
  markArticleFailed,
  markArticlePermanentlyFailed,
} from '../db/articles.js';
import { synthesise, type TtsOptions } from './tts.js';

interface CustomFeed {
  image?: { url?: string };
}

interface CustomItem {
  guid?: string;
  'media:content'?: { $?: { url?: string } };
  'media:thumbnail'?: { $?: { url?: string } };
  enclosures?: Array<{ url?: string; type?: string }>;
  'itunes:image'?: { $?: { href?: string } };
  content?: string;
  contentSnippet?: string;
}

type FeedItem = Parser.Item & CustomItem;

const parser = new Parser<CustomFeed, CustomItem>({
  customFields: {
    item: [
      'media:content',
      'media:thumbnail',
      'itunes:image',
    ],
  },
});

function extractImageUrl(item: FeedItem): string | null {
  // Priority: iTunes image → media:content → media:thumbnail → enclosure → inline <img>
  const itunesHref = item['itunes:image']?.['$']?.href;
  if (itunesHref) return itunesHref;

  const mediaContent = item['media:content']?.['$']?.url;
  if (mediaContent) return mediaContent;

  const mediaThumbnail = item['media:thumbnail']?.['$']?.url;
  if (mediaThumbnail) return mediaThumbnail;

  const enclosure = item.enclosures?.find((e) =>
    e.url && e.type?.startsWith('image/'),
  );
  if (enclosure?.url) return enclosure.url;

  // Inline <img> in content
  const html = item.content ?? item['content:encoded'] ?? '';
  const imgMatch = /<img[^>]+src=["']([^"']+)["']/i.exec(html);
  if (imgMatch?.[1]) return imgMatch[1];

  return null;
}

function deriveGuid(item: FeedItem): string {
  return item.guid ?? item.link ?? item.title ?? String(Date.now());
}

export interface RssServiceOptions {
  feedUrl: string;
  fetchTimeoutMs: number;
  maxRetries: number;
  tts: TtsOptions;
  audioDir: string;
}

export async function processFeed(db: Database, opts: RssServiceOptions): Promise<void> {
  logger.info(`Fetching RSS feed: ${opts.feedUrl}`);

  let feed: Awaited<ReturnType<typeof parser.parseURL>>;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.fetchTimeoutMs);
    try {
      feed = await parser.parseURL(opts.feedUrl);
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    throw new Error(`Failed to fetch RSS feed: ${err instanceof Error ? err.message : String(err)}`);
  }

  logger.info(`Feed fetched: ${feed.items.length} items found`);

  for (const raw of feed.items) {
    const item = raw as FeedItem;
    const guid = deriveGuid(item);
    const rawHtml = item.content ?? (item as Record<string, unknown>)['content:encoded'] as string ?? item.contentSnippet ?? '';
    const content = htmlToText(rawHtml);
    const imageUrl = extractImageUrl(item);

    const inserted = insertArticle(db, {
      guid,
      feed_url: opts.feedUrl,
      title: item.title ?? 'Untitled',
      link: item.link ?? null,
      pub_date: item.pubDate ?? item.isoDate ?? null,
      content: content || null,
      image_url: imageUrl,
    });

    if (inserted) {
      logger.info(`New article: ${item.title}`);
    }
  }

  // Snapshot retryable articles BEFORE processing pending ones, so articles
  // that fail in this run are not immediately retried in the same pass.
  const retryable = opts.maxRetries > 0 ? getRetryableArticles(db, opts.maxRetries) : [];

  // Process all pending articles (newly inserted + any that were pending before)
  const pending = getPendingArticles(db);
  logger.info(`Processing ${pending.length} pending articles`);
  for (const article of pending) {
    await dispatchTts(db, article.guid, article.title, article.content, opts);
  }

  // Retry previously failed articles that hadn't hit the limit
  if (retryable.length > 0) {
    logger.info(`Retrying ${retryable.length} failed articles`);
    for (const article of retryable) {
      await dispatchTts(db, article.guid, article.title, article.content, opts);
    }
  }
}

async function dispatchTts(
  db: Database,
  guid: string,
  title: string,
  content: string | null,
  opts: RssServiceOptions,
): Promise<void> {
  const text = [title, content].filter(Boolean).join('. ');
  const filename = `${sanitiseFilename(guid)}.wav`;

  try {
    await synthesise(text, filename, opts.tts);
    markArticleDone(db, guid, filename);
    logger.info(`TTS done: ${title}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`TTS failed for "${title}"`, err);

    // Check if permanently failed after this increment
    const article = db
      .prepare('SELECT tts_retries FROM articles WHERE guid = ?')
      .get(guid) as { tts_retries: number } | undefined;

    const retriesAfter = (article?.tts_retries ?? 0) + 1;

    if (opts.maxRetries > 0 && retriesAfter >= opts.maxRetries) {
      markArticlePermanentlyFailed(db, guid);
      logger.warn(`Article permanently failed (${retriesAfter} retries): ${title}`);
    } else {
      markArticleFailed(db, guid, msg);
    }
  }
}

function sanitiseFilename(input: string): string {
  return input.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 200);
}
