import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { expect, it } from 'vitest';
import { sqliteObservationCheckpoints } from '../src/adapters/store/index.js';
import { initializeState } from '../src/platform/index.js';

it('reopens applied observations with their cursor and rejects obsolete publishers', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'factory-checkpoints-'));
  try {
    initializeState(directory);
    const first = sqliteObservationCheckpoints(directory);
    expect(await Effect.runPromise(first.read('owner'))).toBeNull();
    expect(
      await Effect.runPromise(first.publish('owner', 0, { sequence: 10, value: 'pending' }))
    ).toBe(true);
    const reopened = sqliteObservationCheckpoints(directory);
    expect(await Effect.runPromise(reopened.read('owner'))).toEqual({
      revision: 1,
      sequence: 10,
      value: 'pending',
    });
    expect(
      await Effect.runPromise(reopened.publish('owner', 1, { sequence: 15, value: 'complete' }))
    ).toBe(true);
    expect(
      await Effect.runPromise(
        first.publish('owner', 1, { sequence: 16, value: 'obsolete snapshot' })
      )
    ).toBe(false);
    expect(
      await Effect.runPromise(first.publish('owner', 2, { sequence: 10, value: 'replay' }))
    ).toBe(false);
    expect(await Effect.runPromise(reopened.read('owner'))).toEqual({
      revision: 2,
      sequence: 15,
      value: 'complete',
    });
    expect(await Effect.runPromise(reopened.read('unrelated'))).toBeNull();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it('publishes only changed entities with their cursor, retains unchanged facts and fences obsolete deltas', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'factory-observation-entities-'));
  try {
    initializeState(directory);
    const store = sqliteObservationCheckpoints(directory);
    expect(
      await Effect.runPromise(
        store.publish('owner', 0, {
          sequence: 10,
          value: 'snapshot',
          replaceEntities: true,
          entities: [
            { id: 'activity', value: 'pending' },
            { id: 'receipt', value: 'retained' },
          ],
        })
      )
    ).toBe(true);
    expect(
      await Effect.runPromise(
        store.publish('owner', 1, {
          sequence: 15,
          value: 'updated',
          entities: [{ id: 'activity', value: 'complete' }],
        })
      )
    ).toBe(true);
    expect(
      await Effect.runPromise(
        store.publish('owner', 1, {
          sequence: 16,
          value: 'obsolete',
          entities: [{ id: 'receipt', value: 'wrong' }],
        })
      )
    ).toBe(false);
    const reopened = sqliteObservationCheckpoints(directory);
    expect(await Effect.runPromise(reopened.read('owner'))).toEqual({
      revision: 2,
      sequence: 15,
      value: 'updated',
      entities: [
        { id: 'activity', value: 'complete' },
        { id: 'receipt', value: 'retained' },
      ],
    });
    expect(
      await Effect.runPromise(
        reopened.publish('owner', 2, {
          sequence: 20,
          value: 'replacement',
          replaceEntities: true,
          entities: [{ id: 'receipt', value: 'new' }],
        })
      )
    ).toBe(true);
    expect(await Effect.runPromise(reopened.read('owner'))).toEqual({
      revision: 3,
      sequence: 20,
      value: 'replacement',
      entities: [{ id: 'receipt', value: 'new' }],
    });
    expect(
      await Effect.runPromise(
        reopened.publish('owner', 3, {
          sequence: 21,
          value: 'removed',
          entities: [{ id: 'receipt', value: null }],
        })
      )
    ).toBe(true);
    expect(await Effect.runPromise(reopened.read('owner'))).toEqual({
      revision: 4,
      sequence: 21,
      value: 'removed',
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
