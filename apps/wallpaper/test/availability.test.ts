import { Effect } from 'effect';
import { expect, it } from 'vitest';
import {
  Availability,
  AvailabilityProbe,
  availabilityLayer,
} from '../src/capabilities/availability/index.js';

it.each([
  [{ database: true, nats: true, otel: true }, 'healthy'],
  [{ database: false, nats: true, otel: true }, 'degraded'],
  [{ database: true, nats: false, otel: true }, 'degraded'],
  [{ database: true, nats: true, otel: false }, 'degraded'],
  [{ database: false, nats: false, otel: true }, 'degraded'],
  [{ database: false, nats: false, otel: false }, 'unhealthy'],
] as const)('classifies dependency health %j', async (checks, status) => {
  const result = await Effect.runPromise(
    Availability.use((service) => service.health(false)).pipe(
      Effect.provide(availabilityLayer),
      Effect.provideService(AvailabilityProbe, { inspect: () => Effect.succeed(checks) })
    )
  );
  expect(result).toMatchObject({ status, checks });
});

it.each([
  [{ database: true, nats: true, otel: true }, true],
  [{ database: false, nats: true, otel: true }, false],
  [{ database: true, nats: false, otel: true }, false],
  [{ database: true, nats: true, otel: false }, true],
] as const)('readiness checks required connections %j', async (checks, ready) => {
  const result = await Effect.runPromise(
    Availability.use((service) => service.ready(false, true)).pipe(
      Effect.provide(availabilityLayer),
      Effect.provideService(AvailabilityProbe, { inspect: () => Effect.succeed(checks) })
    )
  );
  expect(result).toEqual({
    ready,
    timestamp: expect.any(String),
    ...(ready ? {} : { reason: 'Required connections are unavailable' }),
  });
});
