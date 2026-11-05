import { Effect } from 'effect';
import { expect, it } from 'vitest';
import type { ObservationStore, Facts } from '../../src/capabilities/observe/index.js';
const facts: Facts = {
  issues: [
    {
      number: 1,
      url: 'https://github.com/rafaeltab/wallpaperdb/issues/1',
      title: 'Complete issue',
      open: true,
      candidate: true,
      labels: ['ready-for-agent'],
      assignees: ['rafaeltab'],
      projectStatus: 'Todo',
      projectPriority: 'P1',
      projectSize: 'S',
      commentCount: 4,
      blockers: [],
      parents: [],
      pullRequests: [],
    },
  ],
  pullRequests: [],
};
export function observationStoreContract(
  name: string,
  open: () => Promise<{ store: ObservationStore; close(): Promise<void> }>
) {
  it(`${name} starts with unknown external data`, async () => {
    const { store, close } = await open();
    try {
      expect(await Effect.runPromise(store.read())).toEqual({});
    } finally {
      await close();
    }
  });
  it(`${name} preserves useful facts and original dates on failed refresh, then clears failure on recovery`, async () => {
    const { store, close } = await open();
    try {
      await Effect.runPromise(store.refresh({ startedAt: 10, observedAt: 20, facts }));
      await Effect.runPromise(store.refresh({ startedAt: 30 }));
      expect(await Effect.runPromise(store.read())).toMatchObject({
        startedAt: 30,
        observedAt: 20,
        facts,
      });
      await Effect.runPromise(store.refresh({ startedAt: 30, failedAt: 40, error: 'offline' }));
      expect(await Effect.runPromise(store.read())).toMatchObject({
        observedAt: 20,
        failedAt: 40,
        error: 'offline',
        facts,
      });
      await Effect.runPromise(
        store.refresh({ startedAt: 50, observedAt: 60, facts: { issues: [], pullRequests: [] } })
      );
      expect(await Effect.runPromise(store.read())).toMatchObject({
        observedAt: 60,
        error: undefined,
        failedAt: undefined,
        facts: { issues: [], pullRequests: [] },
      });
    } finally {
      await close();
    }
  });
  it(`${name} dates worker observations independently of GitHub facts`, async () => {
    const { store, close } = await open();
    try {
      await Effect.runPromise(store.refresh({ startedAt: 10, observedAt: 20, facts }));
      await Effect.runPromise(store.jobs([{ kind: 'empty' }], 30, []));
      expect(await Effect.runPromise(store.read())).toMatchObject({
        observedAt: 20,
        jobsObservedAt: 30,
        jobs: [{ kind: 'empty' }],
        recoveries: [],
        facts,
      });
    } finally {
      await close();
    }
  });
}
