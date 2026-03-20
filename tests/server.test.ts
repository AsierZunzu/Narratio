import request from 'supertest'

jest.mock('../src/database/db', () => ({
  db: { prepare: jest.fn() }
}))

jest.mock('../src/tts', () => ({
  textToAudio: jest.fn().mockResolvedValue('/app/data/audio/unavailable.wav')
}))

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  statSync: jest.fn().mockReturnValue({ size: 12345 }),
  existsSync: jest.fn().mockReturnValue(true),
}))

import { app, startServer } from '../src/server'
import { db } from '../src/database/db'
import { textToAudio } from '../src/tts'
import * as fs from 'fs'

const mockPrepare = db.prepare as jest.Mock
const mockTextToAudio = textToAudio as jest.Mock

function setupDb(articles: object[], feedUrl?: string) {
  mockPrepare.mockImplementation((query: string) => {
    if (query.includes('metadata')) {
      return { get: jest.fn().mockReturnValue(feedUrl ? { value: feedUrl } : undefined) }
    }
    return { all: jest.fn().mockReturnValue(articles) }
  })
}

describe('GET /rss', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fs.statSync as jest.Mock).mockReturnValue({ size: 12345 });
    (fs.existsSync as jest.Mock).mockReturnValue(true)
    delete process.env['PODCAST_TITLE']
    delete process.env['PODCAST_DESCRIPTION']
    delete process.env['PODCAST_AUTHOR']
  })

  test('returns 200 with rss+xml content type', async () => {
    setupDb([])
    const res = await request(app).get('/rss')
    expect(res.status).toBe(200)
    expect(res.header['content-type']).toContain('application/rss+xml')
  })

  test('uses default title when PODCAST_TITLE is not set', async () => {
    setupDb([])
    const res = await request(app).get('/rss')
    expect(res.text).toContain('<title><![CDATA[RSS to Podcast]]></title>')
  })

  test('uses PODCAST_TITLE env var when set', async () => {
    process.env['PODCAST_TITLE'] = 'My Custom Podcast'
    setupDb([])
    const res = await request(app).get('/rss')
    expect(res.text).toContain('<title><![CDATA[My Custom Podcast]]></title>')
  })

  test('uses feed_url from metadata for default description', async () => {
    setupDb([], 'http://myfeed.com/rss')
    const res = await request(app).get('/rss')
    expect(res.text).toContain('http://myfeed.com/rss')
  })

  test('includes normal article with correct title, audio URL, and file size', async () => {
    setupDb([{
      id: '1', title: 'Article 1', link: 'http://example.com/1',
      pub_date: '2023-01-01', content: 'Content 1',
      audio_path: '/app/data/audio/article1.wav', is_purged: 0
    }])
    const res = await request(app).get('/rss')
    expect(res.text).toContain('<title><![CDATA[Article 1]]></title>')
    expect(res.text).toContain('article1.wav')
    expect(res.text).toContain('length="12345"')
    expect(res.text).not.toContain('[PURGED]')
    expect(fs.statSync).toHaveBeenCalledWith('/app/data/audio/article1.wav')
  })

  test('purged article gets [PURGED] title, unavailable description, and unavailable.wav URL', async () => {
    setupDb([{
      id: '2', title: 'Article 2', link: 'http://example.com/2',
      pub_date: '2023-01-02', content: 'Content 2',
      audio_path: null, is_purged: 1
    }])
    const res = await request(app).get('/rss')
    expect(res.text).toContain('[PURGED] Article 2')
    expect(res.text).toContain('Original audio is no longer available.')
    expect(res.text).toContain('unavailable.wav')
  })

  test('returns empty feed when no articles exist', async () => {
    setupDb([])
    const res = await request(app).get('/rss')
    expect(res.status).toBe(200)
    expect(res.text).toContain('<channel>')
    expect(res.text).not.toContain('<item>')
  })

  test('logs warning and uses fileSize 0 when statSync throws for purged article', async () => {
    (fs.statSync as jest.Mock).mockImplementation(() => { throw new Error('stat failed') })
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
    setupDb([{ id: '1', title: 'Purged', link: 'L', pub_date: 'D', content: 'C', audio_path: null, is_purged: 1 }])
    const res = await request(app).get('/rss')
    expect(res.status).toBe(200)
    expect(warnSpy).toHaveBeenCalledWith('Could not get size for unavailable.wav:', expect.any(Error))
    warnSpy.mockRestore()
  })

  test('logs warning and uses fileSize 0 when statSync throws for normal article', async () => {
    (fs.statSync as jest.Mock).mockImplementation(() => { throw new Error('stat failed') })
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
    setupDb([{ id: '1', title: 'Article', link: 'L', pub_date: 'D', content: 'C', audio_path: '/data/audio/article.wav', is_purged: 0 }])
    const res = await request(app).get('/rss')
    expect(res.status).toBe(200)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Could not get file size for /data/audio/article.wav'),
      expect.any(Error)
    )
    warnSpy.mockRestore()
  })
})

describe('startServer', () => {
  let listenSpy: jest.SpyInstance

  beforeEach(() => {
    listenSpy = jest.spyOn(app, 'listen').mockImplementation((_port: any, cb?: any) => {
      if (typeof cb === 'function') cb()
      return { close: jest.fn() } as any
    })
    jest.spyOn(console, 'log').mockImplementation()
    jest.spyOn(console, 'error').mockImplementation()
    mockTextToAudio.mockResolvedValue('/app/data/audio/unavailable.wav')
  })

  afterEach(() => {
    jest.restoreAllMocks()
    delete process.env['UNAVAILABLE_MESSAGE']
  })

  test('does not call textToAudio when unavailable.wav already exists', async () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true)
    await startServer()
    expect(mockTextToAudio).not.toHaveBeenCalled()
    expect(listenSpy).toHaveBeenCalled()
  })

  test('calls textToAudio to generate unavailable.wav when file is missing', async () => {
    (fs.existsSync as jest.Mock).mockReturnValue(false)
    await startServer()
    expect(mockTextToAudio).toHaveBeenCalledWith(
      'unavailable',
      expect.any(String),
      expect.stringContaining('unavailable.wav')
    )
    expect(listenSpy).toHaveBeenCalled()
  })

  test('uses UNAVAILABLE_MESSAGE env var when generating audio', async () => {
    process.env['UNAVAILABLE_MESSAGE'] = 'Custom unavailable message'
    ;(fs.existsSync as jest.Mock).mockReturnValue(false)
    await startServer()
    expect(mockTextToAudio).toHaveBeenCalledWith(
      'unavailable',
      'Custom unavailable message',
      expect.any(String)
    )
  })

  test('logs error but still starts server when unavailable audio generation fails', async () => {
    (fs.existsSync as jest.Mock).mockReturnValue(false)
    mockTextToAudio.mockRejectedValueOnce(new Error('TTS connection refused'))
    const errorSpy = jest.spyOn(console, 'error').mockImplementation()
    await startServer()
    expect(errorSpy).toHaveBeenCalledWith('Failed to generate unavailable audio:', expect.any(Error))
    expect(listenSpy).toHaveBeenCalled()
  })
})
