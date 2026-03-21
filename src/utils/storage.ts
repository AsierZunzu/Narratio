import { readdirSync, statSync, unlinkSync, existsSync } from 'fs'
import { join, basename } from 'path'
import { db } from '../database/db'
import { createLogger } from './logger'

const logger = createLogger('Storage')

const DATA_DIR = join(process.cwd(), 'data')
const AUDIO_DIR = join(DATA_DIR, 'audio')

export function deleteAllAudioFiles(): void {
  if (!existsSync(AUDIO_DIR)) return

  const files = readdirSync(AUDIO_DIR).filter(file => file.endsWith('.wav'))

  for (const file of files) {
    const filePath = join(AUDIO_DIR, file)
    try {
      unlinkSync(filePath)
      logger.log(`Force reset: Removed audio file ${file}`)
    } catch (err) {
      logger.error(`Force reset: Failed to remove ${file}:`, err)
    }
  }
}

export function cleanupStorage(): void {
  const MAX_FILES = process.env.MAX_AUDIO_FILES ? parseInt(process.env.MAX_AUDIO_FILES, 10) : Infinity
  const MAX_SIZE_MB = process.env.MAX_AUDIO_SIZE_MB ? parseFloat(process.env.MAX_AUDIO_SIZE_MB) : Infinity
  const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024

  if (MAX_FILES === Infinity && MAX_SIZE_MB === Infinity) return

  const articles = db.getActiveAudioArticles()
    .map(row => {
      const size = existsSync(row.audio_path) ? statSync(row.audio_path).size : 0
      return { id: row.id, path: row.audio_path, size, pubDate: new Date(row.pub_date) }
    })
    .sort((a, b) => a.pubDate.getTime() - b.pubDate.getTime()) // Oldest first

  let currentCount = articles.length
  let currentSize = articles.reduce((sum, a) => sum + a.size, 0)

  for (const article of articles) {
    const exceedsCount = currentCount > MAX_FILES
    const exceedsSize = currentSize > MAX_SIZE_BYTES

    if (!exceedsCount && !exceedsSize) break

    try {
      unlinkSync(article.path)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.error(`Storage cleanup: Failed to remove ${basename(article.path)}:`, err)
        continue
      }
    }
    db.markArticlePurged(article.id)
    currentCount--
    currentSize -= article.size
    logger.log(`Storage cleanup: Removed oldest file ${basename(article.path)}`)
  }
}
