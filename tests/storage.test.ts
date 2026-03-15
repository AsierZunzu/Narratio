import * as fs from 'fs'
import * as path from 'path'
import { cleanupStorage } from '../src/utils/storage'
import { db } from '../src/database/db'

jest.mock('../src/database/db', () => {
  const actualDb = jest.requireActual('../src/database/db')
  const mockDb = actualDb.initDatabase(':memory:')
  return {
    db: mockDb
  }
})

const AUDIO_DIR = path.join(process.cwd(), 'data', 'audio')

describe('Storage Cleanup', () => {
  beforeAll(() => {
    if (!fs.existsSync(AUDIO_DIR)) {
      fs.mkdirSync(AUDIO_DIR, { recursive: true })
    }
    // Setup initial database state
    db.exec('DELETE FROM articles')
  })

  afterAll(() => {
    // Cleanup files created during tests
    const files = fs.readdirSync(AUDIO_DIR)
    for (const file of files) {
      if (file.startsWith('test-')) {
        fs.unlinkSync(path.join(AUDIO_DIR, file))
      }
    }
  })

  beforeEach(() => {
    // Reset env variables
    delete process.env.MAX_AUDIO_FILES
    delete process.env.MAX_AUDIO_SIZE_MB
    
    // Clear directory of test files
    const files = fs.readdirSync(AUDIO_DIR)
    for (const file of files) {
      if (file.startsWith('test-')) {
        fs.unlinkSync(path.join(AUDIO_DIR, file))
      }
    }
    db.exec('DELETE FROM articles')
  })

  test('should not delete files if no limits are set', () => {
    const file1 = path.join(AUDIO_DIR, 'test-1.wav')
    fs.writeFileSync(file1, 'content')
    
    cleanupStorage()
    
    expect(fs.existsSync(file1)).toBe(true)
  })

  test('should delete oldest files when MAX_AUDIO_FILES is exceeded', () => {
    process.env.MAX_AUDIO_FILES = '2'
    
    const file1 = path.join(AUDIO_DIR, 'test-1.wav')
    const file2 = path.join(AUDIO_DIR, 'test-2.wav')
    const file3 = path.join(AUDIO_DIR, 'test-3.wav')
    
    // Create files with different mtimes
    fs.writeFileSync(file1, 'content1')
    db.prepare('INSERT INTO articles (id, title, link, pub_date, content, audio_path) VALUES (?,?,?,?,?,?)')
      .run('1', 'T1', 'L1', 'D1', 'C1', file1)
    
    // Wait a bit to ensure different mtime
    // Or manually change mtime if filesystem supports it well in tests
    const now = Date.now()
    fs.utimesSync(file1, new Date(now - 3000), new Date(now - 3000))

    fs.writeFileSync(file2, 'content2')
    db.prepare('INSERT INTO articles (id, title, link, pub_date, content, audio_path) VALUES (?,?,?,?,?,?)')
      .run('2', 'T2', 'L2', 'D2', 'C2', file2)
    fs.utimesSync(file2, new Date(now - 2000), new Date(now - 2000))

    fs.writeFileSync(file3, 'content3')
    db.prepare('INSERT INTO articles (id, title, link, pub_date, content, audio_path) VALUES (?,?,?,?,?,?)')
      .run('3', 'T3', 'L3', 'D3', 'C3', file3)
    fs.utimesSync(file3, new Date(now - 1000), new Date(now - 1000))

    cleanupStorage()
    
    expect(fs.existsSync(file1)).toBe(false)
    expect(fs.existsSync(file2)).toBe(true)
    expect(fs.existsSync(file3)).toBe(true)
    
    // Check database update
    const art1 = db.prepare("SELECT audio_path FROM articles WHERE id = '1'").get() as { audio_path: string | null }
    expect(art1.audio_path).toBeNull()
  })

  test('should delete oldest files when MAX_AUDIO_SIZE_MB is exceeded', () => {
    process.env.MAX_AUDIO_SIZE_MB = '0.000001' // Very small limit (~1 byte)
    
    const file1 = path.join(AUDIO_DIR, 'test-1.wav')
    const file2 = path.join(AUDIO_DIR, 'test-2.wav')
    
    fs.writeFileSync(file1, 'content with some length') // approx 20 bytes
    const now = Date.now()
    fs.utimesSync(file1, new Date(now - 2000), new Date(now - 2000))

    fs.writeFileSync(file2, 'short')
    fs.utimesSync(file2, new Date(now - 1000), new Date(now - 1000))

    cleanupStorage()
    
    // Since limit is ~1 byte, it should delete files until it's under or empty.
    // In our logic: if exceedsSize, break loop when NOT exceeding.
    // Actually our logic: if (!exceedsCount && !exceedsSize) break.
    // So if it's 20 bytes and limit is 1 byte, it deletes file1.
    // Remaining is file2 (5 bytes), still > 1 byte, so it deletes file2 too.
    
    expect(fs.existsSync(file1)).toBe(false)
    expect(fs.existsSync(file2)).toBe(false)
  })
})
