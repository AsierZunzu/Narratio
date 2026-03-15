import { parseRSSFeed } from './rss'
import { isValidURL, checkReachability } from './utils/url'
import { db, resetDatabase } from './database/db'

async function main() {
  const args = process.argv.slice(2)
  const forceReset = args.includes('--force')
  const urls = args.filter(arg => arg !== '--force')
  
  let feedUrl = urls[0]

  // Also check for URL in environment variable if not provided via CLI
  if (!feedUrl && process.env.RSS_URL) {
    feedUrl = process.env.RSS_URL.trim()
  }

  if (!feedUrl) {
    console.error('Error: No RSS URL provided. Use command line arguments or RSS_URL environment variable.')
    process.exit(1)
  }

  if (!isValidURL(feedUrl)) {
    console.error(`Error: "${feedUrl}" is not a valid URL.`)
    process.exit(1)
  }

  const isReachable = await checkReachability(feedUrl)
  if (!isReachable) {
    console.error(`Error: "${feedUrl}" is not reachable.`)
    process.exit(1)
  }

  // Check against stored feed URL
  const storedUrlRow = db.prepare('SELECT value FROM metadata WHERE key = \'feed_url\'').get() as { value: string } | undefined
  const storedUrl = storedUrlRow?.value

  if (storedUrl && storedUrl !== feedUrl) {
    if (forceReset) {
      console.log('Force reset requested. Reinitializing database for new feed...')
      resetDatabase()
      db.prepare('INSERT INTO metadata (key, value) VALUES (\'feed_url\', ?)').run(feedUrl)
    } else {
      console.error('Error: The provided feed URL does not match the one stored in the database.')
      console.error(`Stored: ${storedUrl}`)
      console.error(`Provided: ${feedUrl}`)
      console.error('If you want to change the feed, the database must be reinitialized.')
      console.error('Use the --force flag to reinitialize the database and articles.')
      process.exit(1)
    }
  } else if (!storedUrl) {
    db.prepare('INSERT INTO metadata (key, value) VALUES (\'feed_url\', ?)').run(feedUrl)
  }

  await parseRSSFeed(feedUrl)
  console.log('RSS parsing complete.')
}

main().catch(err => {
  console.error('Fatal error in worker:', err)
  process.exit(1)
})
