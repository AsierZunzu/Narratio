import { parseRSSFeeds } from './rss'
import { isValidURL, checkReachability } from './utils/url'

async function main() {
  const args = process.argv.slice(2)
  if (args.length === 0) {
    console.error('Error: No RSS URLs provided.')
    process.exit(1)
  }

  const urls: string[] = []
  for (const arg of args) {
    if (!isValidURL(arg)) {
      console.warn(`Warning: "${arg}" is not a valid URL. Skipping.`)
      continue
    }

    const isReachable = await checkReachability(arg)
    if (!isReachable) {
      console.warn(`Warning: "${arg}" is not reachable. Skipping.`)
      continue
    }

    urls.push(arg)
  }

  if (urls.length === 0) {
    console.error('Error: No valid and reachable URLs provided.')
    process.exit(1)
  }

  await parseRSSFeeds(urls)
  console.log('RSS parsing complete.')
}

main().catch(err => {
  console.error('Fatal error in worker:', err)
  process.exit(1)
})
