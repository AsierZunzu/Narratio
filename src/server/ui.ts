import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ejs from 'ejs';
import type { Article } from '../db/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = readFileSync(join(__dirname, 'templates', 'dashboard.ejs'), 'utf-8');

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  converting: 'Converting',
  done: 'Done',
  failed: 'Failed',
  purged: 'Purged',
};

function formatDate(d: string | null): string {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return d;
  }
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ');
}

function formatElapsed(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function wordCount(content: string | null): string {
  if (!content || content.trim() === '') return '—';
  const text = stripHtml(content).trim();
  if (!text) return '—';
  const count = text.split(/\s+/).filter(Boolean).length;
  return count + ' w';
}

export function renderDashboard(articles: Article[], baseUrl: string): string {
  const counts: Record<string, number> = {
    all: articles.length,
    pending: articles.filter((a) => a.status === 'pending').length,
    converting: articles.filter((a) => a.status === 'converting').length,
    done: articles.filter((a) => a.status === 'done').length,
    failed: articles.filter((a) => a.status === 'failed').length,
    purged: articles.filter((a) => a.status === 'purged').length,
  };

  return ejs.render(TEMPLATE, {
    articles,
    counts,
    baseUrl,
    STATUS_LABELS,
    formatDate,
    formatElapsed,
    wordCount,
  });
}
