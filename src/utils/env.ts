function str(key: string, defaultValue: string): string;
function str(key: string): string | undefined;
function str(key: string, defaultValue?: string): string | undefined {
  const val = process.env[key];
  if (val !== undefined && val !== '') return val;
  return defaultValue;
}

function num(key: string, defaultValue: number): number {
  const val = process.env[key];
  if (val === undefined || val === '') return defaultValue;
  const n = Number(val);
  if (!Number.isFinite(n)) throw new Error(`Env var ${key} must be a number, got: ${val}`);
  return n;
}

export const env = {
  // Worker
  POLL_INTERVAL: () => str('POLL_INTERVAL'),
  PIPER_HOST: () => str('PIPER_HOST', 'localhost'),
  PIPER_PORT: () => num('PIPER_PORT', 10200),
  TTS_TIMEOUT: () => num('TTS_TIMEOUT', 300) * 1000,
  TTS_MAX_RETRIES: () => num('TTS_MAX_RETRIES', 3),
  RSS_FETCH_TIMEOUT: () => num('RSS_FETCH_TIMEOUT', 30000),
  MAX_AUDIO_FILES: () => {
    const raw = process.env['MAX_AUDIO_FILES'];
    if (!raw || raw === '') return Infinity;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) throw new Error(`MAX_AUDIO_FILES must be a non-negative number, got: ${raw}`);
    return n;
  },

  // Server
  PORT: () => num('PORT', 3000),
  BASE_URL: (): string | undefined => {
    const raw = process.env['BASE_URL'];
    if (raw === undefined || raw === '') return undefined;
    try {
      // Validate — throws TypeError if malformed
      new URL(raw);
    } catch {
      throw new Error(`Env var BASE_URL must be a valid URL, got: ${raw}`);
    }
    return raw.replace(/\/+$/, '');
  },
  UNAVAILABLE_MESSAGE: () => str('UNAVAILABLE_MESSAGE', 'This content is no longer available on the server.'),
  TTS_FAILED_MESSAGE: () => str('TTS_FAILED_MESSAGE', 'This podcast episode could not be generated due to a text-to-speech error.'),
};
