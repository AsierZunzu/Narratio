import Parser from 'rss-parser'
import { db } from './database/db'

const parser = new Parser()

export async function parseRSSFeeds(urls: string[]) {
  for (const url of urls) {
    try {
      console.log(`Fetching feed from: ${url}`)
      const feed = await parser.parseURL(url)
      console.log(`Processing feed: ${feed.title}`)

      const insert = db.prepare('INSERT INTO articles (id, title, link, pub_date, content) VALUES (?, ?, ?, ?, ?)')

      for (const item of feed.items) {
        const id = item.guid || item.link || item.title || ''
        const title = item.title || 'No Title'
        const link = item.link || ''
        const pubDate = item.pubDate || new Date().toISOString()
        const content = item.contentSnippet || item.content || ''

        try {
          insert.run(id, title, link, pubDate, content)
          console.log(`- New article: ${title}`)
        } catch (err) {
          if (err instanceof Error && (err as { code?: string }).code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
            // Article already exists, skipping
          } else {
            console.error(`- Error inserting article ${title}:`, err)
          }
        }
      }
    } catch (err) {
      console.error(`Error parsing feed from ${url}:`, err)
    }
  }
}
