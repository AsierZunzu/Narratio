import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ejs from 'ejs';
import type { Article, Feed, TtsService } from '../db/index.js';
import type { ArticleStatusCounts } from '../db/articles.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, 'templates');
const ASSETS_DIR = join(__dirname, 'public');

const ASSET_FILES = ['styles.css', 'app.js', 'library.js', 'feeds.js', 'voices.js'];

const ASSETS_VERSION: string = (() => {
  let latest = 0;
  for (const name of ASSET_FILES) {
    try {
      const m = statSync(join(ASSETS_DIR, name)).mtimeMs;
      if (m > latest) latest = m;
    } catch {
      /* asset missing in tests — ignore */
    }
  }
  return Math.floor(latest || Date.now()).toString(36);
})();

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  converting: 'Converting',
  done: 'Ready',
  failed: 'Failed',
  purged: 'Purged',
};

function formatDate(d: Date | string | null): string {
  if (!d) return '—';
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return typeof d === 'string' ? d : '—';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ');
}

function formatElapsed(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function wordCount(content: string | null): string | number {
  if (!content || content.trim() === '') return '—';
  const text = stripHtml(content).trim();
  if (!text) return '—';
  return text.split(/\s+/).filter(Boolean).length;
}

type NavCounts = { articles: number; feeds: number; voices: number };

interface PageOptions {
  pageTitle: string;
  activeNav: 'library' | 'feeds' | 'voices';
  pageScript?: string;
  baseUrl: string;
  navCounts: NavCounts;
  body: string;
}

function readTemplate(name: string): string {
  return readFileSync(join(TEMPLATES_DIR, name), 'utf-8');
}

function renderPage(opts: PageOptions): string {
  const layout = readTemplate('partials/layout.ejs');
  return ejs.render(layout, { ...opts, assetsVersion: ASSETS_VERSION }, {
    filename: join(TEMPLATES_DIR, 'partials', 'layout.ejs'),
    views: [TEMPLATES_DIR, join(TEMPLATES_DIR, 'partials')],
  });
}

export function renderLibrary(
  articles: Article[],
  counts: ArticleStatusCounts,
  pageSize: number,
  baseUrl: string,
  feeds: Feed[],
  ttsServices: TtsService[],
): string {
  const feedMap = Object.fromEntries(feeds.map((f) => [f.id, f]));

  const body = ejs.render(readTemplate('library.ejs'), {
    articles, counts, baseUrl, feedMap, pageSize,
    STATUS_LABELS, formatDate, formatElapsed, wordCount,
  });

  return renderPage({
    pageTitle: 'Library',
    activeNav: 'library',
    pageScript: 'library.js',
    baseUrl,
    navCounts: { articles: counts.all, feeds: feeds.length, voices: ttsServices.length },
    body,
  });
}

export function renderFeeds(
  baseUrl: string,
  feeds: Feed[],
  ttsServices: TtsService[],
  articleCount: number,
): string {
  const body = ejs.render(readTemplate('feeds.ejs'), {
    baseUrl, feeds, ttsServices,
  });
  return renderPage({
    pageTitle: 'Feeds',
    activeNav: 'feeds',
    pageScript: 'feeds.js',
    baseUrl,
    navCounts: { articles: articleCount, feeds: feeds.length, voices: ttsServices.length },
    body,
  });
}

export function renderVoices(
  baseUrl: string,
  ttsServices: TtsService[],
  feedCount: number,
  articleCount: number,
): string {
  const body = ejs.render(readTemplate('voices.ejs'), {
    baseUrl, ttsServices,
  });
  return renderPage({
    pageTitle: 'Voices',
    activeNav: 'voices',
    pageScript: 'voices.js',
    baseUrl,
    navCounts: { articles: articleCount, feeds: feedCount, voices: ttsServices.length },
    body,
  });
}

/**
 * @deprecated Backwards-compat: now renders the Library page only.
 */
export function renderDashboard(
  articles: Article[],
  baseUrl: string,
  feeds: Feed[] = [],
  ttsServices: TtsService[] = [],
): string {
  const counts: ArticleStatusCounts = {
    all: articles.length,
    pending: articles.filter((a) => a.status === 'pending').length,
    converting: articles.filter((a) => a.status === 'converting').length,
    done: articles.filter((a) => a.status === 'done').length,
    failed: articles.filter((a) => a.status === 'failed').length,
    purged: articles.filter((a) => a.status === 'purged').length,
  };
  return renderLibrary(articles, counts, articles.length, baseUrl, feeds, ttsServices);
}
