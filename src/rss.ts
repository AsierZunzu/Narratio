import Parser from 'rss-parser'
import { db as defaultDb } from './database/db'
import { Database as BetterSqlite3Database } from 'better-sqlite3'
import { textToAudio } from './tts'
import { convert } from 'html-to-text'
import { createLogger } from './logger'

const logger = createLogger('RSS')

type CustomItem = {
  contentEncoded?: string
}

const parser = new Parser<Record<string, never>, CustomItem>({
  customFields: {
    item: [['content:encoded', 'contentEncoded']],
  }
})

const TTS_MAX_RETRIES = parseInt(process.env.TTS_MAX_RETRIES ?? '3', 10)
const RSS_FETCH_TIMEOUT = parseInt(process.env['RSS_FETCH_TIMEOUT'] ?? '30000', 10)

async function retryFailedArticles(db: BetterSqlite3Database): Promise<void> {
  const eligible = db.prepare(`
    SELECT id, title, content
    FROM   articles
    WHERE  audio_path IS NULL
      AND  is_purged  = 0
      AND  tts_retry_count > 0
      AND  tts_retry_count < ?
  `).all(TTS_MAX_RETRIES) as { id: string; title: string; content: string }[]

  if (eligible.length === 0) return

  const updateSuccess = db.prepare(`
    UPDATE articles
    SET audio_path      = ?,
        processed_at    = ?,
        tts_retry_count = 0,
        tts_failed_at   = NULL,
        tts_error       = NULL
    WHERE id = ?
  `)
  const updateFailure = db.prepare(`
    UPDATE articles
    SET tts_retry_count = tts_retry_count + 1,
        tts_failed_at   = ?,
        tts_error       = ?
    WHERE id = ?
  `)

  for (const article of eligible) {
    const retryNum = (db.prepare('SELECT tts_retry_count FROM articles WHERE id = ?').get(article.id) as { tts_retry_count: number }).tts_retry_count
    logger.log(`  Retrying TTS (attempt ${retryNum + 1}/${TTS_MAX_RETRIES}): ${article.title}`)
    try {
      const audioPath = await textToAudio(article.id.replace(/[^a-z0-9]/gi, '_'), article.content)
      updateSuccess.run(audioPath, new Date().toISOString(), article.id)
      logger.log(`  Audio saved: ${audioPath}`)
    } catch (ttsErr) {
      logger.error(`  TTS retry failed for: ${article.title}`, ttsErr)
      updateFailure.run(new Date().toISOString(), ttsErr instanceof Error ? ttsErr.message : String(ttsErr), article.id)
    }
  }
}

export async function parseRSSFeed(url: string, db: BetterSqlite3Database = defaultDb, customParser?: Parser<Record<string, never>, CustomItem>) {
  const p = customParser || parser
  let fetchTimeoutId: ReturnType<typeof setTimeout> | undefined
  try {
    logger.log(`Fetching feed: ${url}`)
    const feed = await Promise.race([
      p.parseURL(url),
      new Promise<never>((_, reject) => {
        fetchTimeoutId = setTimeout(
          () => reject(new Error(`RSS fetch timed out after ${RSS_FETCH_TIMEOUT}ms`)),
          RSS_FETCH_TIMEOUT
        )
      })
    ])
    clearTimeout(fetchTimeoutId)
    logger.log(`Processing feed: ${feed.title}`)

    const insert = db.prepare('INSERT INTO articles (id, title, link, pub_date, content) VALUES (?, ?, ?, ?, ?)')
    const updateSuccess = db.prepare(`
      UPDATE articles
      SET audio_path      = ?,
          processed_at    = ?,
          tts_retry_count = 0,
          tts_failed_at   = NULL,
          tts_error       = NULL
      WHERE id = ?
    `)
    const updateFailure = db.prepare(`
      UPDATE articles
      SET tts_retry_count = tts_retry_count + 1,
          tts_failed_at   = ?,
          tts_error       = ?
      WHERE id = ?
    `)

    for (const item of feed.items) {
      const id = item.guid || item.link || item.title || ''
      const title = item.title || 'No Title'
      const link = item.link || ''
      const pubDate = item.pubDate || new Date().toISOString()
      const content = item.contentEncoded || item.contentSnippet || item.content || ''
      const humanContent = convert(content, {
        selectors: [
          { selector: 'img', format: 'skip' },
          { selector: 'figure', format: 'skip' },  // skips the whole figure/image block
          { selector: 'a', options: { ignoreHref: true } },
        ]
      })
      const text = `${title} \n\n\n ${humanContent}`

      try {
        insert.run(id, title, link, pubDate, humanContent)
        logger.log(`New article: ${title}`)

        // Trigger TTS for the new article
        try {
          logger.log(`  Generating audio for: ${title}`)
          const audioPath = await textToAudio(id.replace(/[^a-z0-9]/gi, '_'), text)
          updateSuccess.run(audioPath, new Date().toISOString(), id)
          logger.log(`  Audio saved: ${audioPath}`)
        } catch (ttsErr) {
          logger.error(`  TTS failed for: ${title}`, ttsErr)
          updateFailure.run(new Date().toISOString(), ttsErr instanceof Error ? ttsErr.message : String(ttsErr), id)
        }
      } catch (err) {
        if (err instanceof Error && (err as { code?: string }).code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
          // Article already exists, skipping
        } else {
          logger.error(`Error inserting article: ${title}`, err)
        }
      }
    }

    await retryFailedArticles(db)
  } catch (err) {
    clearTimeout(fetchTimeoutId)
    logger.error(`Error parsing feed from ${url}:`, err)
  }
}
