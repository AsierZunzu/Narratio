import { eq, sql } from 'drizzle-orm';
import type { Db } from './index.js';
import { workerState } from './schema.js';
import type { WorkerState, WorkerStatus } from './schema.js';

export type { WorkerState, WorkerStatus } from './schema.js';

const SINGLETON_ID = 1;

export function getWorkerState(db: Db): WorkerState {
  const row = db.select().from(workerState).where(eq(workerState.id, SINGLETON_ID)).get();
  if (row) return row;
  // Defensive fallback: seed and re-fetch if the singleton row is missing.
  db.insert(workerState).values({ id: SINGLETON_ID, status: 'idle' }).onConflictDoNothing().run();
  const seeded = db.select().from(workerState).where(eq(workerState.id, SINGLETON_ID)).get();
  if (!seeded) throw new Error('worker_state singleton row could not be created');
  return seeded;
}

export function setWorkerStatus(db: Db, status: WorkerStatus): void {
  db.update(workerState)
    .set({ status, updated_at: sql`(datetime('now'))` })
    .where(eq(workerState.id, SINGLETON_ID))
    .run();
}

export type TriggerOutcome = 'queued' | 'already-pending' | 'already-running';

export function requestWorkerRun(db: Db): TriggerOutcome {
  const state = getWorkerState(db);
  if (state.status === 'running') return 'already-running';
  if (state.trigger_requested_at) return 'already-pending';
  db.update(workerState)
    .set({ trigger_requested_at: sql`(datetime('now'))` })
    .where(eq(workerState.id, SINGLETON_ID))
    .run();
  return 'queued';
}

export function consumeWorkerTrigger(db: Db): boolean {
  const state = getWorkerState(db);
  if (!state.trigger_requested_at) return false;
  db.update(workerState)
    .set({ trigger_requested_at: null })
    .where(eq(workerState.id, SINGLETON_ID))
    .run();
  return true;
}
