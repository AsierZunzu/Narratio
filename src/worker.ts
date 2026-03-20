import * as cron from 'node-cron'
import { parseRSSFeed } from './rss'
import { isValidURL, checkReachability } from './utils/url'
import { db, resetDatabase } from './database/db'
import { deleteAllAudioFiles } from './utils/storage'
import { createLogger } from './logger'

const logger = createLogger('Worker')

async function runWorkerTask(feedUrl: string) {
  try {
    logger.log('Running scheduled RSS ingestion...')
    await parseRSSFeed(feedUrl)
    logger.log('RSS ingestion complete.')
  } catch (err) {
    logger.error('RSS ingestion failed:', err)
  }
}

export async function main() {
  const args = process.argv.slice(2)
  const forceReset = args.includes('--force-reset')
  const urls = args.filter(arg => arg !== '--force-reset')

  let feedUrl = urls[0]

  // Also check for URL in environment variable if not provided via CLI
  if (!feedUrl && process.env['RSS_URL']) {
    feedUrl = process.env['RSS_URL'].trim()
  }

  if (!feedUrl) {
    logger.error('No RSS URL provided. Use command line arguments or RSS_URL environment variable.')
    process.exit(1)
    return // for TS
  }

  if (!isValidURL(feedUrl)) {
    logger.error(`"${feedUrl}" is not a valid URL.`)
    process.exit(1)
    return // for TS
  }

  const isReachable = await checkReachability(feedUrl)
  if (!isReachable) {
    logger.error(`"${feedUrl}" is not reachable.`)
    process.exit(1)
    return // for TS
  }

  // Check against stored feed URL
  const storedUrlRow = db.prepare('SELECT value FROM metadata WHERE key = \'feed_url\'').get() as { value: string } | undefined
  const storedUrl = storedUrlRow?.value
  if (forceReset) {
    logger.log('Force reset requested. Reinitializing database for new feed...')
    deleteAllAudioFiles()
    resetDatabase(db)
    db.prepare('INSERT INTO metadata (key, value) VALUES (\'feed_url\', ?)').run(feedUrl)
  }
  if (storedUrl && storedUrl !== feedUrl) {
    logger.error('The provided feed URL does not match the one stored in the database.')
    logger.error(`Stored: ${storedUrl}`)
    logger.error(`Provided: ${feedUrl}`)
    logger.error('If you want to change the feed, the database must be reinitialized.')
    logger.error('Use the --force-reset flag to reinitialize the database and articles.')
    process.exit(1)
    return // for TS
  }
  if (!storedUrl) {
    db.prepare('INSERT INTO metadata (key, value) VALUES (\'feed_url\', ?)').run(feedUrl)
  }

  const pollInterval = process.env['POLL_INTERVAL']

  if (pollInterval) {
    if (!cron.validate(pollInterval)) {
      logger.error(`Invalid cron expression "${pollInterval}"`)
      process.exit(1)
      return // for TS
    }

    logger.log(`Starting in cron mode: "${pollInterval}"`)

    // Run immediately on start
    await runWorkerTask(feedUrl)

    const task = cron.schedule(pollInterval, () => runWorkerTask(feedUrl))

    const shutdown = (signal: string) => {
      logger.log(`Received ${signal}, shutting down...`)
      task.stop()
      db.close()
      process.exit(0)
    }
    process.once('SIGTERM', () => shutdown('SIGTERM'))
    process.once('SIGINT', () => shutdown('SIGINT'))

    logger.log('Active and waiting for next scheduled run.')
  } else {
    // Single run mode
    await runWorkerTask(feedUrl)
  }
}

if (require.main === module) {
  main().catch(err => {
    logger.error('Fatal error:', err)
    process.exit(1)
  })
}