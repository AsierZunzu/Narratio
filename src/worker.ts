import * as cron from 'node-cron'
import { parseRSSFeed } from './rss'
import { isValidURL, checkReachability } from './utils/url'
import { db, resetDatabase } from './database/db'

async function runWorkerTask(feedUrl: string) {
  try {
    console.log(`[${new Date().toISOString()}] Running scheduled RSS ingestion...`)
    await parseRSSFeed(feedUrl)
    console.log(`[${new Date().toISOString()}] RSS ingestion complete.`)
  } catch (err) {
    console.error(`[${new Date().toISOString()}] RSS ingestion failed:`, err)
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
    console.error('Error: No RSS URL provided. Use command line arguments or RSS_URL environment variable.')
    process.exit(1)
    return // for TS
  }

  if (!isValidURL(feedUrl)) {
    console.error(`Error: "${feedUrl}" is not a valid URL.`)
    process.exit(1)
    return // for TS
  }

  const isReachable = await checkReachability(feedUrl)
  if (!isReachable) {
    console.error(`Error: "${feedUrl}" is not reachable.`)
    process.exit(1)
    return // for TS
  }

  // Check against stored feed URL
  const storedUrlRow = db.prepare('SELECT value FROM metadata WHERE key = \'feed_url\'').get() as { value: string } | undefined
  const storedUrl = storedUrlRow?.value
  if (forceReset) {
    console.log('Force reset requested. Reinitializing database for new feed...')
    resetDatabase(db)
    db.prepare('INSERT INTO metadata (key, value) VALUES (\'feed_url\', ?)').run(feedUrl)
  }
  if (storedUrl && storedUrl !== feedUrl) {
    console.error('Error: The provided feed URL does not match the one stored in the database.')
    console.error(`Stored: ${storedUrl}`)
    console.error(`Provided: ${feedUrl}`)
    console.error('If you want to change the feed, the database must be reinitialized.')
    console.error('Use the --force-reset flag to reinitialize the database and articles.')
    process.exit(1)
    return // for TS
  }
  if (!storedUrl) {
    db.prepare('INSERT INTO metadata (key, value) VALUES (\'feed_url\', ?)').run(feedUrl)
  }

  const pollInterval = process.env['POLL_INTERVAL']

  if (pollInterval) {
    if (!cron.validate(pollInterval)) {
      console.error(`Error: Invalid cron expression "${pollInterval}"`)
      process.exit(1)
      return // for TS
    }

    console.log(`Starting worker in cron mode: "${pollInterval}"`)

    // Run immediately on start
    await runWorkerTask(feedUrl)

    cron.schedule(pollInterval, () => runWorkerTask(feedUrl))

    console.log('Worker is active and waiting for next scheduled run.')
  } else {
    // Single run mode
    await runWorkerTask(feedUrl)
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error('Fatal error in worker:', err)
    process.exit(1)
  })
}