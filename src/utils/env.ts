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

function requireStr(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Required env var ${key} is not set`);
  return val;
}

export const env = {
  // Worker
  RSS_URL: () => requireStr('RSS_URL'),
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
  MAX_AUDIO_SIZE_MB: () => {
    const raw = process.env['MAX_AUDIO_SIZE_MB'];
    if (!raw || raw === '') return Infinity;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) throw new Error(`MAX_AUDIO_SIZE_MB must be a non-negative number, got: ${raw}`);
    return n;
  },

  // Server
  PORT: () => num('PORT', 3000),
  PODCAST_TITLE: () => str('PODCAST_TITLE', 'Narratio'),
  PODCAST_DESCRIPTION: () => str('PODCAST_DESCRIPTION', ''),
  PODCAST_AUTHOR: () => str('PODCAST_AUTHOR', 'Narratio Worker'),
  PODCAST_LANGUAGE: () => str('PODCAST_LANGUAGE', 'en'),
  PODCAST_ITUNES_AUTHOR: () => str('PODCAST_ITUNES_AUTHOR') ?? str('PODCAST_AUTHOR', 'Narratio Worker'),
  PODCAST_ITUNES_SUMMARY: () => str('PODCAST_ITUNES_SUMMARY') ?? str('PODCAST_DESCRIPTION', ''),
  PODCAST_ITUNES_OWNER_NAME: () => str('PODCAST_ITUNES_OWNER_NAME') ?? str('PODCAST_AUTHOR', 'Narratio Worker'),
  PODCAST_ITUNES_OWNER_EMAIL: () => str('PODCAST_ITUNES_OWNER_EMAIL', 'worker@example.com'),
  PODCAST_ITUNES_CATEGORY: () => str('PODCAST_ITUNES_CATEGORY', 'Technology'),
  UNAVAILABLE_MESSAGE: () => str('UNAVAILABLE_MESSAGE', 'This content is no longer available on the server.'),
  TTS_FAILED_MESSAGE: () => str('TTS_FAILED_MESSAGE', 'This podcast episode could not be generated due to a text-to-speech error.'),
};
