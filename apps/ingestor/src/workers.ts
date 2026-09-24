import { Cause, Clock, Effect, Layer, Metric } from 'effect';
import { recordCounter, recordHistogram } from '@wallpaperdb/core/telemetry';
import { Ingestion } from './ingestion/index.js';

function scheduled(name: string, intervalMs: number, task: Effect.Effect<unknown, unknown>) {
  const errors = Metric.counter('reconciliation.errors.total', {
    incremental: true,
    attributes: { 'reconciliation.type': name },
  });
  const cycle = Effect.gen(function* () {
    const start = yield* Clock.currentTimeMillis;
    yield* task.pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.failCause(cause)
          : Metric.update(errors, 1).pipe(
              Effect.andThen(
                Effect.logError('Ingestion recovery cycle failed', { operation: name })
              )
            )
      )
    );
    const end = yield* Clock.currentTimeMillis;
    yield* Effect.try(() => {
      recordCounter('reconciliation.cycles.total', 1, { 'reconciliation.type': name });
      recordHistogram('reconciliation.cycle_duration_ms', end - start, {
        'reconciliation.type': name,
      });
    }).pipe(Effect.ignore);
  }).pipe(Effect.withSpan(`ingestion.worker.${name}`));
  return Effect.sleep(intervalMs).pipe(Effect.andThen(cycle), Effect.forever, Effect.forkScoped);
}
/** Each loop owns one in-flight cycle; scope closure cancels sleepers and work before adapters close. */
export function reconciliationLayer(config: {
  reconciliationIntervalMs: number;
  s3CleanupIntervalMs: number;
}) {
  return Layer.effectDiscard(
    Effect.gen(function* () {
      const ingestion = yield* Ingestion;
      yield* scheduled(
        'uploads',
        config.reconciliationIntervalMs,
        ingestion.reconcile().pipe(
          Effect.tap((result) =>
            Effect.try(() =>
              recordCounter('reconciliation.records_processed.total', result.processed, {
                'reconciliation.type': 'uploads',
              })
            ).pipe(Effect.ignore)
          )
        )
      );
      yield* scheduled('assets', config.s3CleanupIntervalMs, ingestion.cleanup());
    })
  );
}
