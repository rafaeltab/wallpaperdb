import { Effect } from 'effect';
import { expect, it } from 'vitest';
import type { ThreadStore } from '../../src/capabilities/observe/index.js';
export function threadStoreContract(
  name: string,
  open: () => Promise<{ store: ThreadStore; close(): Promise<void> }>
) {
  it(`${name} starts with unknown metadata`, async () => {
    const { store, close } = await open();
    try {
      expect(await Effect.runPromise(store.read())).toEqual({});
    } finally {
      await close();
    }
  });
  it(`${name} replaces the whole snapshot and removes obsolete failure and loading fields`, async () => {
    const { store, close } = await open();
    try {
      await Effect.runPromise(
        store.save({
          startedAt: 19,
          observedAt: 10,
          failedAt: 20,
          error: 'offline',
          facts: { environmentId: 'env', projectId: 'project', threads: [] },
        })
      );
      expect(await Effect.runPromise(store.read())).toEqual({
        startedAt: 19,
        observedAt: 10,
        failedAt: 20,
        error: 'offline',
        facts: { environmentId: 'env', projectId: 'project', threads: [] },
      });
      await Effect.runPromise(
        store.save({
          observedAt: 30,
          facts: { environmentId: 'env', projectId: 'project', threads: [] },
        })
      );
      expect(await Effect.runPromise(store.read())).toEqual({
        observedAt: 30,
        facts: { environmentId: 'env', projectId: 'project', threads: [] },
      });
      await Effect.runPromise(store.save({}));
      expect(await Effect.runPromise(store.read())).toEqual({});
    } finally {
      await close();
    }
  });
}
