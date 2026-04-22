import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../src/db/schema.js';
import { TEST_SCHEMA_SQL } from '../helpers/schema.js';
import {
  getTtsServices,
  getTtsServiceById,
  insertTtsService,
  updateTtsService,
  deleteTtsService,
} from '../../src/db/tts-services.js';
import type { Db } from '../../src/db/index.js';

function makeDb(): Db {
  const sqlite = new Database(':memory:');
  sqlite.exec(TEST_SCHEMA_SQL);
  return drizzle(sqlite, { schema });
}

const BASE_SERVICE = { name: 'Piper EN', host: '127.0.0.1', port: 10200 };

describe('insertTtsService', () => {
  it('inserts and returns the new service', () => {
    const db = makeDb();
    const svc = insertTtsService(db, BASE_SERVICE);
    expect(svc.id).toBeGreaterThan(0);
    expect(svc.name).toBe('Piper EN');
    expect(svc.host).toBe('127.0.0.1');
    expect(svc.port).toBe(10200);
  });

  it('assigns incrementing ids', () => {
    const db = makeDb();
    const a = insertTtsService(db, BASE_SERVICE);
    const b = insertTtsService(db, { ...BASE_SERVICE, name: 'Piper ES', port: 10201 });
    expect(b.id).toBeGreaterThan(a.id);
  });
});

describe('getTtsServices', () => {
  it('returns all services', () => {
    const db = makeDb();
    insertTtsService(db, BASE_SERVICE);
    insertTtsService(db, { ...BASE_SERVICE, name: 'Piper ES', port: 10201 });
    expect(getTtsServices(db)).toHaveLength(2);
  });

  it('returns empty array when none', () => {
    const db = makeDb();
    expect(getTtsServices(db)).toHaveLength(0);
  });
});

describe('getTtsServiceById', () => {
  it('returns service by id', () => {
    const db = makeDb();
    const created = insertTtsService(db, BASE_SERVICE);
    const found = getTtsServiceById(db, created.id);
    expect(found?.name).toBe('Piper EN');
  });

  it('returns undefined for unknown id', () => {
    const db = makeDb();
    expect(getTtsServiceById(db, 999)).toBeUndefined();
  });
});

describe('updateTtsService', () => {
  it('updates specified fields', () => {
    const db = makeDb();
    const created = insertTtsService(db, BASE_SERVICE);
    const updated = updateTtsService(db, created.id, { port: 10300, name: 'Piper v2' });
    expect(updated?.port).toBe(10300);
    expect(updated?.name).toBe('Piper v2');
    expect(updated?.host).toBe('127.0.0.1');
  });

  it('returns undefined for unknown id', () => {
    const db = makeDb();
    expect(updateTtsService(db, 999, { port: 9999 })).toBeUndefined();
  });
});

describe('deleteTtsService', () => {
  it('removes the service and returns true', () => {
    const db = makeDb();
    const created = insertTtsService(db, BASE_SERVICE);
    expect(deleteTtsService(db, created.id)).toBe(true);
    expect(getTtsServiceById(db, created.id)).toBeUndefined();
  });

  it('returns false for unknown id', () => {
    const db = makeDb();
    expect(deleteTtsService(db, 999)).toBe(false);
  });
});
