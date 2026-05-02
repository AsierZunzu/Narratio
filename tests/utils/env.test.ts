import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { env } from '../../src/utils/env.ts';

const KEYS = [
  'POLL_INTERVAL', 'PIPER_SERVICES', 'TTS_TIMEOUT',
  'TTS_MAX_RETRIES', 'RSS_FETCH_TIMEOUT', 'MAX_AUDIO_FILES',
  'PORT', 'BASE_URL', 'UNAVAILABLE_MESSAGE', 'TTS_FAILED_MESSAGE',
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
  it('POLL_INTERVAL returns undefined when unset', () => {
    expect(env.POLL_INTERVAL()).toBeUndefined();
  });

  it('POLL_INTERVAL returns value when set', () => {
    process.env.POLL_INTERVAL = '3600';
    expect(env.POLL_INTERVAL()).toBe('3600');
  });

  it('PIPER_SERVICES throws when unset', () => {
    expect(() => env.PIPER_SERVICES()).toThrow('PIPER_SERVICES');
  });

  it('PIPER_SERVICES returns value when set', () => {
    process.env.PIPER_SERVICES = 'localhost:10200,tts-2:10201';
    expect(env.PIPER_SERVICES()).toBe('localhost:10200,tts-2:10201');
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
