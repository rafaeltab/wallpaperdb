import { describe, expect, it } from '@effect/vitest';
import { Effect, Fiber, Layer } from 'effect';
import { TestClock } from 'effect/testing';
import {
  Availability,
  AvailabilityProbe,
  availabilityLayer,
} from '../../src/availability/index.js';

describe('gateway availability', () => {
  it.effect('reports unhealthy when every dependency is unavailable', () =>
    Effect.gen(function* () {
      const probe = {
        inspect: () => Effect.succeed({ opensearch: false, nats: false, otel: false }),
      };
      const availability = yield* Effect.service(Availability).pipe(
        Effect.provide(
          availabilityLayer.pipe(Layer.provide(Layer.succeed(AvailabilityProbe, probe)))
        )
      );
      expect(yield* availability.health(false)).toMatchObject({
        status: 'unhealthy',
        checks: { opensearch: false, nats: false, otel: false },
      });
    })
  );

  it.effect(
    'returns shutdown immediately without probing dependencies or reporting a duration',
    () =>
      Effect.gen(function* () {
        const probe = {
          inspect: () => Effect.die('Shutdown must not probe infrastructure'),
        };
        const availability = yield* Effect.service(Availability).pipe(
          Effect.provide(
            availabilityLayer.pipe(Layer.provide(Layer.succeed(AvailabilityProbe, probe)))
          )
        );
        const result = yield* availability.health(true);
        expect(result).toEqual({
          status: 'shutting_down',
          checks: {},
          timestamp: '1970-01-01T00:00:00.000Z',
        });
      })
  );

  it.effect('measures probe duration using the application clock', () =>
    Effect.gen(function* () {
      const probe = {
        inspect: () =>
          Effect.sleep('250 millis').pipe(Effect.as({ opensearch: true, nats: true, otel: true })),
      };
      const availability = yield* Effect.service(Availability).pipe(
        Effect.provide(
          availabilityLayer.pipe(Layer.provide(Layer.succeed(AvailabilityProbe, probe)))
        )
      );
      const pending = yield* Effect.forkChild(availability.health(false));
      yield* TestClock.adjust('250 millis');
      const result = yield* Fiber.join(pending);
      expect(result).toEqual({
        status: 'healthy',
        checks: { opensearch: true, nats: true, otel: true },
        timestamp: '1970-01-01T00:00:00.250Z',
        totalDurationMs: 250,
      });
    })
  );

  it.effect('reports dependency health and readiness independently', () =>
    Effect.gen(function* () {
      const probe = {
        inspect: () => Effect.succeed({ opensearch: true, nats: true, otel: true }),
      };
      const availability = yield* Effect.service(Availability).pipe(
        Effect.provide(
          availabilityLayer.pipe(Layer.provide(Layer.succeed(AvailabilityProbe, probe)))
        )
      );
      expect(yield* availability.health(false)).toMatchObject({
        status: 'healthy',
      });
      expect(yield* availability.ready(false, true)).toMatchObject({ ready: true });
      expect(yield* availability.ready(false, false)).toMatchObject({
        ready: false,
        reason: 'Service is not yet initialized',
      });
      expect(yield* availability.ready(true, true)).toMatchObject({
        ready: false,
        reason: 'Service is shutting down',
      });
    })
  );
  it.effect('reports unhealthy dependencies and shutdown without mutable shared probe state', () =>
    Effect.gen(function* () {
      const probe = {
        inspect: () => Effect.succeed({ opensearch: false, nats: true, otel: false }),
      };
      const availability = yield* Effect.service(Availability).pipe(
        Effect.provide(
          availabilityLayer.pipe(Layer.provide(Layer.succeed(AvailabilityProbe, probe)))
        )
      );
      const results = yield* Effect.all([availability.health(true), availability.health(false)], {
        concurrency: 'unbounded',
      });
      expect(results[0]).toMatchObject({ status: 'shutting_down', checks: {} });
      expect(results[1]).toMatchObject({ status: 'degraded', checks: { opensearch: false } });
    })
  );
});
