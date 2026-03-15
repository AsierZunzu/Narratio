import { parseRSSFeeds } from '../src/rss'
import Parser from 'rss-parser'

jest.mock('rss-parser')

describe('RSS Parsing', () => {
  let mockDb: any
  let mockParser: any

  beforeEach(() => {
    jest.clearAllMocks()
    mockDb = {
      prepare: jest.fn().mockReturnValue({
        run: jest.fn()
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
    expect(mockDb.prepare).toHaveBeenCalled()
    expect(mockDb.prepare().run).toHaveBeenCalledTimes(2)
    expect(mockDb.prepare().run).toHaveBeenCalledWith('1', 'Article 1', 'http://example.com/1', '2023-01-01', 'Content 1')
    expect(mockDb.prepare().run).toHaveBeenCalledWith('2', 'Article 2', 'http://example.com/2', '2023-01-02', 'Content 2')
  })

  test('should handle existing articles without crashing', async () => {
    const mockFeed = {
      title: 'Test Feed',
      items: [{ guid: '1', title: 'Article 1' }]
    }
    mockParser.parseURL.mockResolvedValue(mockFeed)
    
    const runMock = jest.fn().mockImplementation(() => {
      const err: any = new Error('Constraint failed')
      err.code = 'SQLITE_CONSTRAINT_PRIMARYKEY'
      throw err
    })
    mockDb.prepare.mockReturnValue({ run: runMock })

    await parseRSSFeeds(['http://test-feed.com'], mockDb, mockParser as any)

    expect(runMock).toHaveBeenCalled()
    // Should not throw
  })

  test('should log error when feed parsing fails', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation()
    mockParser.parseURL.mockRejectedValue(new Error('Parse error'))

    await parseRSSFeeds(['http://invalid-feed.com'], mockDb, mockParser as any)

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Error parsing feed from http://invalid-feed.com:'), expect.any(Error))
    consoleSpy.mockRestore()
  })
})
