import { createLogger } from '../src/utils/logger'

describe('createLogger', () => {
  it('returns an object with log, warn, and error methods', () => {
    const logger = createLogger('Test')
    expect(typeof logger.log).toBe('function')
    expect(typeof logger.warn).toBe('function')
    expect(typeof logger.error).toBe('function')
  })

  it('logger.log calls console.log with [Tag] prefix and extra args', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {})
    const logger = createLogger('Worker')
    logger.log('hello', 42, { x: 1 })
    expect(spy).toHaveBeenCalledWith('[Worker] hello', 42, { x: 1 })
    spy.mockRestore()
  })

  it('logger.warn calls console.warn with [Tag] prefix and extra args', () => {
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const logger = createLogger('Worker')
    logger.warn('something off', true)
    expect(spy).toHaveBeenCalledWith('[Worker] something off', true)
    spy.mockRestore()
  })

  it('logger.error calls console.error with [Tag] prefix and extra args', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const logger = createLogger('Worker')
    logger.error('boom', new Error('fail'))
    expect(spy).toHaveBeenCalledWith('[Worker] boom', new Error('fail'))
    spy.mockRestore()
  })

  it('includes the tag correctly in the prefix', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {})
    const logger = createLogger('MyTag')
    logger.log('test')
    expect(spy).toHaveBeenCalledWith('[MyTag] test')
    spy.mockRestore()
  })
})
