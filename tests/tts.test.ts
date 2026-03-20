import { textToAudio } from '../src/tts'
import { join } from 'path'
import { Socket } from 'net'

jest.mock('net')

// Intercept writeFileSync so tts tests don't write to the real data/audio directory,
// which would interfere with storage tests running in parallel.
const writtenFiles = new Map<string, Buffer>()
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn().mockReturnValue(true),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn((path: string, data: Buffer) => { writtenFiles.set(path, data) }),
}))

describe('TTS Service', () => {
  const mockId = 'test-article'
  const mockText = 'Hello world'
  const expectedPath = join(process.cwd(), 'data', 'audio', `${mockId}.wav`)

  let mockSocket: any
  let dataHandler: (chunk: Buffer) => void
  let endHandler: () => void
  let errorHandler: (err: Error) => void

  beforeEach(() => {
    writtenFiles.clear()
    mockSocket = {
      connect: jest.fn().mockImplementation((_port: number, _host: string, cb: () => void) => cb()),
      write: jest.fn(),
      end: jest.fn(),
      destroy: jest.fn(),
      on: jest.fn().mockImplementation((event: string, handler: Function) => {
        if (event === 'data') dataHandler = handler as (chunk: Buffer) => void
        if (event === 'end') endHandler = handler as () => void
        if (event === 'error') errorHandler = handler as (err: Error) => void
      }),
    }
    ;(Socket as unknown as jest.Mock).mockImplementation(() => mockSocket)
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  // --- Wyoming protocol message builders ---

  function wyomingAudioStart(sampleRate = 22050, sampleWidth = 2, channels = 1): Buffer {
    const data = JSON.stringify({ rate: sampleRate, width: sampleWidth, channels })
    const header = JSON.stringify({ type: 'audio-start', data_length: Buffer.byteLength(data), payload_length: 0 })
    return Buffer.from(header + '\n' + data)
  }

  function wyomingAudioChunk(pcm: Buffer): Buffer {
    const header = JSON.stringify({ type: 'audio-chunk', data_length: 0, payload_length: pcm.length })
    return Buffer.concat([Buffer.from(header + '\n'), pcm])
  }

  function wyomingAudioStop(): Buffer {
    return Buffer.from(JSON.stringify({ type: 'audio-stop', data_length: 0, payload_length: 0 }) + '\n')
  }

  // --- Happy path ---

  it('should generate a WAV file from text via Wyoming protocol', async () => {
    const pcm = Buffer.alloc(44, 0x01)

    const promise = textToAudio(mockId, mockText)

    dataHandler(wyomingAudioStart())
    dataHandler(wyomingAudioChunk(pcm))
    dataHandler(wyomingAudioStop())

    const audioPath = await promise

    expect(audioPath).toBe(expectedPath)
    expect(writtenFiles.has(audioPath)).toBe(true)
    expect(mockSocket.write).toHaveBeenCalledWith(
      expect.stringContaining('"type":"synthesize"')
    )
  })

  it('should write a valid RIFF WAV header', async () => {
    const pcm = Buffer.alloc(100, 0x7f)

    const promise = textToAudio(mockId, mockText)

    dataHandler(wyomingAudioStart())
    dataHandler(wyomingAudioChunk(pcm))
    dataHandler(wyomingAudioStop())

    await promise

    const file = writtenFiles.get(expectedPath)!
    expect(file.subarray(0, 4).toString()).toBe('RIFF')
    expect(file.subarray(8, 12).toString()).toBe('WAVE')
  })

  it('should use audio format from audio-start event', async () => {
    const pcm = Buffer.alloc(44, 0x01)

    const promise = textToAudio(mockId, mockText)

    dataHandler(wyomingAudioStart(16000, 2, 1))
    dataHandler(wyomingAudioChunk(pcm))
    dataHandler(wyomingAudioStop())

    await promise

    const file = writtenFiles.get(expectedPath)!
    // Sample rate at offset 24 (little-endian uint32)
    expect(file.readUInt32LE(24)).toBe(16000)
  })

  it('should accept a custom output path', async () => {
    const customPath = join(process.cwd(), 'data', 'custom-test.wav')
    const pcm = Buffer.alloc(44, 0x01)

    const promise = textToAudio(mockId, mockText, customPath)

    dataHandler(wyomingAudioStart())
    dataHandler(wyomingAudioChunk(pcm))
    dataHandler(wyomingAudioStop())

    const audioPath = await promise

    expect(audioPath).toBe(customPath)
    expect(writtenFiles.has(customPath)).toBe(true)
  })

  it('should handle Wyoming messages arriving in a single TCP chunk', async () => {
    const pcm = Buffer.alloc(200, 0x42)

    const promise = textToAudio(mockId, mockText)

    const combined = Buffer.concat([
      wyomingAudioStart(),
      wyomingAudioChunk(pcm),
      wyomingAudioStop(),
    ])
    dataHandler(combined)

    const audioPath = await promise
    expect(writtenFiles.has(audioPath)).toBe(true)
  })

  // --- Directory creation (lines 42, 45) ---

  it('creates DATA_DIR when it does not exist', async () => {
    const fsMod = require('fs')
    const existsSyncSpy = jest.spyOn(fsMod, 'existsSync')
      .mockReturnValueOnce(false) // DATA_DIR missing
      .mockReturnValue(true)      // AUDIO_DIR and everything else
    const mkdirSyncSpy = jest.spyOn(fsMod, 'mkdirSync')

    const pcm = Buffer.alloc(44, 0x01)
    const promise = textToAudio(mockId, mockText)
    dataHandler(wyomingAudioStart())
    dataHandler(wyomingAudioChunk(pcm))
    dataHandler(wyomingAudioStop())
    await promise

    expect(mkdirSyncSpy).toHaveBeenCalledWith(join(process.cwd(), 'data'), { recursive: true })
    existsSyncSpy.mockRestore()
    mkdirSyncSpy.mockRestore()
  })

  it('creates AUDIO_DIR when it does not exist', async () => {
    const fsMod = require('fs')
    const existsSyncSpy = jest.spyOn(fsMod, 'existsSync')
      .mockReturnValueOnce(true)  // DATA_DIR exists
      .mockReturnValueOnce(false) // AUDIO_DIR missing
      .mockReturnValue(true)
    const mkdirSyncSpy = jest.spyOn(fsMod, 'mkdirSync')

    const pcm = Buffer.alloc(44, 0x01)
    const promise = textToAudio(mockId, mockText)
    dataHandler(wyomingAudioStart())
    dataHandler(wyomingAudioChunk(pcm))
    dataHandler(wyomingAudioStop())
    await promise

    expect(mkdirSyncSpy).toHaveBeenCalledWith(join(process.cwd(), 'data', 'audio'), { recursive: true })
    existsSyncSpy.mockRestore()
    mkdirSyncSpy.mockRestore()
  })

  // --- Timeout (lines 76-77) ---

  it('rejects with timeout error when Piper does not respond in time', async () => {
    jest.useFakeTimers()

    const promise = textToAudio(mockId, mockText)
    jest.advanceTimersByTime(300 * 1000 + 1) // TIMEOUT_MS = parseInt('300') * 1000

    await expect(promise).rejects.toThrow('TTS request timed out')

    jest.useRealTimers()
  })

  // --- Error events ---

  it('rejects with "no details" message when error event has no data block', async () => {
    const promise = textToAudio(mockId, mockText)

    dataHandler(Buffer.from(JSON.stringify({ type: 'error' }) + '\n'))

    await expect(promise).rejects.toThrow('Piper error (no details):')
  })

  it('rejects with Piper error message when error data block arrives in a later chunk', async () => {
    const promise = textToAudio(mockId, mockText)

    const errorMsg = Buffer.from('synthesis failed')
    const header = JSON.stringify({ type: 'error', data_length: errorMsg.length })
    dataHandler(Buffer.from(header + '\n')) // header only, no data block
    dataHandler(errorMsg)                   // data block arrives split

    await expect(promise).rejects.toThrow('Piper error: synthesis failed')
  })

  // --- Split TCP delivery (lines 100-129, 153-157) ---

  it('handles audio-start data block arriving in a separate TCP chunk', async () => {
    const pcm = Buffer.alloc(44, 0x01)
    const promise = textToAudio(mockId, mockText)

    const audioStartFull = wyomingAudioStart(16000, 2, 1)
    const newlineIdx = audioStartFull.indexOf('\n')
    const headerPart = audioStartFull.subarray(0, newlineIdx + 1)
    const dataPart = audioStartFull.subarray(newlineIdx + 1)

    dataHandler(headerPart)                                                        // header only → pending
    dataHandler(Buffer.concat([dataPart, wyomingAudioChunk(pcm), wyomingAudioStop()])) // data block + rest

    const audioPath = await promise
    expect(writtenFiles.has(audioPath)).toBe(true)
    // Sample rate was parsed from the split data block
    expect(writtenFiles.get(audioPath)!.readUInt32LE(24)).toBe(16000)
  })

  it('waits for more data when pending data block is still incomplete', async () => {
    const pcm = Buffer.alloc(44, 0x01)
    const promise = textToAudio(mockId, mockText)

    const audioInfo = JSON.stringify({ rate: 22050, width: 2, channels: 1 })
    const midpoint = Math.floor(audioInfo.length / 2)
    const firstHalf = Buffer.from(audioInfo.substring(0, midpoint))
    const secondHalf = Buffer.from(audioInfo.substring(midpoint))
    const headerStr = JSON.stringify({ type: 'audio-start', data_length: Buffer.byteLength(audioInfo), payload_length: 0 })

    dataHandler(Buffer.from(headerStr + '\n'))  // header only → saves pending
    dataHandler(firstHalf)                       // partial data block → still waiting (line 100)
    dataHandler(Buffer.concat([secondHalf, wyomingAudioChunk(pcm), wyomingAudioStop()]))

    const audioPath = await promise
    expect(writtenFiles.has(audioPath)).toBe(true)
  })

  it('transitions to payload state after resolving a pending data block', async () => {
    // audio-chunk with both data_length AND payload_length, where the data block arrives split
    const pcm = Buffer.alloc(44, 0x42)
    const promise = textToAudio(mockId, mockText)

    const chunkData = Buffer.from('extra') // 5-byte data block on an audio-chunk
    const header = JSON.stringify({ type: 'audio-chunk', data_length: chunkData.length, payload_length: pcm.length })

    dataHandler(wyomingAudioStart())
    dataHandler(Buffer.from(header + '\n'))                             // header only → pending
    dataHandler(Buffer.concat([chunkData, pcm, wyomingAudioStop()]))   // data block + PCM payload + stop

    const audioPath = await promise
    expect(writtenFiles.has(audioPath)).toBe(true)
  })

  // --- PCM payload split (line 223) ---

  it('handles PCM payload split across two TCP chunks', async () => {
    const pcm = Buffer.alloc(200, 0x42)
    const promise = textToAudio(mockId, mockText)

    const chunkHeader = Buffer.from(
      JSON.stringify({ type: 'audio-chunk', data_length: 0, payload_length: pcm.length }) + '\n'
    )

    dataHandler(wyomingAudioStart())
    dataHandler(Buffer.concat([chunkHeader, pcm.subarray(0, 100)])) // header + first half of PCM
    dataHandler(Buffer.concat([pcm.subarray(100), wyomingAudioStop()])) // rest of PCM + stop

    const audioPath = await promise
    expect(writtenFiles.has(audioPath)).toBe(true)
  })

  // --- Malformed messages ---

  it('logs error and continues when header line contains invalid JSON', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation()
    const pcm = Buffer.alloc(44, 0x01)
    const promise = textToAudio(mockId, mockText)

    dataHandler(Buffer.from('not-valid-json\n'))  // garbage header
    dataHandler(wyomingAudioStart())
    dataHandler(wyomingAudioChunk(pcm))
    dataHandler(wyomingAudioStop())

    const audioPath = await promise
    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to parse Wyoming header (hex):', expect.any(String)
    )
    expect(writtenFiles.has(audioPath)).toBe(true)
    errorSpy.mockRestore()
  })

  it('logs warning and uses default format when audio-start data block is invalid JSON (inline)', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
    const pcm = Buffer.alloc(44, 0x01)
    const promise = textToAudio(mockId, mockText)

    const badData = Buffer.from('not-json!!!')
    const header = JSON.stringify({ type: 'audio-start', data_length: badData.length, payload_length: 0 })
    dataHandler(Buffer.concat([Buffer.from(header + '\n'), badData, wyomingAudioChunk(pcm), wyomingAudioStop()]))

    const audioPath = await promise
    expect(warnSpy).toHaveBeenCalledWith('Could not parse audio-start data block')
    expect(writtenFiles.has(audioPath)).toBe(true)
    warnSpy.mockRestore()
  })

  it('logs warning and uses default format when audio-start data block is invalid JSON (split)', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
    const pcm = Buffer.alloc(44, 0x01)
    const promise = textToAudio(mockId, mockText)

    const badData = Buffer.from('not-json!!!')
    const header = JSON.stringify({ type: 'audio-start', data_length: badData.length, payload_length: 0 })
    dataHandler(Buffer.from(header + '\n'))
    dataHandler(Buffer.concat([badData, wyomingAudioChunk(pcm), wyomingAudioStop()]))

    const audioPath = await promise
    expect(warnSpy).toHaveBeenCalledWith('Could not parse audio-start data block')
    expect(writtenFiles.has(audioPath)).toBe(true)
    warnSpy.mockRestore()
  })

  // --- Error rejections ---

  it('rejects on connection error', async () => {
    const promise = textToAudio(mockId, mockText)
    errorHandler(new Error('ECONNREFUSED'))
    await expect(promise).rejects.toThrow('TTS request failed: ECONNREFUSED')
  })

  it('rejects when server closes without sending data', async () => {
    const promise = textToAudio(mockId, mockText)
    endHandler()
    await expect(promise).rejects.toThrow('No data received from Piper server')
  })

  it('rejects when audio-stop is received with no PCM payload', async () => {
    const promise = textToAudio(mockId, mockText)

    dataHandler(wyomingAudioStart())
    dataHandler(wyomingAudioStop())

    await expect(promise).rejects.toThrow('Connected to Piper but received no audio payload')
  })

  it('rejects when server closes after audio-start but before any PCM payload', async () => {
    const promise = textToAudio(mockId, mockText)

    dataHandler(wyomingAudioStart()) // receivedData = true, but audioData is empty
    endHandler()

    await expect(promise).rejects.toThrow('Connected to Piper but received no audio payload')
  })

  // --- end-handler fallback (lines 241-246) ---

  it('writes fallback WAV when server closes without sending audio-stop', async () => {
    const pcm = Buffer.alloc(44, 0x42)
    const promise = textToAudio(mockId, mockText)

    dataHandler(wyomingAudioStart())
    dataHandler(wyomingAudioChunk(pcm))
    endHandler() // server closes without audio-stop

    const audioPath = await promise
    const file = writtenFiles.get(audioPath)!
    expect(file).toBeDefined()
    expect(file.subarray(0, 4).toString()).toBe('RIFF')
  })
})
