import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../src/db/schema.js';
import { TEST_SCHEMA_SQL } from '../helpers/schema.js';
import { getWorkerState, setWorkerStatus } from '../../src/db/worker-state.js';
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

  it('seeds the singleton row if absent', () => {
    const sqlite = new Database(':memory:');
    sqlite.exec(`CREATE TABLE worker_state (
      id INTEGER PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'idle',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );`);
    const db = drizzle(sqlite, { schema }) as Db;
    const state = getWorkerState(db);
    expect(state.status).toBe('idle');
  });
});
