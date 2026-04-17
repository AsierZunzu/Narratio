import cron from 'node-cron';
import fs from 'fs';
import path from 'path';
import { getDb, closeDb, resetDb } from '../db/index.js';
import { resetFailedRetries, resetConvertingArticles, resetAllArticlesForRegen } from '../db/articles.js';
import { processFeed, processPendingArticles } from '../services/rss.js';
import { runCleanup } from '../services/cleanup.js';
import { env } from '../utils/env.js';
import { logger } from '../utils/logger.js';

const DATA_DIR = path.join(process.cwd(), 'data');
const AUDIO_DIR = path.join(DATA_DIR, 'audio');
const DB_PATH = path.join(DATA_DIR, 'narratio.db');

function buildTtsOpts() {
  return {
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

function buildRssOpts() {
  return {
    feedUrl: env.RSS_URL(),
    fetchTimeoutMs: env.RSS_FETCH_TIMEOUT(),
    ...buildTtsOpts(),
  };
}

function buildCleanupOpts() {
  return {
    maxAudioFiles: env.MAX_AUDIO_FILES(),
    maxAudioSizeMb: env.MAX_AUDIO_SIZE_MB(),
    audioDir: AUDIO_DIR,
  };
}

let isRunning = false;

async function runOnce(isFirst = false): Promise<void> {
  if (isRunning) {
    logger.info('Skipping RSS poll — previous run still in progress');
    return;
  }
  isRunning = true;
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
  const db = getDb(DB_PATH);
  if (isFirst) {
    const stuck = resetConvertingArticles(db);
    if (stuck > 0) logger.warn(`Reset ${stuck} stuck 'converting' articles to pending`);
  }
  try {
    await processFeed(db, buildRssOpts());
    runCleanup(db, buildCleanupOpts());
  } catch (err) {
    logger.error('Worker run failed', err);
  } finally {
    isRunning = false;
  }
}

async function runPendingCheck(): Promise<void> {
  if (isRunning) return;
  isRunning = true;
  try {
    const db = getDb(DB_PATH);
    await processPendingArticles(db, buildTtsOpts());
  } catch (err) {
    logger.error('Pending check failed', err);
  } finally {
    isRunning = false;
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

function handleRegenAudio(): void {
  logger.warn('--regen-audio: deleting all audio files and resetting all articles to pending');
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
  if (fs.existsSync(AUDIO_DIR)) {
    for (const file of fs.readdirSync(AUDIO_DIR)) {
      if (file.endsWith('.wav')) fs.rmSync(path.join(AUDIO_DIR, file), { force: true });
    }
  }
  const db = getDb(DB_PATH);
  const count = resetAllArticlesForRegen(db);
  logger.info(`Deleted audio files and reset ${count} articles to pending`);
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
  const regenAudio = args.includes('--regen-audio');

  if (forceReset) {
    handleForceReset();
    process.exit(0);
  }
  if (process.env['FORCE_RESET'] === 'true') {
    handleForceReset();
  }
  if (regenAudio) {
    handleRegenAudio();
    process.exit(0);
  }
  if (retryFailed) handleRetryFailed();

  const pollInterval = env.POLL_INTERVAL();

  let shuttingDown = false;
  const cronTasks: cron.ScheduledTask[] = [];

  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('Worker shutting down…');
    for (const task of cronTasks) task.stop();
    closeDb();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  logger.info('Worker starting');

  // Run immediately on startup (reset any stale converting articles first)
  await runOnce(true);

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

  logger.info(`Scheduling RSS poll: ${pollInterval}`);
  cronTasks.push(cron.schedule(pollInterval, async () => {
    if (shuttingDown) return;
    await runOnce();
  }));

  // Check every minute for pending/retryable work (e.g. triggered via web UI)
  cronTasks.push(cron.schedule('* * * * *', async () => {
    if (shuttingDown) return;
    await runPendingCheck();
  }));
  logger.info('Scheduling pending check: every minute');
}

main().catch((err) => {
  logger.error('Fatal worker error', err);
  process.exit(1);
});
