import { readdirSync, statSync, unlinkSync, existsSync } from 'fs'
import { join } from 'path'
import { db } from '../database/db'

const DATA_DIR = join(process.cwd(), 'data')
const AUDIO_DIR = join(DATA_DIR, 'audio')

export function cleanupStorage(): void {
  const MAX_FILES = process.env.MAX_AUDIO_FILES ? parseInt(process.env.MAX_AUDIO_FILES, 10) : Infinity
  const MAX_SIZE_MB = process.env.MAX_AUDIO_SIZE_MB ? parseFloat(process.env.MAX_AUDIO_SIZE_MB) : Infinity
  const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024

  if (!MAX_FILES && !MAX_SIZE_MB) return
  if (MAX_FILES === Infinity && MAX_SIZE_MB === Infinity) return

  if (!existsSync(AUDIO_DIR)) return

  const files = readdirSync(AUDIO_DIR)
    .filter(file => file.endsWith('.wav'))
    .map(file => {
      const filePath = join(AUDIO_DIR, file)
      const stats = statSync(filePath)
      return {
        name: file,
        path: filePath,
        size: stats.size,
        mtime: stats.mtimeMs
      }
    })
    .sort((a, b) => a.mtime - b.mtime) // Oldest first

  let currentCount = files.length
  let currentSize = files.reduce((sum, f) => sum + f.size, 0)

  const updateDb = db.prepare('UPDATE articles SET audio_path = NULL, processed_at = NULL, is_purged = 1 WHERE audio_path LIKE ?')

  for (const file of files) {
    const exceedsCount = currentCount > MAX_FILES
    const exceedsSize = currentSize > MAX_SIZE_BYTES

    if (!exceedsCount && !exceedsSize) break

    try {
      unlinkSync(file.path)
      // Update database - we search for the filename in the path
      // Since we know they are in AUDIO_DIR, it's safer to use the full path or just the name
      updateDb.run(`%${file.name}`)
      
      currentCount--
      currentSize -= file.size
      console.log(`- Storage cleanup: Removed oldest file ${file.name}`)
    } catch (err) {
      console.error(`- Storage cleanup: Failed to remove ${file.name}:`, err)
    }
  }
}
