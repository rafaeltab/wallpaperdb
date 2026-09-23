import { describe, expect, it } from '@effect/vitest';
import { Effect, Layer } from 'effect';
import {
  Availability,
  AvailabilityProbe,
  availabilityLayer,
} from '../../src/availability/index.js';

describe('ingestor availability', () => {
  it.effect('reports required dependencies and readiness without sharing request state', () =>
    Effect.gen(function* () {
      const availability = yield* Availability;
      expect(yield* availability.health(false)).toMatchObject({
        status: 'degraded',
        checks: { database: true, s3: false, nats: true, otel: true },
      });
      expect(yield* availability.health(true)).toMatchObject({
        status: 'shutting_down',
        checks: {},
      });
      expect(yield* availability.ready(false, true)).toMatchObject({ ready: true });
      expect(yield* availability.ready(true, true)).toMatchObject({ ready: false });
      expect(yield* availability.ready(false, false)).toMatchObject({ ready: false });
    }).pipe(
      Effect.provide(availabilityLayer),
      Effect.provide(
        Layer.succeed(AvailabilityProbe, {
          inspect: () => Effect.succeed({ database: true, s3: false, nats: true, otel: true }),
        })
      )
    )
  );
});
