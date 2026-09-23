import { expect, it } from '@effect/vitest';
import { Effect, Layer } from 'effect';
import { TestClock } from 'effect/testing';
import { Ingestion, IngestionUnavailable } from '../../src/ingestion/index.js';
import { reconciliationLayer } from '../../src/workers.js';
it.effect('runs independent recovery schedules without overlapping a running cycle', () => {
  let cycles = 0;
  let cleaned = 0;
  const ingestion = Layer.succeed(Ingestion, {
    upload: () => Effect.succeed({ _tag: 'InProgress' }),
    reconcile: () =>
      Effect.sync(() => {
        cycles++;
      }).pipe(Effect.andThen(Effect.sleep(2000)), Effect.as({ processed: 1 })),
    cleanup: () =>
      Effect.sync(() => {
        cleaned++;
      }),
  });
  return Effect.gen(function* () {
    yield* TestClock.adjust(1000);
    expect(cycles).toBe(1);
    expect(cleaned).toBe(0);
    yield* TestClock.adjust(1000);
    expect(cycles).toBe(1);
    expect(cleaned).toBe(1);
    yield* TestClock.adjust(2000);
    expect(cycles).toBe(2);
    expect(cleaned).toBe(2);
  }).pipe(
    Effect.provide(
      reconciliationLayer({ reconciliationIntervalMs: 1000, s3CleanupIntervalMs: 2000 })
    ),
    Effect.provide(ingestion)
  );
});
it.effect('retries failed cycles and interrupts cleanup when the owning scope closes', () =>
  Effect.gen(function* () {
    let cycles = 0;
    let cleanupInterrupted = false;
    const ingestion = Layer.succeed(Ingestion, {
      upload: () => Effect.succeed({ _tag: 'InProgress' }),
      reconcile: () =>
        Effect.sync(() => {
          cycles++;
        }).pipe(
          Effect.andThen(
            Effect.fail(
              new IngestionUnavailable({
                operation: 'reconcile',
                cause: new Error('controlled failure'),
              })
            )
          )
        ),
      cleanup: () =>
        Effect.never.pipe(
          Effect.onInterrupt(() =>
            Effect.sync(() => {
              cleanupInterrupted = true;
            })
          )
        ),
    });
    yield* Effect.gen(function* () {
      yield* TestClock.adjust(2000);
      expect(cycles).toBe(2);
    }).pipe(
      Effect.provide(
        reconciliationLayer({ reconciliationIntervalMs: 1000, s3CleanupIntervalMs: 1000 })
      ),
      Effect.provide(ingestion)
    );
    expect(cleanupInterrupted).toBe(true);
    yield* TestClock.adjust(2000);
    expect(cycles).toBe(2);
  })
);
