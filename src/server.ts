import express from 'express'
import { Podcast } from 'podcast'
import { join } from 'path'
import { db } from './database/db'
import { statSync } from 'fs'

const app = express()
const port = process.env.PORT || 3000
const DATA_DIR = join(process.cwd(), 'data')
const AUDIO_DIR = join(DATA_DIR, 'audio')

// Serve audio files
app.use('/audio', express.static(AUDIO_DIR))

interface Article {
  id: string;
  title: string;
  link: string;
  pub_date: string;
  content: string;
  audio_path: string;
}

app.get('/rss', (req, res) => {
  const feedUrl = `${req.protocol}://${req.get('host')}/rss`
  const siteUrl = `${req.protocol}://${req.get('host')}`

  const podcast = new Podcast({
    title: 'RSS to Podcast',
    description: 'Automatically generated podcast from RSS feeds',
    feedUrl: feedUrl,
    siteUrl: siteUrl,
    author: 'RSS to Podcast Worker',
    language: 'en',
    itunesAuthor: 'RSS to Podcast Worker',
    itunesSummary: 'Automatically generated podcast from RSS feeds',
    itunesOwner: { name: 'RSS to Podcast Worker', email: 'worker@example.com' },
    itunesCategory: [{ text: 'Technology' }],
  })

  const articles = db.prepare('SELECT * FROM articles WHERE audio_path IS NOT NULL ORDER BY pub_date DESC').all() as Article[]

  articles.forEach(article => {
    const audioFileName = article.audio_path.split(/[/\\]/).pop()
    const audioUrl = `${siteUrl}/audio/${audioFileName}`
    
    let fileSize = 0
    try {
      const stats = statSync(article.audio_path)
      fileSize = stats.size
    } catch (err) {
      console.warn(`Could not get file size for ${article.audio_path}:`, err)
    }

    podcast.addItem({
      title: article.title,
      description: article.content,
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

export function startServer() {
  return app.listen(port, () => {
    console.log(`Server started at http://localhost:${port}`)
    console.log(`Podcast RSS feed available at http://localhost:${port}/rss`)
  })
}

if (require.main === module) {
  startServer()
}
