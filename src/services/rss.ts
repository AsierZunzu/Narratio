import Parser from 'rss-parser'
import { db as defaultDb, PodcastDatabase } from '../database/db'
import { textToAudio } from './tts'
import { convert } from 'html-to-text'
import { createLogger } from '../utils/logger'
import { cleanupStorage } from '../utils/storage'

const logger = createLogger('RSS')

type CustomItem = {
  contentEncoded?: string
  itunes?: { image?: string }
  mediaContent?: { $?: { url?: string } } | { $?: { url?: string } }[]
  mediaThumbnail?: { $?: { url?: string } } | { $?: { url?: string } }[]
}

const parser = new Parser<Record<string, never>, CustomItem>({
  customFields: {
    item: [
      ['content:encoded', 'contentEncoded'],
      ['media:content', 'mediaContent'],
      ['media:thumbnail', 'mediaThumbnail'],
    ],
  }
})

const TTS_MAX_RETRIES = parseInt(process.env.TTS_MAX_RETRIES ?? '3', 10)
const RSS_FETCH_TIMEOUT = parseInt(process.env['RSS_FETCH_TIMEOUT'] ?? '30000', 10)

function extractArticleImage(item: Parser.Item & CustomItem): string | null {
  if (item.itunes?.image) return item.itunes.image

  const mediaContent = Array.isArray(item.mediaContent) ? item.mediaContent[0] : item.mediaContent
  if (mediaContent?.['$']?.url) return mediaContent['$'].url

  const mediaThumbnail = Array.isArray(item.mediaThumbnail) ? item.mediaThumbnail[0] : item.mediaThumbnail
  if (mediaThumbnail?.['$']?.url) return mediaThumbnail['$'].url

  if (item.enclosure?.url && /\.(jpe?g|png|gif|webp)(\?|$)/i.test(item.enclosure.url)) {
    return item.enclosure.url
  }

  const rawHtml = (item as { contentEncoded?: string }).contentEncoded || item.content || ''
  const match = rawHtml.match(/<img[^>]+src=["']([^"']+)["']/i)
  return match ? match[1] : null
}

async function retryFailedArticles(db: PodcastDatabase): Promise<void> {
  const eligible = db.getRetryEligibleArticles(TTS_MAX_RETRIES)

  if (eligible.length === 0) return

  for (const article of eligible) {
    const retryNum = db.getArticleRetryCount(article.id)
    logger.log(`  Retrying TTS (attempt ${retryNum + 1}/${TTS_MAX_RETRIES}): ${article.title}`)
    try {
      const audioPath = await textToAudio(article.id.replace(/[^a-z0-9]/gi, '_'), article.content)
      db.markArticleAudioSuccess(article.id, audioPath)
      logger.log(`  Audio saved: ${audioPath}`)
    } catch (ttsErr) {
      logger.error(`  TTS retry failed for: ${article.title}`, ttsErr)
      db.markArticleAudioFailure(article.id, ttsErr instanceof Error ? ttsErr.message : String(ttsErr))
    }
  }
}

export async function parseRSSFeed(url: string, db: PodcastDatabase = defaultDb, customParser?: Parser<Record<string, never>, CustomItem>) {
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

    const feedImageUrl = (feed as { image?: { url?: string } }).image?.url || null
    if (feedImageUrl) {
      db.setFeedImageUrl(feedImageUrl)
    }

    for (const item of feed.items) {
      const id = item.guid || item.link || item.title || ''
      const title = item.title || 'No Title'
      const link = item.link || ''
      const pubDate = item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString()
      const content = item.contentEncoded || item.contentSnippet || item.content || ''
      const humanContent = convert(content, {
        selectors: [
          { selector: 'img', format: 'skip' },
          { selector: 'figure', format: 'skip' },
          { selector: 'a', options: { ignoreHref: true } },
        ]
      })
      const text = `${title} \n\n\n ${humanContent}`
      const imageUrl = extractArticleImage(item)

      if (!id) {
        logger.log(`Skipping article with no identifiable ID (title: "${title}")`)
        continue
      }

      try {
        db.insertArticle(id, title, link, pubDate, humanContent, imageUrl)
        logger.log(`New article: ${title}`)

        try {
          logger.log(`  Generating audio for: ${title}`)
          const audioPath = await textToAudio(id.replace(/[^a-z0-9]/gi, '_'), text)
          db.markArticleAudioSuccess(id, audioPath)
          logger.log(`  Audio saved: ${audioPath}`)
        } catch (ttsErr) {
          logger.error(`  TTS failed for: ${title}`, ttsErr)
          db.markArticleAudioFailure(id, ttsErr instanceof Error ? ttsErr.message : String(ttsErr))
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
    cleanupStorage()
  } catch (err) {
    clearTimeout(fetchTimeoutId)
    logger.error(`Error parsing feed from ${url}:`, err)
  }
}
