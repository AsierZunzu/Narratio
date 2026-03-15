import { initDatabase } from '../src/database/db'

describe('Database', () => {
  let db: any

  beforeAll(() => {
    // Use in-memory database for tests
    db = initDatabase(':memory:')
  })

  afterAll(() => {
    db.close()
  })

  test('should create articles table on initialization', () => {
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='articles'").get()
    expect(table).toBeDefined()
    expect(table.name).toBe('articles')
  })

  test('should insert and retrieve an article', () => {
    const article = {
      id: 'test-db-1',
      title: 'Database Test',
      link: 'http://example.com/db-test',
      pub_date: '2023-01-01',
      content: 'Database test content'
    }

    const insert = db.prepare('INSERT INTO articles (id, title, link, pub_date, content) VALUES (?, ?, ?, ?, ?)')
    insert.run(article.id, article.title, article.link, article.pub_date, article.content)

    const select = db.prepare('SELECT * FROM articles WHERE id = ?')
    const result = select.get(article.id)

    expect(result).toBeDefined()
    expect(result.id).toBe(article.id)
    expect(result.title).toBe(article.title)
    expect(result.link).toBe(article.link)
    expect(result.pub_date).toBe(article.pub_date)
    expect(result.content).toBe(article.content)
  })

  test('should throw error on duplicate primary key', () => {
    const article = {
      id: 'duplicate-id',
      title: 'Title',
      link: 'link',
      pub_date: 'date',
      content: 'content'
    }

    const insert = db.prepare('INSERT INTO articles (id, title, link, pub_date, content) VALUES (?, ?, ?, ?, ?)')
    insert.run(article.id, article.title, article.link, article.pub_date, article.content)

    expect(() => {
      insert.run(article.id, article.title, article.link, article.pub_date, article.content)
    }).toThrow()
  })
})
