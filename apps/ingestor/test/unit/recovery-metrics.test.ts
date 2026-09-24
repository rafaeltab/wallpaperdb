import { expect, it } from '@effect/vitest';
import { OtelMetrics, Resource } from '@effect/opentelemetry';
import { Effect, Layer, Metric } from 'effect';
import { TestClock } from 'effect/testing';
import { Ingestion, IngestionUnavailable } from '../../src/ingestion/index.js';
import { reconciliationLayer } from '../../src/workers.js';
import { fixture, uploadInput } from '../helpers/ingestion.js';

const unavailable = new IngestionUnavailable({
  operation: 'controlled',
  cause: new Error('offline'),
});
function exportedErrors<A, E, R>(program: Effect.Effect<A, E, R>) {
  return Effect.gen(function* () {
    const producer = yield* OtelMetrics.makeProducer();
    yield* program;
    const collected = yield* Effect.promise(() => producer.collect());
    return collected.resourceMetrics.scopeMetrics.flatMap((scope) =>
      scope.metrics
        .filter((metric) => metric.descriptor.name === 'reconciliation.errors.total')
        .flatMap((metric) =>
          metric.dataPoints.map((point) => ({
            type: point.attributes['reconciliation.type'],
            value: point.value,
          }))
        )
    );
  }).pipe(
    Effect.provide(Resource.layer({ serviceName: 'ingestor-metrics-contract' })),
    Effect.provideService(Metric.MetricRegistry, new Map())
  );
}

it.effect('exports recovery cycle errors without counting shutdown interruption', () => {
  let cleanupCycles = 0;
  const ingestion = Layer.succeed(Ingestion, {
    upload: () => Effect.succeed({ _tag: 'InProgress' }),
    reconcile: () => Effect.fail(unavailable),
    cleanup: () =>
      Effect.suspend(() => (++cleanupCycles === 1 ? Effect.fail(unavailable) : Effect.never)),
  });
  return Effect.gen(function* () {
    const errors = yield* exportedErrors(
      TestClock.adjust(2000).pipe(
        Effect.provide(
          reconciliationLayer({ reconciliationIntervalMs: 1000, s3CleanupIntervalMs: 1000 })
        ),
        Effect.provide(ingestion)
      )
    );
    expect(errors).toEqual(
      expect.arrayContaining([
        { type: 'uploads', value: 2 },
        { type: 'assets', value: 1 },
      ])
    );
    expect(errors).toHaveLength(2);
  });
});

it.effect('exports one recovery error when publication fails and is deferred', () => {
  const controlled = fixture({ events: { publish: () => Effect.fail(unavailable) } });
  return Effect.gen(function* () {
    const errors = yield* exportedErrors(
      Effect.gen(function* () {
        const ingestion = yield* Ingestion;
        yield* ingestion.upload(uploadInput);
        yield* controlled.advance();
        yield* ingestion.reconcile();
      }).pipe(Effect.provide(controlled.layer))
    );
    expect(errors).toEqual([{ type: 'uploads', value: 1 }]);
  });
});

it.effect('exports an isolated record failure when its asset cannot be inspected', () => {
  const controlled = fixture({
    storage: {
      put: () => Effect.fail(unavailable),
      exists: () => Effect.fail(unavailable),
    },
  });
  return Effect.gen(function* () {
    const errors = yield* exportedErrors(
      Effect.gen(function* () {
        const ingestion = yield* Ingestion;
        yield* ingestion.upload(uploadInput).pipe(Effect.exit);
        yield* controlled.advance();
        expect(yield* ingestion.reconcile()).toEqual({ processed: 0 });
      }).pipe(Effect.provide(controlled.layer))
    );
    expect(errors).toEqual([{ type: 'uploads', value: 1 }]);
  });
});

it.effect('exports an isolated cleanup error while completing the cycle', () => {
  const controlled = fixture({ storage: { remove: () => Effect.fail(unavailable) } });
  controlled.objects.push({ wallpaperId: 'orphan', extension: 'png' });
  return Effect.gen(function* () {
    const errors = yield* exportedErrors(
      Ingestion.use((ingestion) => ingestion.cleanup()).pipe(Effect.provide(controlled.layer))
    );
    expect(errors).toEqual([{ type: 'assets', value: 1 }]);
  });
});
