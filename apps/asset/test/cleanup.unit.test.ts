import { Effect, Layer, ManagedRuntime } from 'effect';
import { expect, it } from 'vitest';
import {
  Cleanup,
  CleanupBytes,
  CleanupFailure,
  CleanupStore,
  cleanupLayer,
  type CleanupWork,
} from '../src/capabilities/cleanup/index.js';

it('finishes exact reclaimed identities and leaves failed responsibilities durably retryable', async () => {
  const first: CleanupWork = {
    id: 'first',
    leaseId: 'lease-1',
    attempts: 1,
    target: { kind: 'candidate', candidateId: 'old' },
  };
  const second: CleanupWork = {
    id: 'second',
    leaseId: 'lease-2',
    attempts: 1,
    target: { kind: 'source', assetId: 'asset', sourceId: 'retired' },
  };
  const completed: string[] = [],
    failed: string[] = [];
  const runtime = ManagedRuntime.make(
    cleanupLayer.pipe(
      Layer.provide(
        Layer.merge(
          Layer.succeed(CleanupStore, {
            claim: () => Effect.succeed([first, second]),
            completed: (work) =>
              Effect.sync(() => {
                completed.push(work.id);
              }),
            failed: (work) =>
              Effect.sync(() => {
                failed.push(work.id);
              }),
            pendingAlerts: () => Effect.succeed([]),
            alerted: () => Effect.void,
            recover: () => Effect.succeed(false),
          }),
          Layer.succeed(CleanupBytes, {
            reclaim: (target) =>
              target.kind === 'candidate'
                ? Effect.void
                : Effect.fail(
                    new CleanupFailure({ operation: 'reclaim', cause: 'storage offline' })
                  ),
          })
        )
      )
    )
  );
  try {
    expect(await runtime.runPromise(Cleanup.use((cleanup) => cleanup.run(10)))).toEqual({
      completed: 1,
      failed: 1,
    });
    expect(completed).toEqual(['first']);
    expect(failed).toEqual(['second']);
  } finally {
    await runtime.dispose();
  }
});
