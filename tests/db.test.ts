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

  test('should create articles and metadata tables on initialization', () => {
    const articlesTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='articles'").get()
    expect(articlesTable).toBeDefined()
    expect(articlesTable.name).toBe('articles')

    const metadataTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='metadata'").get()
    expect(metadataTable).toBeDefined()
    expect(metadataTable.name).toBe('metadata')
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

  test('should reset the database', () => {
    const { resetDatabase } = require('../src/database/db')
    
    // Clear first to ensure clean state
    resetDatabase(db)
    
    // Insert some data
    db.prepare("INSERT INTO metadata (key, value) VALUES ('test', 'value')").run()
    db.prepare("INSERT INTO articles (id, title, link, pub_date, content) VALUES ('id', 't', 'l', 'd', 'c')").run()
    
    expect(db.prepare("SELECT count(*) as count FROM metadata").get().count).toBe(1)
    expect(db.prepare("SELECT count(*) as count FROM articles").get().count).toBe(1)
    
    resetDatabase(db)
    
    expect(db.prepare("SELECT count(*) as count FROM metadata").get().count).toBe(0)
    expect(db.prepare("SELECT count(*) as count FROM articles").get().count).toBe(0)
  })
})
