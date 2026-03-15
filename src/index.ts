import { db } from './database/db'

interface Article {
  id: string;
  title: string;
  link: string;
  pub_date: string;
  content: string;
}

function testDatabase() {
  const insert = db.prepare('INSERT INTO articles (id, title, link, pub_date, content) VALUES (?, ?, ?, ?, ?)')
  const select = db.prepare('SELECT * FROM articles WHERE id = ?')

  const testArticle: Article = {
    id: 'test-1',
    title: 'Test Article',
    link: 'https://example.com/test-1',
    pub_date: new Date().toISOString(),
    content: 'This is a test article content.'
  }

  try {
    insert.run(testArticle.id, testArticle.title, testArticle.link, testArticle.pub_date, testArticle.content)
    console.log('Inserted test article')
  } catch (err) {
    if (err instanceof Error && (err as { code?: string }).code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
      console.log('Test article already exists')
    } else {
      throw err
    }
  }

  const result = select.get(testArticle.id) as Article & { audio_path: string | null, processed_at: string | null, created_at: string }
  console.log('Selected article:', result)
}

testDatabase()
