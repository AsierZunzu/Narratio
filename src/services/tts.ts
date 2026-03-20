import { join } from 'path'
import { writeFileSync, existsSync, mkdirSync } from 'fs'
import { Socket } from 'net'
import { createLogger } from '../utils/logger'

const logger = createLogger('TTS')

const DATA_DIR = join(process.cwd(), 'data')
const AUDIO_DIR = join(DATA_DIR, 'audio')
const PIPER_HOST: string = process.env['PIPER_HOST'] ?? 'localhost'
const PIPER_PORT: number = parseInt(process.env['PIPER_PORT'] ?? '10200')
const TIMEOUT_MS: number = parseInt(process.env['TTS_TIMEOUT'] ?? '300') * 1000

function buildWav(pcmData: Buffer, sampleRate: number, sampleWidth: number, channels: number): Buffer {
  const byteRate = sampleRate * channels * sampleWidth
  const blockAlign = channels * sampleWidth
  const dataSize = pcmData.length
  const header = Buffer.alloc(44)

  header.write('RIFF', 0)                        // ChunkID
  header.writeUInt32LE(36 + dataSize, 4)         // ChunkSize
  header.write('WAVE', 8)                        // Format
  header.write('fmt ', 12)                       // Subchunk1ID
  header.writeUInt32LE(16, 16)                   // Subchunk1Size (PCM)
  header.writeUInt16LE(1, 20)                    // AudioFormat (PCM = 1)
  header.writeUInt16LE(channels, 22)             // NumChannels
  header.writeUInt32LE(sampleRate, 24)           // SampleRate
  header.writeUInt32LE(byteRate, 28)             // ByteRate
  header.writeUInt16LE(blockAlign, 32)           // BlockAlign
  header.writeUInt16LE(sampleWidth * 8, 34)      // BitsPerSample
  header.write('data', 36)                       // Subchunk2ID
  header.writeUInt32LE(dataSize, 40)             // Subchunk2Size

  return Buffer.concat([header, pcmData])
}

interface WyomingHeader {
  type: string;
  data_length?: number;
  payload_length?: number;
}

