import { Effect } from 'effect';
import { expect } from 'vitest';
import type { AttemptStore } from '../../src/capabilities/plan/index.js';
/** Shared atomic exclusion/CAS/deadline guarantees used by capability controls and SQLite. */
export async function attemptStoreContract(store: AttemptStore) {
  const first = {
    id: 'ffffffff-ffff-4fff-bfff-ffffffffffff',
    revision: 0,
    startedAt: 1000,
    deadline: 121000,
    phase: 'discovery' as const,
  };
  const second = { ...first, id: '00000000-0000-4000-8000-000000000000', startedAt: 900 };
  expect(await Effect.runPromise(store.create(first))).toBe(true);
  expect(await Effect.runPromise(store.create(second))).toBe(false);
  expect(await Effect.runPromise(store.get(first.id))).toEqual(first);
  expect(await Effect.runPromise(store.save({ ...first, revision: 1, deadline: 122000 }))).toBe(
    false
  );
  expect(
    await Effect.runPromise(
      store.save({ ...first, revision: 1, phase: 'failed', finishedAt: 1100 })
    )
  ).toBe(true);
  expect(await Effect.runPromise(store.save({ ...first, revision: 1, phase: 'freshness' }))).toBe(
    false
  );
  expect(await Effect.runPromise(store.create(second))).toBe(true);
  expect(await Effect.runPromise(store.pending())).toEqual(second);
}
