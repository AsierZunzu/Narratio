import Parser from 'rss-parser';
import type { Db } from '../db/index.js';
import { extract } from '@extractus/article-extractor';
import { htmlToText } from '../utils/html.js';
import { logger } from '../utils/logger.js';
import {
  insertArticle,
  getPendingArticlesByFeed,
  getRetryableArticlesByFeed,
  getArticleByGuid,
  markArticleConverting,
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
  'content:encoded'?: string;
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

const DAY_TRANSLATIONS: Record<string, string> = {
  // Spanish
  lun: 'Mon', mar: 'Tue', mie: 'Wed', jue: 'Thu', vie: 'Fri', sab: 'Sat', dom: 'Sun',
  lunes: 'Mon', martes: 'Tue', miercoles: 'Wed', jueves: 'Thu', viernes: 'Fri', sabado: 'Sat', domingo: 'Sun',
  // French
  mer: 'Wed', jeu: 'Thu', ven: 'Fri', sam: 'Sat', dim: 'Sun',
  // German
  mo: 'Mon', di: 'Tue', mi: 'Wed', do: 'Thu', fr: 'Fri', sa: 'Sat', so: 'Sun',
  mon: 'Mon', die: 'Tue', mit: 'Wed', don: 'Thu', fre: 'Fri', son: 'Sun',
  // Italian
  gio: 'Thu',
  // Portuguese
  seg: 'Mon', ter: 'Tue', qua: 'Wed', qui: 'Thu', sex: 'Fri',
};

const MONTH_TRANSLATIONS: Record<string, string> = {
  // Spanish
  ene: 'Jan', feb: 'Feb', mar: 'Mar', abr: 'Apr', may: 'May', jun: 'Jun', jul: 'Jul',
  ago: 'Aug', sep: 'Sep', sept: 'Sep', oct: 'Oct', nov: 'Nov', dic: 'Dec',
  // French
  janv: 'Jan', jan: 'Jan', fevr: 'Feb', fev: 'Feb', mars: 'Mar', avr: 'Apr',
  juin: 'Jun', juil: 'Jul', aout: 'Aug', dec: 'Dec',
  // German
  mrz: 'Mar', mai: 'May', okt: 'Oct', dez: 'Dec',
  // Italian
  gen: 'Jan', mag: 'May', giu: 'Jun', lug: 'Jul', set: 'Sep', ott: 'Oct',
  // Portuguese
  out: 'Oct',
};

function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Re-emit the input as an English RFC 2822-shaped string by replacing the
 * weekday and month tokens via DAY_TRANSLATIONS / MONTH_TRANSLATIONS.
 * Position resolves ambiguity (e.g. Spanish "mar" can be Tuesday or March).
 */
function translateLocalisedDate(input: string): string | null {
  const ascii = stripDiacritics(input);
  const m = ascii.match(/^\s*(?:([A-Za-z]+),\s*)?(\d{1,2})\s+([A-Za-z]+)\s+(\d{2,4})(.*)$/);
  if (!m) return null;
  const [, dow, day, month, year, rest] = m;
  const monthEn = MONTH_TRANSLATIONS[month.toLowerCase()];
  if (!monthEn) return null;
  const dowEn = dow ? (DAY_TRANSLATIONS[dow.toLowerCase()] ?? dow) : null;
  return `${dowEn ? `${dowEn}, ` : ''}${day} ${monthEn} ${year}${rest}`;
}

export function normalisePubDate(input: string | undefined | null): Date | null {
  if (!input) return null;
  let t = Date.parse(input);
  if (Number.isNaN(t)) {
    const translated = translateLocalisedDate(input);
    if (translated) t = Date.parse(translated);
  }
  return Number.isNaN(t) ? null : new Date(t);
}

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
  const html = item['content:encoded'] ?? item.content ?? '';
  const imgMatch = /<img[^>]+src=["']([^"']+)["']/i.exec(html);
  if (imgMatch?.[1]) return imgMatch[1];

  return null;
}

function deriveGuid(item: FeedItem): string {
  return item.guid ?? item.link ?? item.title ?? String(Date.now());
}

