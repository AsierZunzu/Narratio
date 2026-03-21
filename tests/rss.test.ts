import { parseRSSFeed } from '../src/services/rss'
import Parser from 'rss-parser'

jest.mock('rss-parser')

const textToAudioMock = jest.fn().mockResolvedValue('/app/data/audio/test.wav')
jest.mock('../src/services/tts', () => ({
  textToAudio: (...args: unknown[]) => textToAudioMock(...args)
}))

const cleanupStorageMock = jest.fn()
jest.mock('../src/utils/storage', () => ({
  cleanupStorage: (...args: unknown[]) => cleanupStorageMock(...args)
}))

describe('RSS Parsing', () => {
  let mockDb: any
  let mockParser: any

  beforeEach(() => {
    jest.clearAllMocks()
    textToAudioMock.mockResolvedValue('/app/data/audio/test.wav')

    mockDb = {
      setFeedImageUrl: jest.fn(),
      insertArticle: jest.fn(),
      markArticleAudioSuccess: jest.fn(),
      markArticleAudioFailure: jest.fn(),
      getRetryEligibleArticles: jest.fn().mockReturnValue([]),
      getArticleRetryCount: jest.fn().mockReturnValue(1),
    }
    mockParser = {
      parseURL: jest.fn()
    }
  })

  test('should parse RSS feed and insert items into database', async () => {
    const mockFeed = {
      title: 'Test Feed',
      items: [
        {
          guid: '1',
          title: 'Article 1',
          link: 'http://example.com/1',
          pubDate: '2023-01-01',
          contentSnippet: 'Content 1'
        },
        {
          guid: '2',
          title: 'Article 2',
          link: 'http://example.com/2',
          pubDate: '2023-01-02',
          content: 'Content 2'
        }
      ]
    }

    mockParser.parseURL.mockResolvedValue(mockFeed)

    await parseRSSFeed('http://test-feed.com', mockDb, mockParser as any)

    expect(mockParser.parseURL).toHaveBeenCalledWith('http://test-feed.com')
    expect(mockDb.insertArticle).toHaveBeenCalledTimes(2)
    expect(mockDb.markArticleAudioSuccess).toHaveBeenCalledTimes(2)
    expect(mockDb.insertArticle).toHaveBeenCalledWith('1', 'Article 1', 'http://example.com/1', '2023-01-01T00:00:00.000Z', 'Content 1', null)
    expect(mockDb.markArticleAudioSuccess).toHaveBeenCalledWith('1', '/app/data/audio/test.wav')
  })

  test('should handle existing articles without crashing', async () => {
    const mockFeed = {
      title: 'Test Feed',
      items: [{ guid: '1', title: 'Article 1' }]
    }
    mockParser.parseURL.mockResolvedValue(mockFeed)

    mockDb.insertArticle.mockImplementation(() => {
      const err: any = new Error('Constraint failed')
      err.code = 'SQLITE_CONSTRAINT_PRIMARYKEY'
      throw err
    })

    await parseRSSFeed('http://test-feed.com', mockDb, mockParser as any)

    expect(mockDb.insertArticle).toHaveBeenCalled()
    expect(mockDb.markArticleAudioSuccess).not.toHaveBeenCalled()
  })

  test('should log error when feed parsing fails', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation()
    mockParser.parseURL.mockRejectedValue(new Error('Parse error'))

    await parseRSSFeed('http://invalid-feed.com', mockDb, mockParser as any)

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Error parsing feed from http://invalid-feed.com:'), expect.any(Error))
    consoleSpy.mockRestore()
  })

  test('TTS failure calls markArticleAudioFailure', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation()
    textToAudioMock.mockRejectedValue(new Error('Piper connection refused'))

    const mockFeed = {
      title: 'Test Feed',
      items: [{ guid: 'art1', title: 'Article 1', link: 'http://example.com/1', pubDate: '2023-01-01', contentSnippet: 'Content' }]
    }
    mockParser.parseURL.mockResolvedValue(mockFeed)

    await parseRSSFeed('http://test-feed.com', mockDb, mockParser as any)

    expect(mockDb.markArticleAudioFailure).toHaveBeenCalledWith('art1', 'Piper connection refused')
    expect(mockDb.markArticleAudioSuccess).not.toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  test('retry picks up eligible articles', async () => {
    const mockFeed = { title: 'Test Feed', items: [] }
    mockParser.parseURL.mockResolvedValue(mockFeed)

    mockDb.getRetryEligibleArticles.mockReturnValue([
      { id: 'failed1', title: 'Failed Article', content: 'Some content' }
    ])

    await parseRSSFeed('http://test-feed.com', mockDb, mockParser as any)

    expect(textToAudioMock).toHaveBeenCalledWith(
      expect.stringMatching(/failed1/i),
      expect.stringContaining('Some content')
    )
  })

  test('retry respects TTS_MAX_RETRIES', async () => {
    const mockFeed = { title: 'Test Feed', items: [] }
    mockParser.parseURL.mockResolvedValue(mockFeed)

    mockDb.getRetryEligibleArticles.mockReturnValue([])

    await parseRSSFeed('http://test-feed.com', mockDb, mockParser as any)

    expect(textToAudioMock).not.toHaveBeenCalled()
  })

  test('successful retry calls markArticleAudioSuccess', async () => {
    const mockFeed = { title: 'Test Feed', items: [] }
    mockParser.parseURL.mockResolvedValue(mockFeed)

    mockDb.getRetryEligibleArticles.mockReturnValue([
      { id: 'failed1', title: 'Failed Article', content: 'Some content' }
    ])
    textToAudioMock.mockResolvedValue('/app/data/audio/failed1.wav')

    await parseRSSFeed('http://test-feed.com', mockDb, mockParser as any)

    expect(mockDb.markArticleAudioSuccess).toHaveBeenCalledWith('failed1', '/app/data/audio/failed1.wav')
    expect(mockDb.markArticleAudioFailure).not.toHaveBeenCalled()
  })

  test('should skip articles with no identifiable ID', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation()
    const mockFeed = {
      title: 'Test Feed',
      items: [
        { guid: undefined, link: undefined, title: undefined }, // all falsy
        { guid: 'valid', title: 'Valid Article', contentSnippet: 'Content' }
      ]
    }
    mockParser.parseURL.mockResolvedValue(mockFeed)

    await parseRSSFeed('http://test-feed.com', mockDb, mockParser as any)

    expect(mockDb.insertArticle).toHaveBeenCalledTimes(1)
    expect(mockDb.insertArticle).toHaveBeenCalledWith('valid', expect.any(String), expect.any(String), expect.any(String), expect.any(String), null)
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Skipping article with no identifiable ID'))
    consoleSpy.mockRestore()
  })

  test('should timeout if RSS feed fetch exceeds RSS_FETCH_TIMEOUT', async () => {
    jest.useFakeTimers()
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation()
    mockParser.parseURL.mockReturnValue(new Promise(() => {})) // never resolves

    const parsePromise = parseRSSFeed('http://test-feed.com', mockDb, mockParser as any)
    jest.runAllTimers()
    await parsePromise

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Error parsing feed from http://test-feed.com:'),
      expect.objectContaining({ message: expect.stringContaining('timed out') })
    )
    consoleSpy.mockRestore()
    jest.useRealTimers()
  })

  test('should call cleanupStorage after processing feed', async () => {
    const mockFeed = { title: 'Test Feed', items: [] }
    mockParser.parseURL.mockResolvedValue(mockFeed)

    await parseRSSFeed('http://test-feed.com', mockDb, mockParser as any)

    expect(cleanupStorageMock).toHaveBeenCalledTimes(1)
  })

  test('stores feed image URL when present', async () => {
    const mockFeed = {
      title: 'Test Feed',
      image: { url: 'http://example.com/feed.jpg', link: '', title: '' },
      items: []
    }
    mockParser.parseURL.mockResolvedValue(mockFeed)

    await parseRSSFeed('http://test-feed.com', mockDb, mockParser as any)

    expect(mockDb.setFeedImageUrl).toHaveBeenCalledWith('http://example.com/feed.jpg')
  })

  test('does not store feed image when absent', async () => {
    const mockFeed = { title: 'Test Feed', items: [] }
    mockParser.parseURL.mockResolvedValue(mockFeed)

    await parseRSSFeed('http://test-feed.com', mockDb, mockParser as any)

    expect(mockDb.setFeedImageUrl).not.toHaveBeenCalled()
  })

  test('stores article image from itunes:image', async () => {
    const mockFeed = {
      title: 'Test Feed',
      items: [{
        guid: '1', title: 'Article', link: 'http://example.com/1',
        pubDate: '2023-01-01', contentSnippet: 'Content',
        itunes: { image: 'http://example.com/article.jpg' }
      }]
    }
    mockParser.parseURL.mockResolvedValue(mockFeed)

    await parseRSSFeed('http://test-feed.com', mockDb, mockParser as any)

    expect(mockDb.insertArticle).toHaveBeenCalledWith(
      '1', 'Article', 'http://example.com/1', '2023-01-01T00:00:00.000Z', 'Content', 'http://example.com/article.jpg'
    )
  })

  test('stores article image extracted from HTML content', async () => {
    const mockFeed = {
      title: 'Test Feed',
      items: [{
        guid: '2', title: 'Article', link: 'http://example.com/2',
        pubDate: '2023-01-01',
        contentEncoded: '<p>Text</p><img src="http://example.com/img.jpg" />'
      }]
    }
    mockParser.parseURL.mockResolvedValue(mockFeed)

    await parseRSSFeed('http://test-feed.com', mockDb, mockParser as any)

    expect(mockDb.insertArticle).toHaveBeenCalledWith(
      '2', 'Article', 'http://example.com/2', '2023-01-01T00:00:00.000Z', expect.any(String), 'http://example.com/img.jpg'
    )
  })

  test('stores null image_url when no image is found', async () => {
    const mockFeed = {
      title: 'Test Feed',
      items: [{ guid: '3', title: 'Article', link: 'http://example.com/3', pubDate: '2023-01-01', contentSnippet: 'No images here' }]
    }
    mockParser.parseURL.mockResolvedValue(mockFeed)

    await parseRSSFeed('http://test-feed.com', mockDb, mockParser as any)

    expect(mockDb.insertArticle).toHaveBeenCalledWith('3', 'Article', 'http://example.com/3', '2023-01-01T00:00:00.000Z', 'No images here', null)
  })
})
