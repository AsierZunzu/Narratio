import { eq, and } from 'drizzle-orm';
import type { Db } from './index.js';
import { ttsServices } from './schema.js';

export type { TtsService } from './schema.js';

export interface InsertTtsServiceParams {
  name: string;
  host: string;
  port: number;
  voice?: string | null;
  languages?: string | null;
}

export type UpdateTtsServiceParams = Partial<InsertTtsServiceParams>;

export function getTtsServices(db: Db) {
  return db.select().from(ttsServices).all();
}

export function getTtsServiceById(db: Db, id: number) {
  return db.select().from(ttsServices).where(eq(ttsServices.id, id)).get();
}

export function insertTtsService(db: Db, params: InsertTtsServiceParams) {
  const result = db.insert(ttsServices).values(params).returning().get();
  if (!result) throw new Error('Failed to insert TTS service');
  return result;
}

export function updateTtsService(db: Db, id: number, params: UpdateTtsServiceParams) {
  return db.update(ttsServices).set(params).where(eq(ttsServices.id, id)).returning().get();
}

export function deleteTtsService(db: Db, id: number): boolean {
  const result = db.delete(ttsServices).where(eq(ttsServices.id, id)).run();
  return result.changes > 0;
}

export function getTtsServiceByHostPort(db: Db, host: string, port: number) {
  return db.select().from(ttsServices).where(and(eq(ttsServices.host, host), eq(ttsServices.port, port))).get();
}

export function upsertTtsServiceByHostPort(
  db: Db,
  host: string,
  port: number,
  voice: string,
  languages: string[],
): import('./schema.js').TtsService {
  const existing = getTtsServiceByHostPort(db, host, port);
  const languagesJson = JSON.stringify(languages);
  if (existing) {
    const updated = db
      .update(ttsServices)
      .set({ voice, languages: languagesJson })
      .where(eq(ttsServices.id, existing.id))
      .returning()
      .get();
    if (!updated) throw new Error(`Failed to update TTS service id=${existing.id}`);
    return updated;
  }
  const result = db
    .insert(ttsServices)
    .values({ name: `${voice} (${host}:${port})`, host, port, voice, languages: languagesJson })
    .returning()
    .get();
  if (!result) throw new Error('Failed to insert TTS service');
  return result;
}
