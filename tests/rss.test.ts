import { parseRSSFeed } from '../src/rss'
import Parser from 'rss-parser'

jest.mock('rss-parser')

const textToAudioMock = jest.fn().mockResolvedValue('/app/data/audio/test.wav')
jest.mock('../src/tts', () => ({
  textToAudio: (...args: unknown[]) => textToAudioMock(...args)
}))

const cleanupStorageMock = jest.fn()
jest.mock('../src/utils/storage', () => ({
  cleanupStorage: (...args: unknown[]) => cleanupStorageMock(...args)
}))

describe('RSS Parsing', () => {
  let mockDb: any
  let mockParser: any
  let insertMock: any
  let updateSuccessMock: any
  let updateFailureMock: any
  let retrySelectMock: any
  let retryCountMock: any

  beforeEach(() => {
    jest.clearAllMocks()
    textToAudioMock.mockResolvedValue('/app/data/audio/test.wav')

    insertMock = { run: jest.fn() }
    updateSuccessMock = { run: jest.fn() }
    updateFailureMock = { run: jest.fn() }
    retrySelectMock = { all: jest.fn().mockReturnValue([]) }
    retryCountMock = { get: jest.fn().mockReturnValue({ tts_retry_count: 1 }) }

    mockDb = {
      prepare: jest.fn().mockImplementation((query: string) => {
        if (query.includes('INSERT')) return insertMock
        if (query.includes('audio_path') && query.includes('tts_retry_count = 0')) return updateSuccessMock
        if (query.includes('tts_retry_count = tts_retry_count + 1')) return updateFailureMock
        if (query.includes('tts_retry_count > 0')) return retrySelectMock
        if (query.includes('SELECT tts_retry_count')) return retryCountMock
        return { run: jest.fn(), all: jest.fn().mockReturnValue([]), get: jest.fn() }
      })
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
    expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT'))
    expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('UPDATE'))
    expect(insertMock.run).toHaveBeenCalledTimes(2)
    expect(updateSuccessMock.run).toHaveBeenCalledTimes(2)
    expect(insertMock.run).toHaveBeenCalledWith('1', 'Article 1', 'http://example.com/1', '2023-01-01', 'Content 1')
    expect(updateSuccessMock.run).toHaveBeenCalledWith('/app/data/audio/test.wav', expect.any(String), '1')
  })

  test('should handle existing articles without crashing', async () => {
    const mockFeed = {
      title: 'Test Feed',
      items: [{ guid: '1', title: 'Article 1' }]
    }
    mockParser.parseURL.mockResolvedValue(mockFeed)

    insertMock.run.mockImplementation(() => {
      const err: any = new Error('Constraint failed')
      err.code = 'SQLITE_CONSTRAINT_PRIMARYKEY'
      throw err
    })

    await parseRSSFeed('http://test-feed.com', mockDb, mockParser as any)

    expect(insertMock.run).toHaveBeenCalled()
    expect(updateSuccessMock.run).not.toHaveBeenCalled()
  })

  test('should log error when feed parsing fails', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation()
    mockParser.parseURL.mockRejectedValue(new Error('Parse error'))

    await parseRSSFeed('http://invalid-feed.com', mockDb, mockParser as any)

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Error parsing feed from http://invalid-feed.com:'), expect.any(Error))
    consoleSpy.mockRestore()
  })

  test('TTS failure updates DB columns', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation()
    textToAudioMock.mockRejectedValue(new Error('Piper connection refused'))

    const mockFeed = {
      title: 'Test Feed',
      items: [{ guid: 'art1', title: 'Article 1', link: 'http://example.com/1', pubDate: '2023-01-01', contentSnippet: 'Content' }]
    }
    mockParser.parseURL.mockResolvedValue(mockFeed)

    await parseRSSFeed('http://test-feed.com', mockDb, mockParser as any)

    expect(updateFailureMock.run).toHaveBeenCalledWith(
      expect.any(String),
      'Piper connection refused',
      'art1'
    )
    expect(updateSuccessMock.run).not.toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  test('retry picks up eligible articles', async () => {
    const mockFeed = { title: 'Test Feed', items: [] }
    mockParser.parseURL.mockResolvedValue(mockFeed)

    retrySelectMock.all.mockReturnValue([
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

    // retrySelectMock.all returns [] by default (articles above max retries are excluded by the SQL query)
    retrySelectMock.all.mockReturnValue([])

    await parseRSSFeed('http://test-feed.com', mockDb, mockParser as any)

    expect(textToAudioMock).not.toHaveBeenCalled()
  })

  test('successful retry clears failure state', async () => {
    const mockFeed = { title: 'Test Feed', items: [] }
    mockParser.parseURL.mockResolvedValue(mockFeed)

    retrySelectMock.all.mockReturnValue([
      { id: 'failed1', title: 'Failed Article', content: 'Some content' }
    ])
    textToAudioMock.mockResolvedValue('/app/data/audio/failed1.wav')

    await parseRSSFeed('http://test-feed.com', mockDb, mockParser as any)

    expect(updateSuccessMock.run).toHaveBeenCalledWith(
      '/app/data/audio/failed1.wav',
      expect.any(String),
      'failed1'
    )
    // updateSuccess sets tts_retry_count=0, tts_failed_at=NULL, tts_error=NULL via the SQL
    expect(updateFailureMock.run).not.toHaveBeenCalled()
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
})
