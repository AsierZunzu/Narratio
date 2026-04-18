import { fileURLToPath } from 'url';
import express from 'express';
import path from 'path';
import fs from 'fs';
import { getDb, closeDb } from '../db/index.js';
import { buildFeedXml } from './feed.js';
import { renderDashboard } from './ui.js';
import { getAllArticles, deleteArticle, resetArticleRetries, markArticlePurged, getArticleByGuid } from '../db/articles.js';
import { getFeeds, getFeedBySlug } from '../db/feeds.js';
import { getTtsServices, getTtsServiceById } from '../db/tts-services.js';
import { synthesise } from '../services/tts.js';
import { env } from '../utils/env.js';
import { logger } from '../utils/logger.js';

const DATA_DIR = path.join(process.cwd(), 'data');
const AUDIO_DIR = path.join(DATA_DIR, 'audio');
const DB_PATH = path.join(DATA_DIR, 'narratio.db');

async function ensureFallbackAudio(db: ReturnType<typeof getDb>): Promise<void> {
  fs.mkdirSync(AUDIO_DIR, { recursive: true });

  const ttsServicesList = getTtsServices(db);
  if (ttsServicesList.length === 0) {
    logger.warn('No TTS services configured — skipping fallback audio generation');
    return;
  }
  const ttsService = ttsServicesList[0]!;

  const ttsOpts = {
    host: ttsService.host,
    port: ttsService.port,
    timeoutMs: env.TTS_TIMEOUT(),
    outputDir: AUDIO_DIR,
  };

  const fallbacks = [
    { filename: 'unavailable.wav', text: env.UNAVAILABLE_MESSAGE() },
    { filename: 'tts-failed.wav', text: env.TTS_FAILED_MESSAGE() },
  ];

  for (const { filename, text } of fallbacks) {
    const filePath = path.join(AUDIO_DIR, filename);
    if (!fs.existsSync(filePath)) {
      try {
        await synthesise(text, filename, ttsOpts);
        logger.info(`Generated fallback audio: ${filename}`);
      } catch (err) {
        logger.warn(`Could not generate fallback audio ${filename}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
}

export function createApp(dbPath = DB_PATH): express.Application {
  const app = express();
  const db = getDb(dbPath);

  app.use(express.json());

  app.get('/audio/:file', (req, res) => {
    const filename = req.params['file'];
    if (!filename || filename.includes('..') || filename.includes('/')) {
      res.status(400).send('Bad request');
      return;
    }
    const filePath = path.join(AUDIO_DIR, filename);
    if (!fs.existsSync(filePath)) {
      res.status(404).send('Not found');
      return;
    }
    res.setHeader('Content-Type', 'audio/wav');
    res.sendFile(filePath);
  });

  app.get('/rss/:slug', (req, res) => {
    const baseUrl = process.env['BASE_URL'] ?? `${req.protocol}://${req.get('host')}`;
    try {
      const feed = getFeedBySlug(db, req.params['slug']!);
      if (!feed) {
        res.status(404).send('Feed not found');
        return;
      }
      const ttsService = getTtsServiceById(db, feed.tts_service_id);
      if (!ttsService) {
        res.status(500).send('TTS service not configured');
        return;
      }
      const xml = buildFeedXml(db, feed, baseUrl);
      res.setHeader('Content-Type', 'application/rss+xml; charset=utf-8');
      res.send(xml);
    } catch (err) {
      logger.error('Failed to build RSS feed', err);
      res.status(500).send('Internal server error');
    }
  });

  // ── Dashboard UI ────────────────────────────────────────────────────────────

  app.get('/', (req, res) => {
    const baseUrl = process.env['BASE_URL'] ?? `${req.protocol}://${req.get('host')}`;
    try {
      const articles = getAllArticles(db);
      const feeds = getFeeds(db);
      const html = renderDashboard(articles, baseUrl, feeds);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    } catch (err) {
      logger.error('Failed to render dashboard', err);
      res.status(500).send('Internal server error');
    }
  });

  // ── REST API ────────────────────────────────────────────────────────────────

  app.get('/api/articles', (_req, res) => {
    res.json(getAllArticles(db));
  });

  app.delete('/api/articles/:guid', (req, res) => {
    const { guid } = req.params;
    const article = getArticleByGuid(db, guid);

    if (!article) {
      res.status(404).send('Article not found');
      return;
    }

    if (article.audio_file) {
      const filePath = path.join(AUDIO_DIR, article.audio_file);
      try { fs.unlinkSync(filePath); } catch { /* already gone */ }
    }

    deleteArticle(db, guid);
    res.status(204).end();
  });

  app.post('/api/articles/:guid/retry', (req, res) => {
    const { guid } = req.params;
    const updated = resetArticleRetries(db, guid);
    if (!updated) {
      res.status(404).send('Article not found or not in failed state');
      return;
    }
    res.status(204).end();
  });

  app.post('/api/articles/:guid/purge', (req, res) => {
    const { guid } = req.params;
    const article = getArticleByGuid(db, guid);

    if (!article || article.status !== 'done') {
      res.status(404).send('Article not found or not in done state');
      return;
    }

    if (article.audio_file) {
      const filePath = path.join(AUDIO_DIR, article.audio_file);
      try { fs.unlinkSync(filePath); } catch { /* already gone */ }
    }

    markArticlePurged(db, guid);
    res.status(204).end();
  });

  return app;
}

async function main(): Promise<void> {
  const app = createApp();
  const db = getDb(DB_PATH);
  const port = env.PORT();

  const baseUrl = process.env['BASE_URL'] ?? `http://localhost:${port}`;

  const server = app.listen(port, () => {
    logger.info('Narratio server is ready');
    logger.info(`  Dashboard : ${baseUrl}/`);
    logger.info(`  API       : ${baseUrl}/api/articles`);
    const feeds = getFeeds(db);
    if (feeds.length === 0) {
      logger.info('  RSS feeds : (none configured)');
    } else {
      for (const feed of feeds) {
        logger.info(`  RSS feed  : ${baseUrl}/rss/${feed.slug} (${feed.name})`);
      }
    }
    ensureFallbackAudio(db).catch((err) =>
      logger.warn(`Fallback audio generation failed: ${err instanceof Error ? err.message : String(err)}`),
    );
  });

  const shutdown = () => {
    logger.info('Server shutting down…');
    server.close(() => {
      closeDb();
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    logger.error('Fatal server error', err);
    process.exit(1);
  });
}
