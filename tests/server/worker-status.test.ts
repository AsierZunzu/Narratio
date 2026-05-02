import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../src/db/schema.js';
import { TEST_SCHEMA_SQL as SCHEMA_SQL } from '../helpers/schema.js';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { createApp } from '../../src/server/index.js';
import { setWorkerStatus } from '../../src/db/worker-state.js';
import { resetDb } from '../../src/db/index.js';
import type { Db } from '../../src/db/index.js';

function makeTempDb(): { db: Db; dbPath: string; sqlite: Database.Database } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narratio-worker-status-'));
  const dbPath = path.join(dir, 'test.db');
  const sqlite = new Database(dbPath);
  sqlite.exec(SCHEMA_SQL);
  const db = drizzle(sqlite, { schema });
  return { db, dbPath, sqlite };
}

describe('GET /api/worker/status', () => {
  const originalPoll = process.env['POLL_INTERVAL'];

  beforeEach(() => {
    delete process.env['POLL_INTERVAL'];
    resetDb();
  });

  afterEach(() => {
    if (originalPoll === undefined) delete process.env['POLL_INTERVAL'];
    else process.env['POLL_INTERVAL'] = originalPoll;
    resetDb();
  });

  it('returns idle with nextRunAt:null when POLL_INTERVAL is unset', async () => {
    const { sqlite, dbPath } = makeTempDb();
    sqlite.close();

    const app = createApp(dbPath);
    const res = await request(app).get('/api/worker/status');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'idle', nextRunAt: null, pollInterval: null });
  });

  it('returns a future ISO nextRunAt when POLL_INTERVAL is a valid cron', async () => {
    process.env['POLL_INTERVAL'] = '*/5 * * * *';
    const { sqlite, dbPath } = makeTempDb();
    sqlite.close();

    const app = createApp(dbPath);
    const res = await request(app).get('/api/worker/status');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('idle');
    expect(res.body.pollInterval).toBe('*/5 * * * *');
    expect(typeof res.body.nextRunAt).toBe('string');
    const next = new Date(res.body.nextRunAt as string).getTime();
    expect(Number.isFinite(next)).toBe(true);
    expect(next).toBeGreaterThan(Date.now() - 1000);
  });

  it('returns running state with since when worker is busy', async () => {
    const { db, sqlite, dbPath } = makeTempDb();
    setWorkerStatus(db, 'running');
    sqlite.close();

    const app = createApp(dbPath);
    const res = await request(app).get('/api/worker/status');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('running');
    expect(typeof res.body.since).toBe('string');
  });

  it('returns nextRunAt:null without 500 on invalid cron', async () => {
    process.env['POLL_INTERVAL'] = 'not-a-cron-expression';
    const { sqlite, dbPath } = makeTempDb();
    sqlite.close();

    const app = createApp(dbPath);
    const res = await request(app).get('/api/worker/status');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('idle');
    expect(res.body.nextRunAt).toBeNull();
  });
});
