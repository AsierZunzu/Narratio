import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../src/db/schema.js';
import { TEST_SCHEMA_SQL as SCHEMA_SQL } from '../helpers/schema.js';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { createApp } from '../../src/server/index.js';
import { resetDb } from '../../src/db/index.js';
import type { Db } from '../../src/db/index.js';

// Server resolves AUDIO_DIR against cwd at createApp() time, so chdir into a
// tmpdir for the duration of this test file and populate <tmp>/data/audio.
let tmpRoot: string;
let audioDir: string;
let origCwd: string;
let symlinksSupported = true;
let externalSymlinkSupported = true;

function makeTempDb(): { db: Db; dbPath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narratio-audio-db-'));
  const dbPath = path.join(dir, 'test.db');
  const sqlite = new Database(dbPath);
  sqlite.exec(SCHEMA_SQL);
  const db = drizzle(sqlite, { schema });
  return { db, dbPath };
}

beforeAll(() => {
  origCwd = process.cwd();
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'narratio-audio-route-'));
  audioDir = path.join(tmpRoot, 'data', 'audio');
  fs.mkdirSync(audioDir, { recursive: true });

  fs.writeFileSync(path.join(audioDir, 'sample.wav'), Buffer.from('RIFFxxxxWAVEdata'));
  fs.writeFileSync(path.join(audioDir, '.hidden.wav'), Buffer.from('x'));

  try {
    fs.symlinkSync(path.join(audioDir, 'sample.wav'), path.join(audioDir, 'link.wav'));
  } catch {
    symlinksSupported = false;
  }

  const outside = path.join(tmpRoot, 'outside-secret.txt');
  fs.writeFileSync(outside, 'top-secret');
  try {
    fs.symlinkSync(outside, path.join(audioDir, 'escape.wav'));
  } catch {
    externalSymlinkSupported = false;
  }

  process.chdir(tmpRoot);
});

afterAll(() => {
  process.chdir(origCwd);
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

beforeEach(() => {
  resetDb();
});

describe('GET /audio/:file', () => {
  it('returns 200 for a normal file', async () => {
    const { dbPath } = makeTempDb();
    const app = createApp(dbPath);
    const res = await request(app).get('/audio/sample.wav');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/audio\/wav/);
  });

  it('returns 404 for percent-encoded traversal (..%2Fetc%2Fpasswd)', async () => {
    const { dbPath } = makeTempDb();
    const app = createApp(dbPath);
    const res = await request(app).get('/audio/..%2Fetc%2Fpasswd');
    expect(res.status).toBe(404);
  });

  it('returns 404 for nested path segments', async () => {
    const { dbPath } = makeTempDb();
    const app = createApp(dbPath);
    const res = await request(app).get('/audio/sub%2Ffile.wav');
    expect(res.status).toBe(404);
  });

  it('returns 404 for backslash in filename', async () => {
    const { dbPath } = makeTempDb();
    const app = createApp(dbPath);
    const res = await request(app).get('/audio/sub%5Cfile.wav');
    expect(res.status).toBe(404);
  });

  it('returns 404 for dotfile', async () => {
    const { dbPath } = makeTempDb();
    const app = createApp(dbPath);
    const res = await request(app).get('/audio/.hidden.wav');
    expect(res.status).toBe(404);
  });

  it('returns 404 for symlink that escapes audio dir', async () => {
    if (!externalSymlinkSupported) return;
    const { dbPath } = makeTempDb();
    const app = createApp(dbPath);
    const res = await request(app).get('/audio/escape.wav');
    expect(res.status).toBe(404);
  });

  it('returns 200 for internal symlink within audio dir', async () => {
    if (!symlinksSupported) return;
    const { dbPath } = makeTempDb();
    const app = createApp(dbPath);
    const res = await request(app).get('/audio/link.wav');
    expect(res.status).toBe(200);
  });

  it('returns 404 for missing file', async () => {
    const { dbPath } = makeTempDb();
    const app = createApp(dbPath);
    const res = await request(app).get('/audio/does-not-exist.wav');
    expect(res.status).toBe(404);
  });
});
