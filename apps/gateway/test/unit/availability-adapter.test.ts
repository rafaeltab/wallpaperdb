import { describe, expect, it } from '@effect/vitest';
import { Effect, Fiber } from 'effect';
import { TestClock } from 'effect/testing';
import { availabilityProbeLayer } from '../../src/adapters/availability/index.js';
import { AvailabilityProbe } from '../../src/availability/index.js';

describe('dependency health adapter', () => {
  it.effect('translates technical dependency failures without failing the application read', () =>
    Effect.gen(function* () {
      const layer = availabilityProbeLayer({
        opensearch: () => Effect.succeed(true),
        nats: () => Effect.fail(new Error('broker unavailable')),
        otel: () => Effect.succeed(false),
      });
      expect(
        yield* AvailabilityProbe.use((probe) => probe.inspect()).pipe(Effect.provide(layer))
      ).toEqual({
        opensearch: true,
        nats: false,
        otel: false,
      });
    })
  );
  it.effect('bounds every dependency concurrently and interrupts overdue checks', () =>
    Effect.gen(function* () {
      const interrupted: string[] = [];
      const layer = availabilityProbeLayer({
        opensearch: () => Effect.succeed(true),
        nats: () =>
          Effect.never.pipe(
            Effect.onInterrupt(() =>
              Effect.sync(() => {
                interrupted.push('nats');
              })
            )
          ),
        otel: () =>
          Effect.never.pipe(
            Effect.onInterrupt(() =>
              Effect.sync(() => {
                interrupted.push('otel');
              })
            )
          ),
      });
      yield* Effect.gen(function* () {
        const probe = yield* AvailabilityProbe;
        const pending = yield* Effect.forkChild(probe.inspect());
        yield* TestClock.adjust('5 seconds');
        expect(yield* Fiber.join(pending)).toEqual({ opensearch: true, nats: false, otel: false });
        expect(interrupted.sort()).toEqual(['nats', 'otel']);
      }).pipe(Effect.provide(layer));
    })
  );
});
