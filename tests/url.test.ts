import { isValidURL, checkReachability } from '../src/utils/url'

describe('URL Utils', () => {
  describe('isValidURL', () => {
    test('should return true for valid HTTP URL', () => {
      expect(isValidURL('http://example.com')).toBe(true)
    })

    test('should return true for valid HTTPS URL', () => {
      expect(isValidURL('https://example.com/rss.xml')).toBe(true)
    })

    test('should return false for invalid URL', () => {
      expect(isValidURL('not-a-url')).toBe(false)
    })

    test('should return false for empty string', () => {
      expect(isValidURL('')).toBe(false)
    })
  })

  describe('checkReachability', () => {
    beforeEach(() => {
      global.fetch = jest.fn()
    })

    test('should return true when response is ok', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({ ok: true })
      const result = await checkReachability('http://example.com')
      expect(result).toBe(true)
      expect(global.fetch).toHaveBeenCalledWith('http://example.com', { method: 'HEAD' })
    })

    test('should return false when response is not ok', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({ ok: false })
      const result = await checkReachability('http://example.com')
      expect(result).toBe(false)
    })

    test('should return false when fetch throws error', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'))
      const result = await checkReachability('http://example.com')
      expect(result).toBe(false)
    })
  })
})
