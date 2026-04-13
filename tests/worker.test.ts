import cron from 'node-cron'
import { parseRSSFeed } from '../src/services/rss'
import { main } from '../src/worker'
import { db } from '../src/database/db'

// Mocking dependencies
jest.mock('node-cron', () => ({
  validate: jest.fn().mockReturnValue(true),
  schedule: jest.fn().mockReturnValue({ stop: jest.fn() }),
}))
jest.mock('../src/services/rss', () => ({
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
    getFeedUrl: jest.fn().mockReturnValue(undefined),
    setFeedUrl: jest.fn(),
    reset: jest.fn(),
    close: jest.fn(),
    resetAllTtsRetryCount: jest.fn().mockReturnValue(2),
  },
}))

describe('Worker Cron Scheduling', () => {
  let originalEnv: NodeJS.ProcessEnv
  let originalArgv: string[]

  beforeEach(() => {
    jest.clearAllMocks()
    // Re-establish default return values (clearAllMocks does not reset implementations)
    ;(cron.validate as jest.Mock).mockReturnValue(true)
    ;(cron.schedule as jest.Mock).mockReturnValue({ stop: jest.fn() })
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
    process.removeAllListeners('SIGTERM')
    process.removeAllListeners('SIGINT')
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

  it('should register SIGTERM and SIGINT handlers in cron mode', async () => {
    process.env.POLL_INTERVAL = '*/5 * * * *'
    process.env.RSS_URL = 'http://example.com/rss'
    process.argv = ['node', 'worker.js']

    const sigtermBefore = process.listenerCount('SIGTERM')
    const sigintBefore = process.listenerCount('SIGINT')

    await main()

    expect(process.listenerCount('SIGTERM')).toBe(sigtermBefore + 1)
    expect(process.listenerCount('SIGINT')).toBe(sigintBefore + 1)
  })

  it('should reset retry counts and run task when --retry-failed is passed', async () => {
    delete process.env.POLL_INTERVAL
    process.env.RSS_URL = 'http://example.com/rss'
    process.argv = ['node', 'worker.js', '--retry-failed']

    await main()

    expect((db as any).resetAllTtsRetryCount).toHaveBeenCalledTimes(1)
    expect(parseRSSFeed).toHaveBeenCalledTimes(1)
  })

  it('should not reset retry counts when --retry-failed is not passed', async () => {
    delete process.env.POLL_INTERVAL
    process.env.RSS_URL = 'http://example.com/rss'
    process.argv = ['node', 'worker.js']

    await main()

    expect((db as any).resetAllTtsRetryCount).not.toHaveBeenCalled()
  })

  it('should stop cron task and close db on SIGTERM', async () => {
    process.env.POLL_INTERVAL = '*/5 * * * *'
    process.env.RSS_URL = 'http://example.com/rss'
    process.argv = ['node', 'worker.js']

    await main()

    const mockTask = (cron.schedule as jest.Mock).mock.results[0].value
    const exitSpy = process.exit as unknown as jest.Mock

    // process.exit(0) throws in the test environment — catch it and verify the calls made before it
    try { process.emit('SIGTERM') } catch { /* expected */ }

    expect(mockTask.stop).toHaveBeenCalled()
    expect((db as any).close).toHaveBeenCalled()
    expect(exitSpy).toHaveBeenCalledWith(0)
  })
})
