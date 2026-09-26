import { Effect, Layer } from 'effect';
import { expect, it } from 'vitest';
import { Availability, AvailabilityProbe, availabilityLayer } from '../src/availability/index.js';

it('reports the health of every shell dependency', async () => {
  const layer = availabilityLayer.pipe(
    Layer.provide(Layer.succeed(AvailabilityProbe, {
      inspect: () => Effect.succeed({ database: true, nats: true, otel: true }),
    }))
  );
  const result = await Effect.runPromise(
    Availability.use((service) => service.health(false)).pipe(Effect.provide(layer))
  );
  expect(result).toMatchObject({ status: 'healthy', checks: { database: true, nats: true, otel: true } });
  expect(Number.isNaN(Date.parse(result.timestamp))).toBe(false);
  expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
});

it.each([
  [{ database: false, nats: true, otel: true }, 'degraded'],
  [{ database: false, nats: false, otel: false }, 'unhealthy'],
] as const)('aggregates dependency failures %j', async (checks, status) => {
  const result = await Effect.runPromise(
    Availability.use((service) => service.health(false)).pipe(
      Effect.provide(availabilityLayer),
      Effect.provideService(AvailabilityProbe, { inspect: () => Effect.succeed(checks) })
    )
  );
  expect(result).toMatchObject({ status, checks });
});

it('reports shutdown without inspecting dependencies', async () => {
  const result = await Effect.runPromise(
    Availability.use((service) => service.health(true)).pipe(
      Effect.provide(availabilityLayer),
      Effect.provideService(AvailabilityProbe, { inspect: () => Effect.die('must not probe during shutdown') })
    )
  );
  expect(result).toEqual({ status: 'shutting_down', checks: {}, timestamp: expect.any(String) });
});

it.each([
  [false, false, false, 'Service is not yet initialized'],
  [false, true, true, undefined],
  [true, false, false, 'Service is shutting down'],
  [true, true, false, 'Service is shutting down'],
] as const)('readiness prioritizes shutdown and otherwise uses initialization state %s %s', async (shuttingDown, initialized, ready, reason) => {
  const result = await Effect.runPromise(
    Availability.use((service) => service.ready(shuttingDown, initialized)).pipe(
      Effect.provide(availabilityLayer),
      Effect.provideService(AvailabilityProbe, { inspect: () => Effect.die('readiness must not probe') })
    )
  );
  expect(result).toEqual({ ready, timestamp: expect.any(String), ...(reason ? { reason } : {}) });
  expect(Number.isNaN(Date.parse(result.timestamp))).toBe(false);
});