async function fetchFullContent(url: string, timeoutMs: number): Promise<string | null> {
  try {
    const article = await Promise.race([
      extract(url),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
    if (!article?.content) return null;
    return htmlToText(article.content) || null;
  } catch (err) {
    logger.warn(`Failed to fetch full content from ${url}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

export interface TtsBatchOptions {
  feedId: number;
  maxRetries: number;
  tts: TtsOptions;
  audioDir: string;
}

export interface RssServiceOptions extends TtsBatchOptions {
  feedUrl: string;
  fetchTimeoutMs: number;
}

export async function processPendingArticles(db: Db, opts: TtsBatchOptions): Promise<void> {
  // Snapshot retryable articles BEFORE processing pending ones, so articles
  // that fail in this run are not immediately retried in the same pass.
  const retryable = opts.maxRetries > 0 ? getRetryableArticlesByFeed(db, opts.feedId, opts.maxRetries) : [];

  const pending = getPendingArticlesByFeed(db, opts.feedId);
  if (pending.length === 0 && retryable.length === 0) return;

  logger.info(`Processing ${pending.length} pending articles`);
  for (const article of pending) {
    await dispatchTts(db, article.guid, article.title, article.content, opts);
  }

  if (retryable.length > 0) {
    logger.info(`Retrying ${retryable.length} failed articles`);
    for (const article of retryable) {
      await dispatchTts(db, article.guid, article.title, article.content, opts);
    }
  }
}

/**
 * Fetch an RSS feed and decode it using the charset declared by the server
 * (Content-Type header) or by the XML prolog. Falls back to UTF-8.
 *
 * Why: `rss-parser`'s `parseURL` decodes responses as UTF-8, which produces
 * mojibake for feeds served as ISO-8859-1/15 or windows-1252 (e.g. AEMET).
 */
async function fetchFeedXml(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, { signal: controller.signal, redirect: 'follow' });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  const headerCharset = /charset=([^;\s]+)/i.exec(res.headers.get('content-type') ?? '')?.[1];
  const charset = headerCharset ?? sniffXmlEncoding(buf) ?? 'utf-8';
  try {
    return new TextDecoder(charset, { fatal: false }).decode(buf);
  } catch {
    return new TextDecoder('utf-8').decode(buf);
  }
}

function sniffXmlEncoding(buf: Uint8Array): string | null {
  // Read the XML prolog as ASCII (encoding name itself is always ASCII).
  const head = new TextDecoder('utf-8', { fatal: false }).decode(buf.subarray(0, 256));
  return /<\?xml[^?]*encoding=["']([^"']+)["']/i.exec(head)?.[1] ?? null;
}

export async function processFeed(db: Db, opts: RssServiceOptions): Promise<void> {
  logger.info(`Fetching RSS feed: ${opts.feedUrl}`);

  let feed: Awaited<ReturnType<typeof parser.parseString>>;
  try {
    const xml = await fetchFeedXml(opts.feedUrl, opts.fetchTimeoutMs);
    feed = await parser.parseString(xml);
  } catch (err) {
    throw new Error(`Failed to fetch RSS feed: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }

  logger.info(`Feed fetched: ${feed.items.length} items found`);

  for (const raw of feed.items) {
    const item = raw as FeedItem;
    const guid = deriveGuid(item);
    const rawHtml = item.content ?? item['content:encoded'] ?? item.contentSnippet ?? '';
    const rssContent = htmlToText(rawHtml);

    let content = rssContent;
    if (item.link) {
      const full = await fetchFullContent(item.link, opts.fetchTimeoutMs);
      if (full && full.length > rssContent.length) {
        content = full;
      }
    }

    const imageUrl = extractImageUrl(item);

    const inserted = insertArticle(db, {
      guid,
      feed_url: opts.feedUrl,
      feed_id: opts.feedId,
      title: item.title ?? 'Untitled',
      link: item.link ?? null,
      pub_date: normalisePubDate(item.isoDate ?? item.pubDate),
      content: content || null,
      image_url: imageUrl,
    });

    if (inserted) {
      logger.info(`New article: ${item.title}`);
    }
  }

  await processPendingArticles(db, opts);
}

/** Max characters sent to Piper per article. Longer texts cause OOM crashes. */
const TTS_MAX_CHARS = 50_000;

/**
 * Strip characters that confuse Piper's text-normaliser:
 *  - C0/C1 control chars (except tab/newline/CR)
 *  - Null bytes
 *  - Unicode private-use / replacement characters
 */
function sanitiseText(raw: string): string {
  return raw
    // eslint-disable-next-line no-control-regex -- intentionally matches control chars to strip them from TTS input
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F\uFFFD\uE000-\uF8FF]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function dispatchTts(
  db: Db,
  guid: string,
  title: string,
  content: string | null,
  opts: TtsBatchOptions,
): Promise<void> {
  const rawText = [title, content].filter(Boolean).join("\n");
  let text = sanitiseText(rawText);

  if (text.length === 0) {
    logger.warn(`Skipping TTS for "${title}" — no usable text after sanitisation`);
    markArticlePermanentlyFailed(db, guid, 'No usable text content');
    return;
  }

  if (text.length > TTS_MAX_CHARS) {
    logger.warn(
      `Text for "${title}" is ${text.length} chars — truncating to ${TTS_MAX_CHARS} to avoid Piper OOM`,
    );
    text = text.slice(0, TTS_MAX_CHARS);
  }

  const filename = `${sanitiseFilename(guid)}.wav`;

  logger.info(`Converting: ${title} (${text.length} chars)`);
  markArticleConverting(db, guid);

  try {
    const ttsStart = Date.now();
    await synthesise(text, filename, opts.tts);
    const elapsedMs = Date.now() - ttsStart;
    markArticleDone(db, guid, filename, elapsedMs);
    logger.info(`TTS done: ${title} (${(elapsedMs / 1000).toFixed(1)}s)`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`TTS failed for "${title}" (text length: ${text.length} chars, file: ${filename}): ${msg}`);

    // Check if permanently failed after this increment
    const article = getArticleByGuid(db, guid);
    const retriesAfter = (article?.tts_retries ?? 0) + 1;

    if (opts.maxRetries > 0 && retriesAfter >= opts.maxRetries) {
      markArticlePermanentlyFailed(db, guid, msg);
      logger.warn(`Article permanently failed after ${retriesAfter} retries: ${title}`);
    } else {
      markArticleFailed(db, guid, msg);
      logger.warn(`Article marked failed (attempt ${retriesAfter}/${opts.maxRetries || '∞'}): ${title}`);
    }
  }
}

function sanitiseFilename(input: string): string {
  return input.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 200);
}
