import { parseRSSFeeds } from '../src/rss'
import Parser from 'rss-parser'

jest.mock('rss-parser')
jest.mock('../src/tts', () => ({
  textToAudio: jest.fn().mockResolvedValue('/app/data/audio/test.wav')
}))

describe('RSS Parsing', () => {
  let mockDb: any
  let mockParser: any
  let insertMock: any
  let updateMock: any

  beforeEach(() => {
    jest.clearAllMocks()
    insertMock = { run: jest.fn() }
    updateMock = { run: jest.fn() }
    mockDb = {
      prepare: jest.fn().mockImplementation((query) => {
        if (query.includes('INSERT')) return insertMock
        if (query.includes('UPDATE')) return updateMock
        return { run: jest.fn() }
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

    await parseRSSFeeds(['http://test-feed.com'], mockDb, mockParser as any)

    expect(mockParser.parseURL).toHaveBeenCalledWith('http://test-feed.com')
    expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT'))
    expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('UPDATE'))
    expect(insertMock.run).toHaveBeenCalledTimes(2)
    expect(updateMock.run).toHaveBeenCalledTimes(2)
    expect(insertMock.run).toHaveBeenCalledWith('1', 'Article 1', 'http://example.com/1', '2023-01-01', 'Content 1')
    expect(updateMock.run).toHaveBeenCalledWith('/app/data/audio/test.wav', expect.any(String), '1')
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

    await parseRSSFeeds(['http://test-feed.com'], mockDb, mockParser as any)

    expect(insertMock.run).toHaveBeenCalled()
    expect(updateMock.run).not.toHaveBeenCalled()
  })

  test('should log error when feed parsing fails', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation()
    mockParser.parseURL.mockRejectedValue(new Error('Parse error'))

    await parseRSSFeeds(['http://invalid-feed.com'], mockDb, mockParser as any)

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Error parsing feed from http://invalid-feed.com:'), expect.any(Error))
    consoleSpy.mockRestore()
  })
})
