import { fileURLToPath } from 'url';
import express from 'express';
import path from 'path';
import fs from 'fs';
import net from 'net';
import { getDb, closeDb } from '../db/index.js';
import { buildFeedXml } from './feed.js';
import { renderDashboard } from './ui.js';
import { getAllArticles, deleteArticle, resetArticleRetries, markArticlePurged, getArticleByGuid, countArticlesByFeed } from '../db/articles.js';
import { getFeeds, getFeedById, getFeedBySlug, insertFeed, updateFeed, deleteFeed, countFeedsByTtsService } from '../db/feeds.js';
import { getTtsServices, getTtsServiceById, insertTtsService, updateTtsService, deleteTtsService } from '../db/tts-services.js';
import { synthesise } from '../services/tts.js';
import { env } from '../utils/env.js';
import { logger } from '../utils/logger.js';

const DATA_DIR = path.join(process.cwd(), 'data');
const AUDIO_DIR = path.join(DATA_DIR, 'audio');
const DB_PATH = path.join(DATA_DIR, 'narratio.db');

async function ensureFeedFallbackAudio(
  db: ReturnType<typeof getDb>,
  feedId: number,
  ttsHost: string,
  ttsPort: number,
  unavailableText: string,
  ttsFailedText: string,
): Promise<void> {
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
  const ttsOpts = { host: ttsHost, port: ttsPort, timeoutMs: env.TTS_TIMEOUT(), outputDir: AUDIO_DIR };
  const fallbacks = [
    { filename: `unavailable-${feedId}.wav`, text: unavailableText },
    { filename: `tts-failed-${feedId}.wav`, text: ttsFailedText },
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

async function ensureFallbackAudio(db: ReturnType<typeof getDb>): Promise<void> {
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
  const feedsList = getFeeds(db);
  for (const feed of feedsList) {
    const ttsService = getTtsServiceById(db, feed.tts_service_id);
    if (!ttsService) continue;
    await ensureFeedFallbackAudio(
      db,
      feed.id,
      ttsService.host,
      ttsService.port,
      feed.unavailable_message ?? env.UNAVAILABLE_MESSAGE(),
      feed.tts_failed_message ?? env.TTS_FAILED_MESSAGE(),
    );
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
      ensureFeedFallbackAudio(
        db, feed.id, ttsService.host, ttsService.port,
        feed.unavailable_message ?? env.UNAVAILABLE_MESSAGE(),
        feed.tts_failed_message ?? env.TTS_FAILED_MESSAGE(),
      ).catch((err) => logger.warn(`Lazy fallback audio failed: ${err instanceof Error ? err.message : String(err)}`));
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
      const feedsList = getFeeds(db);
      const ttsServicesList = getTtsServices(db);
      const html = renderDashboard(articles, baseUrl, feedsList, ttsServicesList);
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

  // ── Feeds API ───────────────────────────────────────────────────────────────

  app.get('/api/feeds', (_req, res) => {
    const feedsList = getFeeds(db).map((feed) => ({
      ...feed,
      tts_service_name: getTtsServiceById(db, feed.tts_service_id)?.name ?? 'Unknown',
    }));
    res.json(feedsList);
  });

  app.post('/api/feeds', (req, res) => {
    const { name, rss_url, slug, title, tts_service_id, ...rest } = req.body ?? {};

    if (!name || !rss_url || !slug || !title || !tts_service_id) {
      res.status(400).send('Missing required fields: name, rss_url, slug, title, tts_service_id');
      return;
    }
    if (!/^[a-z0-9-]+$/.test(String(slug))) {
      res.status(400).send('Slug must contain only lowercase letters, numbers, and hyphens');
      return;
    }
    if (!getTtsServiceById(db, Number(tts_service_id))) {
      res.status(400).send('TTS service not found');
      return;
    }

    try {
      const feed = insertFeed(db, { name, rss_url, slug, title, tts_service_id: Number(tts_service_id), ...rest });
      res.status(201).json(feed);
    } catch (err) {
      if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
        res.status(409).send('A feed with this slug already exists');
        return;
      }
      logger.error('Failed to create feed', err);
      res.status(500).send('Internal server error');
    }
  });

  app.put('/api/feeds/:id', (req, res) => {
    const id = Number(req.params['id']);
    if (!getFeedById(db, id)) {
      res.status(404).send('Feed not found');
      return;
    }

    const { slug, tts_service_id, ...rest } = req.body ?? {};

    if (slug !== undefined && !/^[a-z0-9-]+$/.test(String(slug))) {
      res.status(400).send('Slug must contain only lowercase letters, numbers, and hyphens');
      return;
    }
    if (tts_service_id !== undefined && !getTtsServiceById(db, Number(tts_service_id))) {
      res.status(400).send('TTS service not found');
      return;
    }

    const params = {
      ...rest,
      ...(slug !== undefined ? { slug: String(slug) } : {}),
      ...(tts_service_id !== undefined ? { tts_service_id: Number(tts_service_id) } : {}),
    };

    try {
      const updated = updateFeed(db, id, params);
      res.json(updated);
    } catch (err) {
      if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
        res.status(409).send('A feed with this slug already exists');
        return;
      }
      logger.error('Failed to update feed', err);
      res.status(500).send('Internal server error');
    }
  });

  app.delete('/api/feeds/:id', (req, res) => {
    const id = Number(req.params['id']);
    if (!getFeedById(db, id)) {
      res.status(404).send('Feed not found');
      return;
    }

    const articleCount = countArticlesByFeed(db, id);
    if (articleCount > 0) {
      res.status(409).send(`Cannot delete: feed has ${articleCount} article(s). Delete articles first.`);
      return;
    }

    deleteFeed(db, id);
    res.status(204).end();
  });

  // ── TTS Services API ─────────────────────────────────────────────────────────

  app.post('/api/tts-services/test-connection', (req, res) => {
    const { host, port } = req.body ?? {};
    if (!host || port == null) {
      res.status(400).json({ ok: false, message: 'Missing required fields: host, port' });
      return;
    }
    const portNum = Number(port);
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      res.status(400).json({ ok: false, message: 'port must be an integer between 1 and 65535' });
      return;
    }
    const CONNECT_TIMEOUT_MS = 5000;
    const socket = new net.Socket();
    let settled = false;

    const done = (ok: boolean, message: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      res.json({ ok, message });
    };

    const timer = setTimeout(() => {
      done(false, `Connection timed out after ${CONNECT_TIMEOUT_MS / 1000}s — host unreachable or port not open`);
    }, CONNECT_TIMEOUT_MS);

    socket.connect(portNum, String(host), () => {
      done(true, `Connected to ${String(host)}:${portNum} successfully`);
    });

    socket.on('error', (err) => {
      done(false, `Connection failed: ${err.message}`);
    });
  });

  app.get('/api/tts-services', (_req, res) => {
    res.json(getTtsServices(db));
  });

  app.post('/api/tts-services', (req, res) => {
    const { name, host, port } = req.body ?? {};
    if (!name || !host || port == null) {
      res.status(400).send('Missing required fields: name, host, port');
      return;
    }
    const portNum = Number(port);
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      res.status(400).send('port must be an integer between 1 and 65535');
      return;
    }
    try {
      const svc = insertTtsService(db, { name: String(name), host: String(host), port: portNum });
      res.status(201).json(svc);
    } catch (err) {
      logger.error('Failed to create TTS service', err);
      res.status(500).send('Internal server error');
    }
  });

  app.put('/api/tts-services/:id', (req, res) => {
    const id = Number(req.params['id']);
    if (!getTtsServiceById(db, id)) {
      res.status(404).send('TTS service not found');
      return;
    }
    const { name, host, port } = req.body ?? {};
    const params: { name?: string; host?: string; port?: number } = {};
    if (name !== undefined) params.name = String(name);
    if (host !== undefined) params.host = String(host);
    if (port !== undefined) {
      const portNum = Number(port);
      if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
        res.status(400).send('port must be an integer between 1 and 65535');
        return;
      }
      params.port = portNum;
    }
    try {
      const updated = updateTtsService(db, id, params);
      res.json(updated);
    } catch (err) {
      logger.error('Failed to update TTS service', err);
      res.status(500).send('Internal server error');
    }
  });

  app.delete('/api/tts-services/:id', (req, res) => {
    const id = Number(req.params['id']);
    if (!getTtsServiceById(db, id)) {
      res.status(404).send('TTS service not found');
      return;
    }
    const feedCount = countFeedsByTtsService(db, id);
    if (feedCount > 0) {
      res.status(409).send(`Cannot delete: ${feedCount} feed(s) use this TTS service. Reassign them first.`);
      return;
    }
    deleteTtsService(db, id);
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
