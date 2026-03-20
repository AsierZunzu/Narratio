import express from 'express'
import { Podcast } from 'podcast'
import { join } from 'path'
import { db } from './database/db'
import { statSync, existsSync } from 'fs'
import { textToAudio } from './tts'
import { createLogger } from './logger'

const logger = createLogger('Server')

const app = express()
const port = process.env['PORT'] || 3000
const DATA_DIR = join(process.cwd(), 'data')
const AUDIO_DIR = join(DATA_DIR, 'audio')

// Serve audio files
app.use('/audio', express.static(AUDIO_DIR))
app.use('/audio/unavailable.wav', express.static(join(DATA_DIR, 'unavailable.wav')))

interface Article {
  id: string;
  title: string;
  link: string;
  pub_date: string;
  content: string;
  audio_path: string | null;
  is_purged: number;
}

app.get('/rss', (req, res) => {
  const feedUrl = `${req.protocol}://${req.get('host')}/rss`
  const siteUrl = `${req.protocol}://${req.get('host')}`

  const storedUrlRow = db.prepare('SELECT value FROM metadata WHERE key = \'feed_url\'').get() as { value: string } | undefined
  const defaultDescription = storedUrlRow ? `Automatically generated podcast from ${storedUrlRow.value}` : 'Automatically generated podcast from RSS feeds'

  const podcast = new Podcast({
    title: process.env['PODCAST_TITLE'] || 'Narratio',
    description: process.env['PODCAST_DESCRIPTION'] || defaultDescription,
    feedUrl: feedUrl,
    siteUrl: siteUrl,
    author: process.env['PODCAST_AUTHOR'] || 'Narratio Worker',
    language: process.env['PODCAST_LANGUAGE'] || 'en',
    itunesAuthor: process.env['PODCAST_ITUNES_AUTHOR'] || process.env['PODCAST_AUTHOR'] || 'Narratio Worker',
    itunesSummary: process.env['PODCAST_ITUNES_SUMMARY'] || process.env['PODCAST_DESCRIPTION'] || defaultDescription,
    itunesOwner: {
      name: process.env['PODCAST_ITUNES_OWNER_NAME'] || process.env['PODCAST_AUTHOR'] || 'Narratio Worker',
      email: process.env['PODCAST_ITUNES_OWNER_EMAIL'] || 'worker@example.com'
    },
    itunesCategory: [{ text: process.env['PODCAST_ITUNES_CATEGORY'] || 'Technology' }],
  })

  const articles = db.prepare('SELECT * FROM articles WHERE audio_path IS NOT NULL OR is_purged = 1 ORDER BY pub_date DESC').all() as Article[]

  articles.forEach(article => {
    let audioUrl: string
    let fileSize = 0

    if (article.is_purged) {
      audioUrl = `${siteUrl}/audio/unavailable.wav`
      try {
        const stats = statSync(join(DATA_DIR, 'unavailable.wav'))
        fileSize = stats.size
      } catch (err) {
        logger.warn('Could not get size for unavailable.wav:', err)
      }
    } else {
      const audioFileName = article.audio_path!.split(/[/\\]/).pop()
      audioUrl = `${siteUrl}/audio/${audioFileName}`

      try {
        const stats = statSync(article.audio_path!)
        fileSize = stats.size
      } catch (err) {
        logger.warn(`Could not get file size for ${article.audio_path}:`, err)
      }
    }

    podcast.addItem({
      title: article.is_purged ? `[PURGED] ${article.title}` : article.title,
      description: article.is_purged ? `Original audio is no longer available. ${article.content}` : article.content,
      url: article.link,
      guid: article.id,
      date: article.pub_date,
      enclosure: {
        url: audioUrl,
        size: fileSize,
        type: 'audio/mpeg'
      }
    })
  })

  res.set('Content-Type', 'application/rss+xml')
  res.send(podcast.buildXml())
})

export { app }

export async function startServer() {
  // Ensure unavailable audio exists on startup
  const unavailablePath = join(AUDIO_DIR, 'unavailable.wav')
  if (!existsSync(unavailablePath)) {
    await generateUnavailableAudio()
  }

  return app.listen(port, () => {
    logger.log(`Server started at http://localhost:${port}`)
    logger.log(`Podcast RSS feed available at http://localhost:${port}/rss`)
  })
}

if (require.main === module) {
  startServer().catch(err => {
    logger.error('Fatal error starting server:', err)
    process.exit(1)
  })
}

async function generateUnavailableAudio(): Promise<void> {
  const message = process.env['UNAVAILABLE_MESSAGE'] || 'This content is no longer available on the server.'
  const filePath = join(AUDIO_DIR, 'unavailable.wav')

  try {
    logger.log('Generating unavailable audio...')
    await textToAudio('unavailable', message, filePath)
    logger.log(`Unavailable audio generated at: ${filePath}`)
  } catch (err) {
    logger.error('Failed to generate unavailable audio:', err)
  }
}
