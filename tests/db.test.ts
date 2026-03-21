import { PodcastDatabase } from '../src/database/db'

describe('PodcastDatabase', () => {
  let db: PodcastDatabase

  beforeAll(() => {
    db = new PodcastDatabase(':memory:')
  })

  afterAll(() => {
    db.close()
  })

  test('creates articles and metadata tables on initialization', () => {
    // If tables were not created the following calls would throw
    expect(() => db.getPublishedArticles()).not.toThrow()
    expect(() => db.getFeedUrl()).not.toThrow()
  })

  describe('metadata', () => {
    beforeEach(() => db.reset())

    test('getFeedUrl returns undefined when not set', () => {
      expect(db.getFeedUrl()).toBeUndefined()
    })

    test('setFeedUrl / getFeedUrl round-trips the value', () => {
      db.setFeedUrl('http://example.com/rss')
      expect(db.getFeedUrl()).toBe('http://example.com/rss')
    })

    test('getFeedImageUrl returns undefined when not set', () => {
      expect(db.getFeedImageUrl()).toBeUndefined()
    })

    test('setFeedImageUrl / getFeedImageUrl round-trips the value', () => {
      db.setFeedImageUrl('http://example.com/feed.jpg')
      expect(db.getFeedImageUrl()).toBe('http://example.com/feed.jpg')
    })

    test('setFeedImageUrl is idempotent (upsert)', () => {
      db.setFeedImageUrl('http://example.com/first.jpg')
      db.setFeedImageUrl('http://example.com/second.jpg')
      expect(db.getFeedImageUrl()).toBe('http://example.com/second.jpg')
    })
  })

  describe('articles — write / read', () => {
    beforeEach(() => db.reset())

    test('insertArticle stores and getPublishedArticles excludes it until audio is set', () => {
      db.insertArticle('a1', 'Title', 'http://example.com', '2024-01-01', 'Content', null)
      expect(db.getPublishedArticles()).toHaveLength(0)
    })

    test('markArticleAudioSuccess makes article appear in getPublishedArticles', () => {
      db.insertArticle('a1', 'Title', 'http://example.com', '2024-01-01', 'Content', null)
      db.markArticleAudioSuccess('a1', '/data/audio/a1.wav')
      const articles = db.getPublishedArticles()
      expect(articles).toHaveLength(1)
      expect(articles[0].audio_path).toBe('/data/audio/a1.wav')
    })

    test('markArticleAudioFailure increments retry count', () => {
      db.insertArticle('a1', 'Title', 'http://example.com', '2024-01-01', 'Content', null)
      db.markArticleAudioFailure('a1', 'connection refused')
      expect(db.getArticleRetryCount('a1')).toBe(1)
    })

    test('markArticleAudioSuccess resets retry count to 0', () => {
      db.insertArticle('a1', 'Title', 'http://example.com', '2024-01-01', 'Content', null)
      db.markArticleAudioFailure('a1', 'err')
      db.markArticleAudioSuccess('a1', '/data/audio/a1.wav')
      expect(db.getArticleRetryCount('a1')).toBe(0)
    })

    test('markArticlePurged sets is_purged=1 and appears in getPublishedArticles', () => {
      db.insertArticle('a1', 'Title', 'http://example.com', '2024-01-01', 'Content', null)
      db.markArticlePurged('a1')
      const articles = db.getPublishedArticles()
      expect(articles).toHaveLength(1)
      expect(articles[0].is_purged).toBe(1)
      expect(articles[0].audio_path).toBeNull()
    })

    test('getActiveAudioArticles returns only non-purged articles with audio', () => {
      db.insertArticle('a1', 'T1', 'L1', '2024-01-01', 'C', null, '/data/audio/a1.wav')
      db.insertArticle('a2', 'T2', 'L2', '2024-01-02', 'C', null)
      db.insertArticle('a3', 'T3', 'L3', '2024-01-03', 'C', null, '/data/audio/a3.wav')
      db.markArticlePurged('a3')
      const rows = db.getActiveAudioArticles()
      expect(rows).toHaveLength(1)
      expect(rows[0].id).toBe('a1')
    })

    test('getRetryEligibleArticles respects maxRetries bound', () => {
      db.insertArticle('a1', 'T1', 'L1', '2024-01-01', 'C', null)
      db.markArticleAudioFailure('a1', 'err') // retry_count = 1
      expect(db.getRetryEligibleArticles(3)).toHaveLength(1)
      db.markArticleAudioFailure('a1', 'err')
      db.markArticleAudioFailure('a1', 'err') // retry_count = 3 (== maxRetries, excluded)
      expect(db.getRetryEligibleArticles(3)).toHaveLength(0)
    })

    test('getArticle returns article data', () => {
      db.insertArticle('a1', 'Title', 'http://example.com', '2024-01-01', 'Content', null)
      const row = db.getArticle('a1')
      expect(row).toBeDefined()
      expect(row?.audio_path).toBeNull()
      expect(row?.is_purged).toBe(0)
    })

    test('insertArticle throws on duplicate id', () => {
      db.insertArticle('dup', 'T', 'L', 'D', 'C', null)
      expect(() => db.insertArticle('dup', 'T', 'L', 'D', 'C', null)).toThrow()
    })

    test('image_url is stored and returned', () => {
      db.insertArticle('a1', 'Title', 'L', '2024-01-01', 'C', 'http://example.com/img.jpg')
      db.markArticleAudioSuccess('a1', '/data/audio/a1.wav')
      const articles = db.getPublishedArticles()
      expect(articles[0].image_url).toBe('http://example.com/img.jpg')
    })
  })

  describe('reset', () => {
    beforeEach(() => db.reset())

    test('clears all articles and metadata', () => {
      db.setFeedUrl('http://example.com/rss')
      db.insertArticle('a1', 'T', 'L', 'D', 'C', null)
      db.reset()
      expect(db.getFeedUrl()).toBeUndefined()
      expect(db.getPublishedArticles()).toHaveLength(0)
    })
  })
})
