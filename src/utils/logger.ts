export interface Logger {
  log: (message: string, ...args: unknown[]) => void
  warn: (message: string, ...args: unknown[]) => void
  error: (message: string, ...args: unknown[]) => void
}

export function createLogger(tag: string): Logger {
  const prefix = `[${tag}]`
  return {
    log:   (message, ...args) => console.log(`${prefix} ${message}`, ...args),
    warn:  (message, ...args) => console.warn(`${prefix} ${message}`, ...args),
    error: (message, ...args) => console.error(`${prefix} ${message}`, ...args),
  }
}
