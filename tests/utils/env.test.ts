import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { env } from '../../src/utils/env.ts';

const KEYS = [
  'RSS_URL', 'POLL_INTERVAL', 'PIPER_HOST', 'PIPER_PORT', 'TTS_TIMEOUT',
  'TTS_MAX_RETRIES', 'RSS_FETCH_TIMEOUT', 'MAX_AUDIO_FILES', 'MAX_AUDIO_SIZE_MB',
  'PORT', 'BASE_URL', 'PODCAST_TITLE', 'PODCAST_DESCRIPTION', 'PODCAST_AUTHOR',
  'PODCAST_LANGUAGE', 'PODCAST_ITUNES_AUTHOR', 'PODCAST_ITUNES_SUMMARY',
  'PODCAST_ITUNES_OWNER_NAME', 'PODCAST_ITUNES_OWNER_EMAIL',
  'PODCAST_ITUNES_CATEGORY', 'UNAVAILABLE_MESSAGE', 'TTS_FAILED_MESSAGE',
];

let snapshot: Record<string, string | undefined>;

beforeEach(() => {
  snapshot = Object.fromEntries(KEYS.map(k => [k, process.env[k]]));
  KEYS.forEach(k => delete process.env[k]);
});

afterEach(() => {
  KEYS.forEach(k => {
    if (snapshot[k] === undefined) delete process.env[k];
    else process.env[k] = snapshot[k];
  });
});

