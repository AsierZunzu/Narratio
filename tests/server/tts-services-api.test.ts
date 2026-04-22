import { describe, it, expect } from 'vitest';
import request from 'supertest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import net from 'net';
import * as schema from '../../src/db/schema.js';
import { TEST_SCHEMA_SQL as SCHEMA_SQL } from '../helpers/schema.js';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { createApp } from '../../src/server/index.js';
import { insertFeed } from '../../src/db/feeds.js';
import { insertTtsService } from '../../src/db/tts-services.js';
import { resetDb } from '../../src/db/index.js';
import type { Db } from '../../src/db/index.js';

function makeTempDb(): { db: Db; dbPath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narratio-tts-api-'));
  const dbPath = path.join(dir, 'test.db');
  const sqlite = new Database(dbPath);
  sqlite.exec(SCHEMA_SQL);
  const db = drizzle(sqlite, { schema });
  return { db, dbPath };
}

const TTS_PAYLOAD = { name: 'My TTS', host: 'localhost', port: 10200 };

describe('POST /api/tts-services', () => {
  it('creates a TTS service and returns 201', async () => {
    resetDb();
    const { dbPath } = makeTempDb();
    const app = createApp(dbPath);
    const res = await request(app).post('/api/tts-services').send(TTS_PAYLOAD);
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('My TTS');
    expect(res.body.id).toBeTypeOf('number');
  });

  it('returns 400 for missing required fields', async () => {
    resetDb();
    const { dbPath } = makeTempDb();
    const app = createApp(dbPath);
    const res = await request(app).post('/api/tts-services').send({ name: 'Incomplete' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid port', async () => {
    resetDb();
    const { dbPath } = makeTempDb();
    const app = createApp(dbPath);
    const res = await request(app).post('/api/tts-services').send({ name: 'Bad', host: 'localhost', port: 99999 });
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/tts-services/:id', () => {
  it('updates a TTS service and returns the updated record', async () => {
    resetDb();
    const { db, dbPath } = makeTempDb();
    const svc = insertTtsService(db, TTS_PAYLOAD);
    db.$client.close();

    const app = createApp(dbPath);
    const res = await request(app).put(`/api/tts-services/${svc.id}`).send({ name: 'Updated' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Updated');
    expect(res.body.host).toBe('localhost');
  });

  it('returns 404 for unknown id', async () => {
    resetDb();
    const { dbPath } = makeTempDb();
    const app = createApp(dbPath);
    const res = await request(app).put('/api/tts-services/9999').send({ name: 'X' });
    expect(res.status).toBe(404);
  });

  it('returns 400 for invalid port in update', async () => {
    resetDb();
    const { db, dbPath } = makeTempDb();
    const svc = insertTtsService(db, TTS_PAYLOAD);
    db.$client.close();

    const app = createApp(dbPath);
    const res = await request(app).put(`/api/tts-services/${svc.id}`).send({ port: 0 });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/tts-services/:id', () => {
  it('deletes a TTS service with no feeds and returns 204', async () => {
    resetDb();
    const { db, dbPath } = makeTempDb();
    const svc = insertTtsService(db, TTS_PAYLOAD);
    db.$client.close();

    const app = createApp(dbPath);
    const res = await request(app).delete(`/api/tts-services/${svc.id}`);
    expect(res.status).toBe(204);

    const check = await request(app).get('/api/tts-services');
    expect(check.body.find((s: { id: number }) => s.id === svc.id)).toBeUndefined();
  });

  it('returns 404 for unknown id', async () => {
    resetDb();
    const { dbPath } = makeTempDb();
    const app = createApp(dbPath);
    const res = await request(app).delete('/api/tts-services/9999');
    expect(res.status).toBe(404);
  });

  it('returns 409 when a feed references the TTS service', async () => {
    resetDb();
    const { db, dbPath } = makeTempDb();
    const svc = insertTtsService(db, TTS_PAYLOAD);
    insertFeed(db, { name: 'F', rss_url: 'https://x.com/rss', slug: 'f', title: 'F', tts_service_id: svc.id });
    db.$client.close();

    const app = createApp(dbPath);
    const res = await request(app).delete(`/api/tts-services/${svc.id}`);
    expect(res.status).toBe(409);
  });
});

describe('POST /api/tts-services/test-connection', () => {
  it('returns 400 for missing host', async () => {
    resetDb();
    const { dbPath } = makeTempDb();
    const app = createApp(dbPath);
    const res = await request(app).post('/api/tts-services/test-connection').send({ port: 10200 });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('returns 400 for missing port', async () => {
    resetDb();
    const { dbPath } = makeTempDb();
    const app = createApp(dbPath);
    const res = await request(app).post('/api/tts-services/test-connection').send({ host: 'localhost' });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('returns 400 for invalid port', async () => {
    resetDb();
    const { dbPath } = makeTempDb();
    const app = createApp(dbPath);
    const res = await request(app).post('/api/tts-services/test-connection').send({ host: 'localhost', port: 99999 });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('returns ok:false when connection is refused', async () => {
    resetDb();
    const { dbPath } = makeTempDb();
    const app = createApp(dbPath);
    // Port 1 is almost never open and connection-refused arrives quickly
    const res = await request(app)
      .post('/api/tts-services/test-connection')
      .send({ host: '127.0.0.1', port: 1 })
      .timeout(10000);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(typeof res.body.message).toBe('string');
  });

  it('returns ok:true when connection succeeds', async () => {
    resetDb();
    const { dbPath } = makeTempDb();
    const app = createApp(dbPath);

    // Spin up a minimal TCP server on a random port
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as net.AddressInfo).port;

    try {
      const res = await request(app)
        .post('/api/tts-services/test-connection')
        .send({ host: '127.0.0.1', port });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(typeof res.body.message).toBe('string');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
