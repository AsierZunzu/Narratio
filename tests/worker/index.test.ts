import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Stable mock objects shared across module resets via vi.hoisted
const mocks = vi.hoisted(() => ({
  fs: {
    mkdirSync: vi.fn(),
    existsSync: vi.fn(() => false as boolean),
    rmSync: vi.fn(),
    unlinkSync: vi.fn(),
    readdirSync: vi.fn(() => [] as string[]),
  },
  cron: {
    validate: vi.fn(() => true as boolean),
    schedule: vi.fn(() => ({ stop: vi.fn() })),
  },
  db: {
    getDb: vi.fn(() => ({} as ReturnType<typeof import('../../src/db/index.js').getDb>)),
    closeDb: vi.fn(),
    resetDb: vi.fn(),
  },
  articles: {
    resetFailedRetries: vi.fn(() => 0 as number),
    resetConvertingArticles: vi.fn(() => 0 as number),
    resetAllArticlesForRegen: vi.fn(() => 0 as number),
  },
  feeds: {
    getFeeds: vi.fn(() => [] as ReturnType<typeof import('../../src/db/feeds.js').getFeeds>),
  },
  ttsServices: {
    getTtsServiceById: vi.fn(() => null as ReturnType<typeof import('../../src/db/tts-services.js').getTtsServiceById>),
  },
  rss: {
    processFeed: vi.fn().mockResolvedValue(undefined),
    processPendingArticles: vi.fn().mockResolvedValue(undefined),
  },
  cleanup: {
    runCleanup: vi.fn(),
  },
  env: {
    POLL_INTERVAL: vi.fn(() => undefined as string | undefined),
    TTS_MAX_RETRIES: vi.fn(() => 3),
    TTS_TIMEOUT: vi.fn(() => 300_000),
    RSS_FETCH_TIMEOUT: vi.fn(() => 30_000),
  },
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('fs', () => ({
  default: {
    mkdirSync: mocks.fs.mkdirSync,
    existsSync: mocks.fs.existsSync,
    rmSync: mocks.fs.rmSync,
    unlinkSync: mocks.fs.unlinkSync,
    readdirSync: mocks.fs.readdirSync,
  },
}));

vi.mock('node-cron', () => ({
  default: {
    validate: mocks.cron.validate,
    schedule: mocks.cron.schedule,
  },
}));

vi.mock('../../src/db/index.js', () => ({
  getDb: mocks.db.getDb,
  closeDb: mocks.db.closeDb,
  resetDb: mocks.db.resetDb,
}));

vi.mock('../../src/db/worker-state.js', () => ({
  setWorkerStatus: vi.fn(),
  getWorkerState: vi.fn(() => ({ id: 1, status: 'idle', updated_at: '2026-04-27T00:00:00Z' })),
}));

vi.mock('../../src/db/articles.js', () => ({
  resetFailedRetries: mocks.articles.resetFailedRetries,
  resetConvertingArticles: mocks.articles.resetConvertingArticles,
  resetAllArticlesForRegen: mocks.articles.resetAllArticlesForRegen,
}));

vi.mock('../../src/db/feeds.js', () => ({
  getFeeds: mocks.feeds.getFeeds,
}));

vi.mock('../../src/db/tts-services.js', () => ({
  getTtsServiceById: mocks.ttsServices.getTtsServiceById,
}));

vi.mock('../../src/services/rss.js', () => ({
  processFeed: mocks.rss.processFeed,
  processPendingArticles: mocks.rss.processPendingArticles,
}));

vi.mock('../../src/services/cleanup.js', () => ({
  runCleanup: mocks.cleanup.runCleanup,
}));

vi.mock('../../src/utils/env.js', () => ({
  env: mocks.env,
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: mocks.logger,
}));

const tick = () => new Promise<void>(r => setTimeout(r, 10));

let originalArgv: string[];
let originalEnvForceReset: string | undefined;
let exitSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  originalArgv = process.argv;
  originalEnvForceReset = process.env['FORCE_RESET'];
  delete process.env['FORCE_RESET'];
  process.argv = ['node', 'worker'];

  // resetAllMocks clears call history AND implementations (mockReturnValue/mockImplementation),
  // preventing a throwing mock from one test leaking into the next.
  vi.resetAllMocks();

  // Spy on process.exit AFTER resetAllMocks so the no-op implementation isn't cleared.
  // Vitest 4's default process.exit handling throws, which would surface as unhandled
  // rejections from worker's top-level `main().catch(... process.exit(1))`.
  exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
  mocks.fs.existsSync.mockReturnValue(false);
  mocks.fs.readdirSync.mockReturnValue([]);
  mocks.db.getDb.mockReturnValue({} as ReturnType<typeof import('../../src/db/index.js').getDb>);
  mocks.articles.resetFailedRetries.mockReturnValue(0);
  mocks.articles.resetConvertingArticles.mockReturnValue(0);
  mocks.articles.resetAllArticlesForRegen.mockReturnValue(0);
  mocks.feeds.getFeeds.mockReturnValue([]);
  mocks.ttsServices.getTtsServiceById.mockReturnValue(null);
  mocks.rss.processFeed.mockResolvedValue(undefined);
  mocks.rss.processPendingArticles.mockResolvedValue(undefined);
  mocks.env.POLL_INTERVAL.mockReturnValue(undefined);
  mocks.env.TTS_MAX_RETRIES.mockReturnValue(3);
  mocks.env.TTS_TIMEOUT.mockReturnValue(300_000);
  mocks.env.RSS_FETCH_TIMEOUT.mockReturnValue(30_000);
  mocks.cron.validate.mockReturnValue(true);
  mocks.cron.schedule.mockReturnValue({ stop: vi.fn() } as ReturnType<typeof import('node-cron').default.schedule>);

  vi.resetModules();
});

afterEach(() => {
  process.argv = originalArgv;
  if (originalEnvForceReset === undefined) delete process.env['FORCE_RESET'];
  else process.env['FORCE_RESET'] = originalEnvForceReset;
  exitSpy.mockRestore();
  process.removeAllListeners('SIGTERM');
  process.removeAllListeners('SIGINT');
});

async function runWorker() {
  await import('../../src/worker/index.js');
  await tick();
}

type FeedRow = ReturnType<typeof import('../../src/db/feeds.js').getFeeds>[number];
type TtsRow = NonNullable<ReturnType<typeof import('../../src/db/tts-services.js').getTtsServiceById>>;

const FEED: FeedRow = { id: 1, name: 'Feed A', tts_service_id: 1, rss_url: 'http://x.com/feed', max_audio_files: null, max_audio_size_mb: null } as FeedRow;
const TTS: TtsRow = { id: 1, host: 'localhost', port: 10200 } as TtsRow;

describe('worker main — no flags', () => {
  it('warns and exits cleanly when no feeds configured', async () => {
    await runWorker();
    expect(mocks.logger.warn).toHaveBeenCalledWith(expect.stringContaining('No feeds configured'));
    expect(mocks.db.closeDb).toHaveBeenCalled();
  });

  it('resets stuck converting articles on first run', async () => {
    mocks.articles.resetConvertingArticles.mockReturnValue(3);
    await runWorker();
    expect(mocks.logger.warn).toHaveBeenCalledWith(expect.stringContaining('3 stuck'));
  });

  it('does not warn about stuck articles when count is 0', async () => {
    mocks.articles.resetConvertingArticles.mockReturnValue(0);
    await runWorker();
    const warnMessages = mocks.logger.warn.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(warnMessages.some(m => m.includes('stuck'))).toBe(false);
  });

  it('skips feed when TTS service is not found', async () => {
    mocks.feeds.getFeeds.mockReturnValue([FEED]);
    mocks.ttsServices.getTtsServiceById.mockReturnValue(null);
    await runWorker();
    expect(mocks.logger.warn).toHaveBeenCalledWith(expect.stringContaining('unknown TTS service'));
    expect(mocks.rss.processFeed).not.toHaveBeenCalled();
  });

  it('calls processFeed and runCleanup for each configured feed', async () => {
    mocks.feeds.getFeeds.mockReturnValue([FEED]);
    mocks.ttsServices.getTtsServiceById.mockReturnValue(TTS);
    await runWorker();
    expect(mocks.rss.processFeed).toHaveBeenCalledTimes(1);
    expect(mocks.cleanup.runCleanup).toHaveBeenCalledTimes(1);
  });

  it('catches and logs errors from processFeed without crashing', async () => {
    mocks.feeds.getFeeds.mockReturnValue([FEED]);
    mocks.ttsServices.getTtsServiceById.mockReturnValue(TTS);
    mocks.rss.processFeed.mockRejectedValue(new Error('boom'));
    await runWorker();
    expect(mocks.logger.error).toHaveBeenCalledWith('Worker run failed', expect.any(Error));
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('closes db and returns when no POLL_INTERVAL', async () => {
    mocks.env.POLL_INTERVAL.mockReturnValue(undefined);
    await runWorker();
    expect(mocks.db.closeDb).toHaveBeenCalled();
    expect(mocks.cron.schedule).not.toHaveBeenCalled();
  });

  it('schedules two cron tasks when POLL_INTERVAL is valid', async () => {
    mocks.env.POLL_INTERVAL.mockReturnValue('*/5 * * * *');
    mocks.cron.validate.mockReturnValue(true);
    await runWorker();
    expect(mocks.cron.schedule).toHaveBeenCalledTimes(2);
  });

  it('exits with code 1 and logs error on invalid POLL_INTERVAL', async () => {
    mocks.env.POLL_INTERVAL.mockReturnValue('not-a-cron');
    mocks.cron.validate.mockReturnValue(false);
    await runWorker();
    expect(mocks.logger.error).toHaveBeenCalledWith(expect.stringContaining('Invalid POLL_INTERVAL'));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe('worker main — --force-reset', () => {
  it('deletes audio dir and db file then exits 0 when both exist', async () => {
    process.argv = ['node', 'worker', '--force-reset'];
    mocks.fs.existsSync.mockReturnValue(true);
    await runWorker();
    expect(mocks.fs.rmSync).toHaveBeenCalled();
    expect(mocks.fs.unlinkSync).toHaveBeenCalled();
    expect(mocks.db.resetDb).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('skips rmSync and unlinkSync when paths do not exist', async () => {
    process.argv = ['node', 'worker', '--force-reset'];
    mocks.fs.existsSync.mockReturnValue(false);
    await runWorker();
    expect(mocks.fs.rmSync).not.toHaveBeenCalled();
    expect(mocks.fs.unlinkSync).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('exits with code 1 when rmSync throws', async () => {
    process.argv = ['node', 'worker', '--force-reset'];
    mocks.fs.existsSync.mockReturnValue(true);
    mocks.fs.rmSync.mockImplementation(() => { throw new Error('permission denied'); });
    await runWorker();
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mocks.logger.error).toHaveBeenCalledWith('force-reset failed', expect.any(Error));
  });
});

describe('worker main — FORCE_RESET env var', () => {
  it('runs handleForceReset but continues normal startup', async () => {
    process.env['FORCE_RESET'] = 'true';
    mocks.fs.existsSync.mockReturnValue(false);
    await runWorker();
    expect(mocks.db.resetDb).toHaveBeenCalled();
    // Continues into normal startup — closeDb is called at the end
    expect(mocks.db.closeDb).toHaveBeenCalled();
  });
});

describe('worker main — --regen-audio', () => {
  it('deletes only .wav files and resets articles then exits 0', async () => {
    process.argv = ['node', 'worker', '--regen-audio'];
    mocks.fs.existsSync.mockReturnValue(true);
    mocks.fs.readdirSync.mockReturnValue(['a.wav', 'b.wav', 'notes.txt'] as unknown as string[]);
    mocks.articles.resetAllArticlesForRegen.mockReturnValue(5);
    await runWorker();
    expect(mocks.fs.rmSync).toHaveBeenCalledTimes(2);
    expect(mocks.articles.resetAllArticlesForRegen).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('still exits 0 when no wav files present', async () => {
    process.argv = ['node', 'worker', '--regen-audio'];
    mocks.fs.readdirSync.mockReturnValue([] as unknown as string[]);
    await runWorker();
    expect(mocks.fs.rmSync).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });
});

describe('worker main — --retry-failed', () => {
  it('resets failed articles then continues normal startup', async () => {
    process.argv = ['node', 'worker', '--retry-failed'];
    mocks.articles.resetFailedRetries.mockReturnValue(2);
    await runWorker();
    expect(mocks.articles.resetFailedRetries).toHaveBeenCalled();
    expect(mocks.logger.info).toHaveBeenCalledWith(expect.stringContaining('2 failed articles'));
    expect(mocks.db.closeDb).toHaveBeenCalled();
  });
});