describe('env', () => {
  it('RSS_URL returns undefined when unset', () => {
    expect(env.RSS_URL()).toBeUndefined();
  });

  it('RSS_URL returns value when set', () => {
    process.env.RSS_URL = 'https://example.com/feed';
    expect(env.RSS_URL()).toBe('https://example.com/feed');
  });

  it('POLL_INTERVAL returns undefined when unset', () => {
    expect(env.POLL_INTERVAL()).toBeUndefined();
  });

  it('POLL_INTERVAL returns value when set', () => {
    process.env.POLL_INTERVAL = '3600';
    expect(env.POLL_INTERVAL()).toBe('3600');
  });

  it('PIPER_HOST defaults to localhost', () => {
    expect(env.PIPER_HOST()).toBe('localhost');
  });

  it('PIPER_HOST returns value when set', () => {
    process.env.PIPER_HOST = 'tts-server';
    expect(env.PIPER_HOST()).toBe('tts-server');
  });

  it('PIPER_PORT defaults to 10200', () => {
    expect(env.PIPER_PORT()).toBe(10200);
  });

  it('PIPER_PORT returns numeric value when set', () => {
    process.env.PIPER_PORT = '9999';
    expect(env.PIPER_PORT()).toBe(9999);
  });

  it('PIPER_PORT throws on non-numeric value', () => {
    process.env.PIPER_PORT = 'abc';
    expect(() => env.PIPER_PORT()).toThrow('PIPER_PORT must be a number');
  });

  it('TTS_TIMEOUT defaults to 300000ms', () => {
    expect(env.TTS_TIMEOUT()).toBe(300_000);
  });

  it('TTS_TIMEOUT multiplies seconds by 1000', () => {
    process.env.TTS_TIMEOUT = '10';
    expect(env.TTS_TIMEOUT()).toBe(10_000);
  });

  it('TTS_MAX_RETRIES defaults to 3', () => {
    expect(env.TTS_MAX_RETRIES()).toBe(3);
  });

  it('TTS_MAX_RETRIES returns numeric value when set', () => {
    process.env.TTS_MAX_RETRIES = '5';
    expect(env.TTS_MAX_RETRIES()).toBe(5);
  });

  it('RSS_FETCH_TIMEOUT defaults to 30000', () => {
    expect(env.RSS_FETCH_TIMEOUT()).toBe(30000);
  });

  it('RSS_FETCH_TIMEOUT returns numeric value when set', () => {
    process.env.RSS_FETCH_TIMEOUT = '5000';
    expect(env.RSS_FETCH_TIMEOUT()).toBe(5000);
  });

  it('MAX_AUDIO_FILES returns Infinity when unset', () => {
    expect(env.MAX_AUDIO_FILES()).toBe(Infinity);
  });

  it('MAX_AUDIO_FILES returns numeric value when set', () => {
    process.env.MAX_AUDIO_FILES = '100';
    expect(env.MAX_AUDIO_FILES()).toBe(100);
  });

  it('MAX_AUDIO_FILES accepts zero', () => {
    process.env.MAX_AUDIO_FILES = '0';
    expect(env.MAX_AUDIO_FILES()).toBe(0);
  });

  it('MAX_AUDIO_FILES throws on non-numeric value', () => {
    process.env.MAX_AUDIO_FILES = 'bad';
    expect(() => env.MAX_AUDIO_FILES()).toThrow('MAX_AUDIO_FILES must be a non-negative number');
  });

  it('MAX_AUDIO_FILES throws on negative value', () => {
    process.env.MAX_AUDIO_FILES = '-1';
    expect(() => env.MAX_AUDIO_FILES()).toThrow('MAX_AUDIO_FILES must be a non-negative number');
  });

  it('MAX_AUDIO_SIZE_MB returns Infinity when unset', () => {
    expect(env.MAX_AUDIO_SIZE_MB()).toBe(Infinity);
  });

  it('MAX_AUDIO_SIZE_MB returns numeric value when set', () => {
    process.env.MAX_AUDIO_SIZE_MB = '500';
    expect(env.MAX_AUDIO_SIZE_MB()).toBe(500);
  });

  it('MAX_AUDIO_SIZE_MB throws on non-numeric value', () => {
    process.env.MAX_AUDIO_SIZE_MB = 'bad';
    expect(() => env.MAX_AUDIO_SIZE_MB()).toThrow('MAX_AUDIO_SIZE_MB must be a non-negative number');
  });

  it('MAX_AUDIO_SIZE_MB throws on negative value', () => {
    process.env.MAX_AUDIO_SIZE_MB = '-5';
    expect(() => env.MAX_AUDIO_SIZE_MB()).toThrow('MAX_AUDIO_SIZE_MB must be a non-negative number');
  });

  it('PORT defaults to 3000', () => {
    expect(env.PORT()).toBe(3000);
  });

  it('PORT returns numeric value when set', () => {
    process.env.PORT = '8080';
    expect(env.PORT()).toBe(8080);
  });

  it('BASE_URL returns undefined when unset', () => {
    expect(env.BASE_URL()).toBeUndefined();
  });

  it('BASE_URL returns undefined when empty string', () => {
    process.env.BASE_URL = '';
    expect(env.BASE_URL()).toBeUndefined();
  });

  it('BASE_URL returns value when set', () => {
    process.env.BASE_URL = 'https://podcast.example.com';
    expect(env.BASE_URL()).toBe('https://podcast.example.com');
  });

  it('BASE_URL strips a single trailing slash', () => {
    process.env.BASE_URL = 'https://podcast.example.com/';
    expect(env.BASE_URL()).toBe('https://podcast.example.com');
  });

  it('BASE_URL strips multiple trailing slashes', () => {
    process.env.BASE_URL = 'https://podcast.example.com///';
    expect(env.BASE_URL()).toBe('https://podcast.example.com');
  });

  it('BASE_URL preserves path but strips trailing slash', () => {
    process.env.BASE_URL = 'https://example.com/narratio/';
    expect(env.BASE_URL()).toBe('https://example.com/narratio');
  });

  it('BASE_URL throws on malformed URL', () => {
    process.env.BASE_URL = 'not a url';
    expect(() => env.BASE_URL()).toThrow('BASE_URL must be a valid URL');
  });

  it('PODCAST_TITLE defaults to Narratio', () => {
    expect(env.PODCAST_TITLE()).toBe('Narratio');
  });

  it('PODCAST_TITLE returns value when set', () => {
    process.env.PODCAST_TITLE = 'My Podcast';
    expect(env.PODCAST_TITLE()).toBe('My Podcast');
  });

  it('PODCAST_DESCRIPTION defaults to empty string', () => {
    expect(env.PODCAST_DESCRIPTION()).toBe('');
  });

  it('PODCAST_DESCRIPTION returns value when set', () => {
    process.env.PODCAST_DESCRIPTION = 'A great show';
    expect(env.PODCAST_DESCRIPTION()).toBe('A great show');
  });

  it('PODCAST_AUTHOR defaults to Narratio Worker', () => {
    expect(env.PODCAST_AUTHOR()).toBe('Narratio Worker');
  });

  it('PODCAST_LANGUAGE defaults to en', () => {
    expect(env.PODCAST_LANGUAGE()).toBe('en');
  });

  it('PODCAST_ITUNES_AUTHOR falls back to PODCAST_AUTHOR when unset', () => {
    process.env.PODCAST_AUTHOR = 'Fallback Author';
    expect(env.PODCAST_ITUNES_AUTHOR()).toBe('Fallback Author');
  });

  it('PODCAST_ITUNES_AUTHOR uses its own value when set', () => {
    process.env.PODCAST_ITUNES_AUTHOR = 'iTunes Author';
    process.env.PODCAST_AUTHOR = 'Should not appear';
    expect(env.PODCAST_ITUNES_AUTHOR()).toBe('iTunes Author');
  });

  it('PODCAST_ITUNES_AUTHOR defaults to Narratio Worker when both unset', () => {
    expect(env.PODCAST_ITUNES_AUTHOR()).toBe('Narratio Worker');
  });

  it('PODCAST_ITUNES_SUMMARY falls back to PODCAST_DESCRIPTION when unset', () => {
    process.env.PODCAST_DESCRIPTION = 'A great show';
    expect(env.PODCAST_ITUNES_SUMMARY()).toBe('A great show');
  });

  it('PODCAST_ITUNES_SUMMARY uses its own value when set', () => {
    process.env.PODCAST_ITUNES_SUMMARY = 'iTunes summary';
    process.env.PODCAST_DESCRIPTION = 'Should not appear';
    expect(env.PODCAST_ITUNES_SUMMARY()).toBe('iTunes summary');
  });

  it('PODCAST_ITUNES_SUMMARY defaults to empty string when both unset', () => {
    expect(env.PODCAST_ITUNES_SUMMARY()).toBe('');
  });

  it('PODCAST_ITUNES_OWNER_NAME falls back to PODCAST_AUTHOR when unset', () => {
    process.env.PODCAST_AUTHOR = 'Owner Fallback';
    expect(env.PODCAST_ITUNES_OWNER_NAME()).toBe('Owner Fallback');
  });

  it('PODCAST_ITUNES_OWNER_NAME uses its own value when set', () => {
    process.env.PODCAST_ITUNES_OWNER_NAME = 'iTunes Owner';
    process.env.PODCAST_AUTHOR = 'Should not appear';
    expect(env.PODCAST_ITUNES_OWNER_NAME()).toBe('iTunes Owner');
  });

  it('PODCAST_ITUNES_OWNER_EMAIL defaults to worker@example.com', () => {
    expect(env.PODCAST_ITUNES_OWNER_EMAIL()).toBe('worker@example.com');
  });

  it('PODCAST_ITUNES_CATEGORY defaults to Technology', () => {
    expect(env.PODCAST_ITUNES_CATEGORY()).toBe('Technology');
  });

  it('UNAVAILABLE_MESSAGE has a default', () => {
    expect(env.UNAVAILABLE_MESSAGE()).toContain('no longer available');
  });

  it('UNAVAILABLE_MESSAGE returns value when set', () => {
    process.env.UNAVAILABLE_MESSAGE = 'Gone.';
    expect(env.UNAVAILABLE_MESSAGE()).toBe('Gone.');
  });

  it('TTS_FAILED_MESSAGE has a default', () => {
    expect(env.TTS_FAILED_MESSAGE()).toContain('text-to-speech');
  });

  it('TTS_FAILED_MESSAGE returns value when set', () => {
    process.env.TTS_FAILED_MESSAGE = 'TTS broke.';
    expect(env.TTS_FAILED_MESSAGE()).toBe('TTS broke.');
  });
});
