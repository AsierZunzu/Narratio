import { textToAudio, generateUnavailableAudio } from '../src/tts'
import { existsSync, unlinkSync, readFileSync } from 'fs'
import { join } from 'path'

describe('TTS Service', () => {
  const mockId = 'test-article'
  const mockText = 'Hello world'
  const expectedPath = join(process.cwd(), 'data', 'audio', `${mockId}.wav`)

  beforeAll(() => {
    // Mock global fetch
    global.fetch = jest.fn() as jest.Mock
  })

  afterEach(() => {
    if (existsSync(expectedPath)) {
      unlinkSync(expectedPath)
    }
    jest.clearAllMocks()
  })

  it('should generate an audio file from text', async () => {
    const mockAudioData = Buffer.from('mock-audio-content')
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(mockAudioData),
    })

    const audioPath = await textToAudio(mockId, mockText)

    expect(audioPath).toBe(expectedPath)
    expect(existsSync(audioPath)).toBe(true)
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining(encodeURIComponent(mockText))
    )
  })

  it('should throw an error if the TTS request fails', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      statusText: 'Internal Server Error',
    })

    await expect(textToAudio(mockId, mockText)).rejects.toThrow('TTS request failed: Internal Server Error')
  })

  it('should generate unavailable audio with default message', async () => {
    const mockAudioData = Buffer.from('mock-unavailable-audio')
    const unavailablePath = join(process.cwd(), 'data', 'unavailable.wav')
    
    if (existsSync(unavailablePath)) {
      unlinkSync(unavailablePath)
    }

    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(mockAudioData),
    })

    await generateUnavailableAudio()

    expect(existsSync(unavailablePath)).toBe(true)
    expect(readFileSync(unavailablePath).toString()).toBe('mock-unavailable-audio')
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining(encodeURIComponent('This content is no longer available on the server.'))
    )

    unlinkSync(unavailablePath)
  })

  it('should generate unavailable audio with custom message from env', async () => {
    process.env.UNAVAILABLE_MESSAGE = 'Custom unavailable message'
    const mockAudioData = Buffer.from('custom-unavailable-audio')
    const unavailablePath = join(process.cwd(), 'data', 'unavailable.wav')

    if (existsSync(unavailablePath)) {
      unlinkSync(unavailablePath)
    }

    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(mockAudioData),
    })

    await generateUnavailableAudio()

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining(encodeURIComponent('Custom unavailable message'))
    )

    delete process.env.UNAVAILABLE_MESSAGE
    if (existsSync(unavailablePath)) {
      unlinkSync(unavailablePath)
    }
  })
});
