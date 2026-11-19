import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { expect, it, vi } from 'vitest';
import { z } from 'zod';
import { t3Observations } from '../src/adapters/t3/index.js';
import { sqliteObservationCheckpoints } from '../src/adapters/store/index.js';
import { initializeState } from '../src/platform/index.js';
import { websocketProtocol } from './fixtures/websocket.js';

it('replaces a rejected observer credential and synchronizes without losing retained facts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'factory-observer-rejection-'));
  initializeState(directory);
  const host = await websocketProtocol((raw, send) => {
    const request = z
      .object({ _tag: z.string(), id: z.string().optional(), tag: z.string().optional() })
      .parse(raw);
    if (request._tag !== 'Request') return;
    if (request.tag === 'orchestration.getArchivedShellSnapshot')
      send({
        _tag: 'Exit',
        requestId: request.id,
        exit: { _tag: 'Success', value: { snapshotSequence: 10, threads: [] } },
      });
    else
      send({
        _tag: 'Chunk',
        requestId: request.id,
        values: [
          {
            kind: 'snapshot',
            snapshot: { snapshotSequence: 10, threads: [], archivedThreads: [], projects: [] },
          },
          { kind: 'synchronized' },
        ],
      });
  });
  const replacements: boolean[] = [];
  let accepted = false;
  const checkpoints = sqliteObservationCheckpoints(directory);
  await Effect.runPromise(
    checkpoints.publish('unrelated-retained-fact', 0, { sequence: 5, value: 'preserved' })
  );
  const observer = await t3Observations({
    origin: host.origin,
    checkpoints,
    credential: async (replace) => {
      replacements.push(Boolean(replace));
      accepted ||= Boolean(replace);
      return {
        token: accepted ? 'controlled-observer' : 'rejected',
        expiresAt: Date.now() + 86400000,
      };
    },
    report: () => undefined,
  });
  try {
    expect(observer.inventoryReady()).toBe(false);
    await vi.waitFor(() => expect(observer.inventoryReady()).toBe(true), { timeout: 5000 });
    expect(replacements).toContain(true);
    expect(await Effect.runPromise(checkpoints.read('unrelated-retained-fact'))).toMatchObject({
      sequence: 5,
      value: 'preserved',
    });
  } finally {
    await observer.close();
    await host.close();
    await rm(directory, { recursive: true, force: true });
  }
});
