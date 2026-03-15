import Parser from 'rss-parser'
import { db as defaultDb } from './database/db'
import { Database as BetterSqlite3Database } from 'better-sqlite3'
import { textToAudio } from './tts'

const parser = new Parser()

export async function parseRSSFeeds(urls: string[], db: BetterSqlite3Database = defaultDb, customParser?: Parser) {
  const p = customParser || parser
  for (const url of urls) {
    try {
      console.log(`Fetching feed from: ${url}`)
      const feed = await p.parseURL(url)
      console.log(`Processing feed: ${feed.title}`)

      const insert = db.prepare('INSERT INTO articles (id, title, link, pub_date, content) VALUES (?, ?, ?, ?, ?)')
      const update = db.prepare('UPDATE articles SET audio_path = ?, processed_at = ? WHERE id = ?')

      for (const item of feed.items) {
        const id = item.guid || item.link || item.title || ''
        const title = item.title || 'No Title'
        const link = item.link || ''
        const pubDate = item.pubDate || new Date().toISOString()
        const content = item.contentSnippet || item.content || ''

        try {
          insert.run(id, title, link, pubDate, content)
          console.log(`- New article: ${title}`)

          // Trigger TTS for the new article
          try {
            console.log('  - Generating audio...')
            const audioPath = await textToAudio(id.replace(/[^a-z0-9]/gi, '_'), content)
            update.run(audioPath, new Date().toISOString(), id)
            console.log(`  - Audio saved: ${audioPath}`)
          } catch (ttsErr) {
            console.error(`  - TTS failed for ${title}:`, ttsErr)
          }
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
