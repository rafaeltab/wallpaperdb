import { Effect, Layer } from 'effect';
import { Cleanup, CleanupBytes, CleanupStore } from './contract.js';

export const cleanupLayer = Layer.effect(
  Cleanup,
  Effect.gen(function* () {
    const store = yield* CleanupStore;
    const bytes = yield* CleanupBytes;
    return {
      run: Effect.fn('asset.cleanup.run')(function* (limit) {
        let completed = 0,
          failed = 0;
        for (const work of yield* store.claim(Math.max(1, Math.min(100, Math.floor(limit))))) {
          const reclaimed = yield* bytes.reclaim(work.target, work).pipe(
            Effect.as(true),
            Effect.catch(() => Effect.succeed(false))
          );
          if (reclaimed) {
            yield* store.completed(work);
            completed++;
          } else {
            yield* store.failed(work);
            failed++;
          }
        }
        return { completed, failed };
      }),
    };
  })
);
