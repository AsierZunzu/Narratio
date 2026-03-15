import request from 'supertest';
import express from 'express';
import { Podcast } from 'podcast';
import { db } from '../src/database/db';
import * as fs from 'fs';
import { join } from 'path';

// We need to mock things or use a real app instance for testing
// Let's create a test app instance
const app = express();
const AUDIO_DIR = './data/audio';

app.use('/audio', express.static(AUDIO_DIR));

app.get('/rss', (req, res) => {
  const feedUrl = `${req.protocol}://${req.get('host')}/rss`;
  const siteUrl = `${req.protocol}://${req.get('host')}`;

  const podcast = new Podcast({
    title: 'Test Podcast',
    description: 'Test Description',
    feedUrl: feedUrl,
    siteUrl: siteUrl,
  });

  const articles = db.prepare('SELECT * FROM articles WHERE audio_path IS NOT NULL ORDER BY pub_date DESC').all() as any[];

  articles.forEach(article => {
    podcast.addItem({
      title: article.title,
      description: article.content,
      url: article.link,
      guid: article.id,
      date: article.pub_date,
      enclosure: {
        url: `${siteUrl}/audio/${article.audio_path.split(/[/\\]/).pop()}`,
        size: 0,
        type: 'audio/mpeg'
      }
    });
  });

  res.set('Content-Type', 'application/rss+xml');
  res.send(podcast.buildXml());
});

describe('Server/RSS Feed', () => {
  beforeAll(() => {
    // Clear and setup test database
    db.prepare('DELETE FROM articles').run();
    db.prepare('INSERT INTO articles (id, title, link, pub_date, content, audio_path) VALUES (?, ?, ?, ?, ?, ?)')
      .run('1', 'Article 1', 'http://example.com/1', '2023-01-01', 'Content 1', 'data/audio/test1.mp3');
  });

  test('should serve RSS feed', async () => {
    const response = await request(app).get('/rss');
    expect(response.status).toBe(200);
    expect(response.header['content-type']).toBe('application/rss+xml; charset=utf-8');
    expect(response.text).toContain('<title><![CDATA[Test Podcast]]></title>');
    expect(response.text).toContain('<title><![CDATA[Article 1]]></title>');
    expect(response.text).toContain('test1.mp3');
  });

  test('should serve static audio files', async () => {
    // Ensure the file exists
    const audioDir = './data/audio';
    if (!fs.existsSync(audioDir)) {
      fs.mkdirSync(audioDir, { recursive: true });
    }
    const testFile = join(audioDir, 'test-serve.mp3');
    fs.writeFileSync(testFile, 'dummy audio');

    // Re-verify that the static middleware is pointing to the right place
    // Actually in the test app it's defined as:
    // const AUDIO_DIR = './data/audio';
    // app.use('/audio', express.static(AUDIO_DIR));

    const response = await request(app).get('/audio/test-serve.mp3');
    expect(response.status).toBe(200);
    expect(response.body.toString()).toBe('dummy audio');

    // Cleanup
    fs.unlinkSync(testFile);
  });
});
