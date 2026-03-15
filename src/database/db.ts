import Database from 'better-sqlite3'
import { join, dirname } from 'path'
import { existsSync, mkdirSync } from 'fs'

const DATA_DIR = join(process.cwd(), 'data')
const DB_PATH = join(DATA_DIR, 'podcast.db')

export function initDatabase(path: string = DB_PATH) {
  const dir = dirname(path)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  const db = new Database(path)

  // Enable WAL mode for better performance
  db.pragma('journal_mode = WAL')

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS articles (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      link TEXT NOT NULL,
      pub_date TEXT NOT NULL,
      content TEXT NOT NULL,
      audio_path TEXT,
      processed_at TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `)

  return db
}

export function resetDatabase(dbInstance: Database.Database = db) {
  dbInstance.exec('DELETE FROM articles')
  dbInstance.exec('DELETE FROM metadata')
}

export const db = initDatabase()
