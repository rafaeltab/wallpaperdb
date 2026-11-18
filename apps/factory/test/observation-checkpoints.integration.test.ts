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
