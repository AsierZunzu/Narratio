import { eq } from 'drizzle-orm';
import type { Db } from './index.js';
import { ttsServices } from './schema.js';

export type { TtsService } from './schema.js';

export interface InsertTtsServiceParams {
  name: string;
  host: string;
  port: number;
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
