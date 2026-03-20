import cron from 'node-cron'
import { parseRSSFeed } from '../src/rss'
import { main } from '../src/worker'

// Mocking dependencies
jest.mock('node-cron', () => ({
  validate: jest.fn().mockReturnValue(true),
  schedule: jest.fn(),
}))
jest.mock('../src/rss', () => ({
  parseRSSFeed: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('../src/utils/url', () => ({
  isValidURL: jest.fn().mockReturnValue(true),
  checkReachability: jest.fn().mockResolvedValue(true),
}))
jest.mock('../src/utils/storage', () => ({
  deleteAllAudioFiles: jest.fn(),
}))
jest.mock('../src/database/db', () => ({
  db: {
    prepare: jest.fn().mockReturnValue({
      get: jest.fn().mockReturnValue(undefined),
      run: jest.fn(),
    }),
  },
  resetDatabase: jest.fn(),
}))

describe('Worker Cron Scheduling', () => {
  let originalEnv: NodeJS.ProcessEnv
  let originalArgv: string[]

  beforeEach(() => {
    jest.clearAllMocks()
    originalEnv = { ...process.env }
    originalArgv = [...process.argv]
    // Prevent process.exit in tests
    jest.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit called with code ${code}`)
    })
    jest.spyOn(console, 'log').mockImplementation()
    jest.spyOn(console, 'error').mockImplementation()
  })

  afterEach(() => {
    process.env = originalEnv
    process.argv = originalArgv
    jest.restoreAllMocks()
  })

  it('should run once and exit when POLL_INTERVAL is not set', async () => {
    delete process.env.POLL_INTERVAL
    process.env.RSS_URL = 'http://example.com/rss'
    process.argv = ['node', 'worker.js']
    
    await main()

    expect(parseRSSFeed).toHaveBeenCalledTimes(1)
    expect(cron.schedule).not.toHaveBeenCalled()
  })

  it('should schedule tasks when POLL_INTERVAL is set', async () => {
    process.env.POLL_INTERVAL = '*/5 * * * *'
    process.env.RSS_URL = 'http://example.com/rss'
    process.argv = ['node', 'worker.js']
    
    await main()

    expect(parseRSSFeed).toHaveBeenCalledTimes(1) // Run once on startup
    expect(cron.schedule).toHaveBeenCalledWith('*/5 * * * *', expect.any(Function))
  })

  it('should fail if POLL_INTERVAL is invalid', async () => {
    process.env.POLL_INTERVAL = 'invalid'
    process.env.RSS_URL = 'http://example.com/rss'
    process.argv = ['node', 'worker.js']
    
    ;(cron.validate as jest.Mock).mockReturnValue(false)

    await expect(main()).rejects.toThrow('process.exit called with code 1')
    expect(cron.schedule).not.toHaveBeenCalled()
  })
})