export async function textToAudio(id: string, text: string, customPath?: string): Promise<string> {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true })
  }
  if (!existsSync(AUDIO_DIR)) {
    mkdirSync(AUDIO_DIR, { recursive: true })
  }

  const audioPath = customPath || join(AUDIO_DIR, `${id}.wav`)

  return new Promise<string>((resolve, reject) => {
    const client = new Socket()
    let receivedData = false
    let audioData = Buffer.alloc(0)
    let settled = false

    function settle(fn: () => void) {
      if (settled) return
      settled = true
      fn()
    }

    // Wyoming protocol parsing state
    let buffer = Buffer.alloc(0)
    let expectedPayload = 0
    let inPayload = false
    let pendingDataLength = 0      // bytes left to skip/read from a data block
    let pendingDataType = ''       // event type that owns the pending data block

    // Audio format from audio-start event
    let sampleRate = 22050
    let sampleWidth = 2
    let channels = 1

    // Set a timeout to avoid hanging
    const timeout = setTimeout(() => {
      client.destroy()
      settle(() => reject(new Error('TTS request timed out')))
    }, TIMEOUT_MS)

    client.connect(PIPER_PORT, PIPER_HOST, () => {
      logger.log('Connected to Piper')

      const event = JSON.stringify({
        type: 'synthesize',
        data: { text },
        payload_length: 0,
      })

      client.write(event + '\n')
    })

    client.on('data', (chunk: Buffer) => {
      receivedData = true
      buffer = Buffer.concat([buffer, chunk])

      while (buffer.length > 0) {
        if (!inPayload) {
          // Resume consuming a pending data block from a previous iteration
          if (pendingDataLength > 0) {
            if (buffer.length < pendingDataLength) break // Still waiting

            const pendingBlock = buffer.subarray(0, pendingDataLength)
            buffer = buffer.subarray(pendingDataLength)
            const resolvedType = pendingDataType
            pendingDataLength = 0
            pendingDataType = ''

            if (resolvedType === 'audio-start') {
              try {
                const audioInfo = JSON.parse(pendingBlock.toString())
                sampleRate = audioInfo.rate ?? sampleRate
                sampleWidth = audioInfo.width ?? sampleWidth
                channels = audioInfo.channels ?? channels
                logger.log(`Audio format: ${sampleRate}Hz, ${sampleWidth * 8}bit, ${channels}ch`)
              } catch {
                logger.warn('Could not parse audio-start data block')
              }
            } else if (resolvedType === 'error') {
              clearTimeout(timeout)
              client.destroy()
              settle(() => reject(new Error(`Piper error: ${pendingBlock.toString()}`)))
              return
            }

            // If this data block belonged to an audio-chunk, enter payload state now
            if (expectedPayload > 0) {
              inPayload = true
            }
            continue
          }

          // Look for newline-terminated JSON header
          const newlineIdx = buffer.indexOf('\n')
          if (newlineIdx === -1) break // Wait for more data

          const headerStr = buffer.subarray(0, newlineIdx).toString()
          buffer = buffer.subarray(newlineIdx + 1)

          let header: WyomingHeader
          try {
            header = JSON.parse(headerStr) as WyomingHeader
          } catch (_err) {
            // Log as hex so we can see exactly what bytes arrived
            logger.error('Failed to parse Wyoming header (hex):', Buffer.from(headerStr, 'utf8').toString('hex'))
            logger.error('Failed to parse Wyoming header (text):', JSON.stringify(headerStr))
            continue
          }

          // Consume the event's own data block before the next header
          if (header.data_length && header.data_length > 0) {
            if (buffer.length < header.data_length) {
              // Not enough data yet — save state and wait for more
              pendingDataLength = header.data_length
              pendingDataType = header.type
              // Also remember payload_length so we can enter payload state after the data block
              expectedPayload = header.payload_length ?? 0
              break
            }

            if (header.type === 'audio-start') {
              try {
                const audioInfo = JSON.parse(buffer.subarray(0, header.data_length).toString())
                sampleRate = audioInfo.rate ?? sampleRate
                sampleWidth = audioInfo.width ?? sampleWidth
                channels = audioInfo.channels ?? channels
                logger.log(`Audio format: ${sampleRate}Hz, ${sampleWidth * 8}bit, ${channels}ch`)
              } catch {
                logger.warn('Could not parse audio-start data block')
              }
            }

            buffer = buffer.subarray(header.data_length)
          }

          // After consuming any data block, check if there is also a payload to consume
          if (header.payload_length && header.payload_length > 0) {
            expectedPayload = header.payload_length
            inPayload = true
          } else if (header.type === 'audio-stop') {
            clearTimeout(timeout)
            // Graceful half-close — sends TCP FIN so Piper can finish its wav_writer
            // cleanly before we're done. Hard destroy() here leaves Piper's asyncio
            // coroutine in a broken state that corrupts subsequent connections.
            client.end()
            if (audioData.length === 0) {
              settle(() => reject(new Error('Connected to Piper but received no audio payload')))
              return
            }
            writeFileSync(audioPath, buildWav(audioData, sampleRate, sampleWidth, channels))
            logger.log(`Audio stored: ${audioPath} (${audioData.length} PCM bytes)`)
            settle(() => resolve(audioPath))
            return
          } else if (header.type === 'error') {
            // Read the error data block before rejecting so we can report the actual message
            if (header.data_length && header.data_length > 0) {
              if (buffer.length < header.data_length) {
                pendingDataLength = header.data_length
                pendingDataType = 'error'
                expectedPayload = 0
                break
              }
              const errorMsg = buffer.subarray(0, header.data_length).toString()
              buffer = buffer.subarray(header.data_length)
              clearTimeout(timeout)
              client.destroy()
              settle(() => reject(new Error(`Piper error: ${errorMsg}`)))
              return
            }
            clearTimeout(timeout)
            client.destroy()
            settle(() => reject(new Error(`Piper error (no details): ${headerStr}`)))
            return
          }
        } else {
          // Consume binary payload bytes — may arrive across multiple TCP packets
          const available = Math.min(buffer.length, expectedPayload)
          audioData = Buffer.concat([audioData, buffer.subarray(0, available)])
          buffer = buffer.subarray(available)
          expectedPayload -= available
          if (expectedPayload === 0) {
            inPayload = false
          } else {
            break // Wait for the rest of this payload chunk
          }
        }
      }
    })

    client.on('end', () => {
      clearTimeout(timeout)
      // audio-stop already resolved the promise in the happy path.
      // Only handle unexpected server-side disconnects here.
      if (!receivedData) {
        settle(() => reject(new Error('No data received from Piper server')))
        return
      }
      if (audioData.length === 0) {
        settle(() => reject(new Error('Connected to Piper but received no audio payload')))
        return
      }
      // Fallback: server closed without audio-stop (shouldn't happen with Piper,
      // but write the file rather than silently losing the audio).
      writeFileSync(audioPath, buildWav(audioData, sampleRate, sampleWidth, channels))
      client.destroy()
      console.log(`[TTS] Audio stored: ${audioPath} (${audioData.length} PCM bytes)`)
      settle(() => resolve(audioPath))
    })

    client.on('error', (err: Error) => {
      clearTimeout(timeout)
      client.destroy()
      settle(() => reject(new Error(`TTS request failed: ${err.message}`)))
    })
  })
}
