import { Effect, Layer } from 'effect';
import { expect, it } from 'vitest';
import { Availability, AvailabilityProbe, availabilityLayer } from '../src/availability/index.js';
it.each([
  [{ database: true, s3: true, nats: true, otel: true, consumer: true }, 'healthy'],
  [{ database: false, s3: false, nats: true, otel: true, consumer: true }, 'degraded'],
  [{ database: false, s3: false, nats: false, otel: false, consumer: false }, 'unhealthy'],
] as const)('reports dependency health %j', async (checks, status) => {
  const layer = availabilityLayer.pipe(
    Layer.provide(Layer.succeed(AvailabilityProbe, { inspect: () => Effect.succeed(checks) }))
  );
  const health = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* (yield* Availability).health(false);
    }).pipe(Effect.provide(layer))
  );
  expect(health).toMatchObject({ status, checks });
});
it('reports shutdown without probing dependencies', async () => {
  const layer = availabilityLayer.pipe(
    Layer.provide(Layer.succeed(AvailabilityProbe, { inspect: () => Effect.die('must not probe') }))
  );
  const health = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* (yield* Availability).health(true);
    }).pipe(Effect.provide(layer))
  );
  expect(health).toMatchObject({ status: 'shutting_down', checks: {} });
});
it.each([
  [false, false, false, 'Service is not yet initialized'],
  [false, true, true, undefined],
  [true, true, false, 'Service is shutting down'],
])('readiness uses startup and shutdown state', async (shuttingDown, initialized, ready, reason) => {
  const result = await Effect.runPromise(
    Availability.use((service) => service.ready(shuttingDown, initialized)).pipe(
      Effect.provide(availabilityLayer),
      Effect.provideService(AvailabilityProbe, { inspect: () => Effect.die('must not probe') })
    )
  );
  expect(result.ready).toBe(ready);
  expect(result.reason).toBe(reason);
  expect(Number.isNaN(Date.parse(result.timestamp))).toBe(false);
});
