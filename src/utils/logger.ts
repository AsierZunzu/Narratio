type Level = 'info' | 'warn' | 'error' | 'debug';

function format(level: Level, message: string): string {
  return `[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}`;
}

export const logger = {
  info: (msg: string) => console.log(format('info', msg)),
  warn: (msg: string) => console.warn(format('warn', msg)),
  error: (msg: string, err?: unknown) => {
    const detail = err instanceof Error ? ` — ${err.message}` : err !== undefined ? ` — ${String(err)}` : '';
    console.error(format('error', msg + detail));
  },
  debug: (msg: string) => {
    if (process.env['DEBUG']) console.debug(format('debug', msg));
  },
};
