import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../src/db/schema.js';
import { TEST_SCHEMA_SQL } from '../helpers/schema.js';
import { getWorkerState, setWorkerStatus, requestWorkerRun, consumeWorkerTrigger } from '../../src/db/worker-state.js';
import type { Db } from '../../src/db/index.js';

function makeDb(): Db {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(TEST_SCHEMA_SQL);
  return drizzle(sqlite, { schema });
}

describe('worker-state db helpers', () => {
  it('returns idle by default', () => {
    const db = makeDb();
    const state = getWorkerState(db);
    expect(state.status).toBe('idle');
    expect(state.id).toBe(1);
    expect(typeof state.updated_at).toBe('string');
  });

  it('round-trips status updates', () => {
    const db = makeDb();
    setWorkerStatus(db, 'running');
    expect(getWorkerState(db).status).toBe('running');
    setWorkerStatus(db, 'idle');
    expect(getWorkerState(db).status).toBe('idle');
  });

  it('bumps updated_at when status changes', async () => {
    const db = makeDb();
    const before = getWorkerState(db).updated_at;
    // SQLite datetime('now') has 1-second resolution. Wait long enough to observe a bump.
    await new Promise((r) => setTimeout(r, 1100));
    setWorkerStatus(db, 'running');
    const after = getWorkerState(db).updated_at;
    expect(after >= before).toBe(true);
    expect(after).not.toBe(before);
  });

  it('queues a trigger when idle and consumes it once', () => {
    const db = makeDb();
    expect(getWorkerState(db).trigger_requested_at).toBeNull();
    expect(requestWorkerRun(db)).toBe('queued');
    expect(getWorkerState(db).trigger_requested_at).toBeTruthy();
    expect(consumeWorkerTrigger(db)).toBe(true);
    expect(getWorkerState(db).trigger_requested_at).toBeNull();
    expect(consumeWorkerTrigger(db)).toBe(false);
  });

  it('reports already-pending when a trigger is already queued', () => {
    const db = makeDb();
    expect(requestWorkerRun(db)).toBe('queued');
    expect(requestWorkerRun(db)).toBe('already-pending');
  });

  it('reports already-running and does not queue when worker is busy', () => {
    const db = makeDb();
    setWorkerStatus(db, 'running');
    expect(requestWorkerRun(db)).toBe('already-running');
    expect(getWorkerState(db).trigger_requested_at).toBeNull();
  });

  it('seeds the singleton row if absent', () => {
    const sqlite = new Database(':memory:');
    sqlite.exec(`CREATE TABLE worker_state (
      id INTEGER PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'idle',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      trigger_requested_at TEXT
    );`);
    const db = drizzle(sqlite, { schema }) as Db;
    const state = getWorkerState(db);
    expect(state.status).toBe('idle');
  });
});
