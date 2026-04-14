import cron from 'node-cron';
import fs from 'fs';
import path from 'path';
import { getDb, closeDb, resetDb } from '../db/index.js';
import { resetFailedRetries } from '../db/articles.js';
import { processFeed } from '../services/rss.js';
import { runCleanup } from '../services/cleanup.js';
import { env } from '../utils/env.js';
import { logger } from '../utils/logger.js';

const DATA_DIR = path.join(process.cwd(), 'data');
const AUDIO_DIR = path.join(DATA_DIR, 'audio');
const DB_PATH = path.join(DATA_DIR, 'narratio.db');

function buildRssOpts() {
  return {
    feedUrl: env.RSS_URL(),
    fetchTimeoutMs: env.RSS_FETCH_TIMEOUT(),
    maxRetries: env.TTS_MAX_RETRIES(),
    tts: {
      host: env.PIPER_HOST(),
      port: env.PIPER_PORT(),
      timeoutMs: env.TTS_TIMEOUT(),
      outputDir: AUDIO_DIR,
    },
    audioDir: AUDIO_DIR,
  };
}

function buildCleanupOpts() {
  return {
    maxAudioFiles: env.MAX_AUDIO_FILES(),
    maxAudioSizeMb: env.MAX_AUDIO_SIZE_MB(),
    audioDir: AUDIO_DIR,
  };
}

async function runOnce(): Promise<void> {
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
  const db = getDb(DB_PATH);
  try {
    await processFeed(db, buildRssOpts());
    runCleanup(db, buildCleanupOpts());
  } catch (err) {
    logger.error('Worker run failed', err);
  }
}

function handleForceReset(): void {
  logger.warn('--force-reset: deleting all audio files and reinitialising DB');
  try {
    if (fs.existsSync(AUDIO_DIR)) fs.rmSync(AUDIO_DIR, { recursive: true, force: true });
    if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
    resetDb();
  } catch (err) {
    logger.error('force-reset failed', err);
    process.exit(1);
  }
  logger.info('force-reset complete');
}

function handleRetryFailed(): void {
  logger.info('--retry-failed: resetting TTS retry counters');
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
  const db = getDb(DB_PATH);
  const count = resetFailedRetries(db);
  logger.info(`Reset ${count} failed articles to pending`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const forceReset = args.includes('--force-reset');
  const retryFailed = args.includes('--retry-failed');

  if (forceReset) handleForceReset();
  if (retryFailed) handleRetryFailed();

  const pollInterval = env.POLL_INTERVAL();

  let shuttingDown = false;
  let cronTask: cron.ScheduledTask | null = null;

  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('Worker shutting down…');
    if (cronTask) cronTask.stop();
    closeDb();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  logger.info('Worker starting');

  // Run immediately on startup
  await runOnce();

  if (!pollInterval) {
    logger.info('No POLL_INTERVAL set — running once and exiting');
    closeDb();
    return;
  }

  if (!cron.validate(pollInterval)) {
    logger.error(`Invalid POLL_INTERVAL cron expression: ${pollInterval}`);
    closeDb();
    process.exit(1);
  }

  logger.info(`Scheduling poll: ${pollInterval}`);
  cronTask = cron.schedule(pollInterval, async () => {
    if (shuttingDown) return;
    await runOnce();
  });
}

main().catch((err) => {
  logger.error('Fatal worker error', err);
  process.exit(1);
});
