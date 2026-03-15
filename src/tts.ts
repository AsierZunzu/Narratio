import { join } from 'path'
import { writeFileSync, existsSync, mkdirSync } from 'fs'
import { cleanupStorage } from './utils/storage'

const AUDIO_DIR = join(process.cwd(), 'data', 'audio')
const PIPER_URL = process.env.PIPER_URL || 'http://localhost:5000'

export async function textToAudio(id: string, text: string): Promise<string> {
  if (!existsSync(AUDIO_DIR)) {
    mkdirSync(AUDIO_DIR, { recursive: true })
  }

  const audioPath = join(AUDIO_DIR, `${id}.wav`)
  
  // According to Piper's HTTP documentation, it takes a text query parameter
  // and returns the raw audio data.
  const response = await fetch(`${PIPER_URL}/?text=${encodeURIComponent(text)}`)

  if (!response.ok) {
    throw new Error(`TTS request failed: ${response.statusText}`)
  }

  const buffer = await response.arrayBuffer()
  writeFileSync(audioPath, Buffer.from(buffer))

  // Cleanup after writing new file
  try {
    cleanupStorage()
  } catch (err) {
    console.error('Storage cleanup failed:', err)
  }

  return audioPath
}
