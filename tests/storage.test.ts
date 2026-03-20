import * as fs from 'fs'
import * as path from 'path'
import { cleanupStorage, deleteAllAudioFiles } from '../src/utils/storage'
import { db } from '../src/database/db'

jest.mock('../src/database/db', () => {
  const actualDb = jest.requireActual('../src/database/db')
  const mockDb = actualDb.initDatabase(':memory:')
  return {
    db: mockDb
  }
})

const AUDIO_DIR = path.join(process.cwd(), 'data', 'audio')

describe('deleteAllAudioFiles', () => {
  beforeAll(() => {
    if (!fs.existsSync(AUDIO_DIR)) {
      fs.mkdirSync(AUDIO_DIR, { recursive: true })
    }
  })

  afterEach(() => {
    const files = fs.readdirSync(AUDIO_DIR)
    for (const file of files) {
      if (file.startsWith('test-')) {
        fs.unlinkSync(path.join(AUDIO_DIR, file))
      }
    }
  })

  test('should delete all wav files in the audio directory', () => {
    const file1 = path.join(AUDIO_DIR, 'test-a.wav')
    const file2 = path.join(AUDIO_DIR, 'test-b.wav')
    fs.writeFileSync(file1, 'data')
    fs.writeFileSync(file2, 'data')

    deleteAllAudioFiles()

    expect(fs.existsSync(file1)).toBe(false)
    expect(fs.existsSync(file2)).toBe(false)
  })

  test('should do nothing if audio directory does not exist', () => {
    // Should not throw
    expect(() => deleteAllAudioFiles()).not.toThrow()
  })
})

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
    db.prepare('INSERT INTO articles (id, title, link, pub_date, content, audio_path) VALUES (?,?,?,?,?,?)')
      .run('1', 'T1', 'L1', 'Mon, 01 Jan 2024 00:00:00 GMT', 'C1', file1)

    cleanupStorage()

    expect(fs.existsSync(file1)).toBe(true)
  })

  test('should delete oldest files by pub_date when MAX_AUDIO_FILES is exceeded', () => {
    process.env.MAX_AUDIO_FILES = '2'

    const file1 = path.join(AUDIO_DIR, 'test-1.wav')
    const file2 = path.join(AUDIO_DIR, 'test-2.wav')
    const file3 = path.join(AUDIO_DIR, 'test-3.wav')

    fs.writeFileSync(file1, 'content1')
    db.prepare('INSERT INTO articles (id, title, link, pub_date, content, audio_path) VALUES (?,?,?,?,?,?)')
      .run('1', 'T1', 'L1', 'Mon, 01 Jan 2024 00:00:00 GMT', 'C1', file1)

    fs.writeFileSync(file2, 'content2')
    db.prepare('INSERT INTO articles (id, title, link, pub_date, content, audio_path) VALUES (?,?,?,?,?,?)')
      .run('2', 'T2', 'L2', 'Wed, 01 Jan 2025 00:00:00 GMT', 'C2', file2)

    fs.writeFileSync(file3, 'content3')
    db.prepare('INSERT INTO articles (id, title, link, pub_date, content, audio_path) VALUES (?,?,?,?,?,?)')
      .run('3', 'T3', 'L3', 'Thu, 01 Jan 2026 00:00:00 GMT', 'C3', file3)

    cleanupStorage()

    // file1 is oldest by pub_date and should be deleted
    expect(fs.existsSync(file1)).toBe(false)
    expect(fs.existsSync(file2)).toBe(true)
    expect(fs.existsSync(file3)).toBe(true)

    const art1 = db.prepare("SELECT audio_path, is_purged FROM articles WHERE id = '1'").get() as { audio_path: string | null, is_purged: number }
    expect(art1.audio_path).toBeNull()
    expect(art1.is_purged).toBe(1)
  })

  test('should delete oldest files by pub_date when MAX_AUDIO_SIZE_MB is exceeded', () => {
    process.env.MAX_AUDIO_SIZE_MB = '0.000001' // Very small limit (~1 byte)

    const file1 = path.join(AUDIO_DIR, 'test-1.wav')
    const file2 = path.join(AUDIO_DIR, 'test-2.wav')

    fs.writeFileSync(file1, 'content with some length') // approx 24 bytes, older
    db.prepare('INSERT INTO articles (id, title, link, pub_date, content, audio_path) VALUES (?,?,?,?,?,?)')
      .run('1', 'T1', 'L1', 'Mon, 01 Jan 2024 00:00:00 GMT', 'C1', file1)

    fs.writeFileSync(file2, 'short') // newer
    db.prepare('INSERT INTO articles (id, title, link, pub_date, content, audio_path) VALUES (?,?,?,?,?,?)')
      .run('2', 'T2', 'L2', 'Wed, 01 Jan 2025 00:00:00 GMT', 'C2', file2)

    cleanupStorage()

    // Both exceed the tiny limit, so both get deleted
    expect(fs.existsSync(file1)).toBe(false)
    expect(fs.existsSync(file2)).toBe(false)
  })
})
