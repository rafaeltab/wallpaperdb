import { Effect } from 'effect';
import { expect } from 'vitest';
import type { ScheduleStore } from '../../src/capabilities/plan/index.js';
export async function scheduleContract(store: ScheduleStore, reopen: () => ScheduleStore) {
  expect(await Effect.runPromise(store.read())).toEqual({
    revision: -1,
    concurrency: 1,
    allowance: 1,
    paused: false,
    admissions: [],
  });
  const first = {
    revision: 0,
    concurrency: -1,
    allowance: 3,
    paused: true,
    resuming: [{ issue: 1, index: 0, questionId: 'q', run: { id: 'run-1', ordinal: 1 } }],
    admissions: [{ issue: 1, base: 'a'.repeat(40), context: 'Approved scope' }],
  };
  const competing = await Promise.all([
    Effect.runPromise(store.save(first)),
    Effect.runPromise(reopen().save({ ...first, concurrency: 2 })),
  ]);
  expect(competing.filter(Boolean)).toHaveLength(1);
  const read = await Effect.runPromise(reopen().read());
  expect(read).toMatchObject({
    revision: 0,
    allowance: 3,
    paused: true,
    resuming: [{ issue: 1, index: 0, questionId: 'q', run: { id: 'run-1', ordinal: 1 } }],
    admissions: first.admissions,
  });
  expect(await Effect.runPromise(store.save({ ...read, revision: 0 }))).toBe(false);
  expect(await Effect.runPromise(store.save({ ...read, revision: 1, paused: false }))).toBe(true);
  expect(await Effect.runPromise(reopen().read())).toEqual({ ...read, revision: 1, paused: false });
  const retry = {
    ...read,
    revision: 2,
    resuming: [
      { issue: 1, index: 1, runId: 'failed-review', run: { id: 'failed-review', ordinal: 2 } },
    ],
  };
  expect(await Effect.runPromise(store.save(retry))).toBe(true);
  expect(await Effect.runPromise(reopen().read())).toEqual(retry);
}
