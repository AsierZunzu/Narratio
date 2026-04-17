import fs from 'fs';
import path from 'path';
import type { Db } from '../db/index.js';
import { getDoneArticlesOrderedByDate, markArticlePurged } from '../db/articles.js';
import { logger } from '../utils/logger.js';

export interface CleanupOptions {
  maxAudioFiles: number;
  maxAudioSizeMb: number;
  audioDir: string;
}

/**
 * Enforces audio storage quotas after each RSS poll.
 *
 * Deletes the oldest WAV files first (by pub_date ASC, then created_at ASC)
 * until both quotas are satisfied. Deleted articles are marked as 'purged'
 * in the DB so they remain visible in the podcast feed with fallback audio.
 */
export function runCleanup(db: Db, opts: CleanupOptions): void {
  const { maxAudioFiles, maxAudioSizeMb, audioDir } = opts;
  if (maxAudioFiles === Infinity && maxAudioSizeMb === Infinity) return;

  const articles = getDoneArticlesOrderedByDate(db);
  let fileCount = articles.length;
  let totalBytes = articles.reduce((sum, a) => {
    if (!a.audio_file) return sum;
    const filePath = path.join(audioDir, a.audio_file);
    try {
      return sum + fs.statSync(filePath).size;
    } catch {
      return sum;
    }
  }, 0);

  for (const article of articles) {
    const overFiles = fileCount > maxAudioFiles;
    const overSize = totalBytes / (1024 * 1024) > maxAudioSizeMb;
    if (!overFiles && !overSize) break;

    if (!article.audio_file) continue;

    const filePath = path.join(audioDir, article.audio_file);
    let fileSize = 0;
    try {
      fileSize = fs.statSync(filePath).size;
      fs.unlinkSync(filePath);
      logger.info(`Purged audio: ${article.audio_file} (${article.title})`);
    } catch {
      // File may already be missing; still mark as purged in DB
    }

    markArticlePurged(db, article.guid);
    fileCount--;
    totalBytes -= fileSize;
  }
}
