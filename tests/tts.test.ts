import { textToAudio } from '../src/tts'
import { existsSync, unlinkSync } from 'fs'
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
})
