import { join } from 'path'
import { writeFileSync, existsSync, mkdirSync } from 'fs'
import { cleanupStorage } from './utils/storage'

const DATA_DIR = join(process.cwd(), 'data')
const AUDIO_DIR = join(DATA_DIR, 'audio')
const PIPER_URL = process.env.PIPER_URL || 'http://localhost:5000'

export async function textToAudio(id: string, text: string, customPath?: string): Promise<string> {
  if (!existsSync(AUDIO_DIR)) {
    mkdirSync(AUDIO_DIR, { recursive: true })
  }

  const audioPath = customPath || join(AUDIO_DIR, `${id}.wav`)
  
  // According to Piper's HTTP documentation, it takes a text query parameter
  // and returns the raw audio data.
  const response = await fetch(`${PIPER_URL}/?text=${encodeURIComponent(text)}`)

  if (!response.ok) {
    throw new Error(`TTS request failed: ${response.statusText}`)
  }

  const buffer = await response.arrayBuffer()
  writeFileSync(audioPath, Buffer.from(buffer))

  // Cleanup after writing new file, but only for regular articles
  if (!customPath) {
    try {
      cleanupStorage()
    } catch (err) {
      console.error('Storage cleanup failed:', err)
    }
  }

  return audioPath
}

export async function generateUnavailableAudio(): Promise<void> {
  const message = process.env.UNAVAILABLE_MESSAGE || 'This content is no longer available on the server.'
  const filePath = join(DATA_DIR, 'unavailable.wav')

  // Check if it already exists to avoid redundant generation
  // We could also check metadata if the message has changed
  try {
    console.log('Generating unavailable audio...')
    await textToAudio('unavailable', message, filePath)
    console.log(`Unavailable audio generated at: ${filePath}`)
  } catch (err) {
    console.error('Failed to generate unavailable audio:', err)
  }
}
