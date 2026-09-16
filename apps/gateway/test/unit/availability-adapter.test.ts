import { Effect, Fiber } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';
import { availabilityProbeLayer } from '../../src/adapters/availability/index.js';
import { AvailabilityProbe } from '../../src/availability/index.js';

describe('dependency health adapter', () => {
  it('translates technical dependency failures without failing the application read', async () => {
    const layer = availabilityProbeLayer({
      opensearch: () => Effect.succeed(true),
      nats: () => Effect.fail(new Error('broker unavailable')),
      otel: () => Effect.succeed(false),
    });
    expect(
      await Effect.runPromise(
        AvailabilityProbe.use((probe) => probe.inspect()).pipe(Effect.provide(layer))
      )
    ).toEqual({
      opensearch: true,
      nats: false,
      otel: false,
    });
  });
  it('bounds every dependency concurrently and interrupts overdue checks', async () => {
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
    await Effect.runPromise(
      Effect.gen(function* () {
        const probe = yield* AvailabilityProbe;
        const pending = yield* Effect.forkChild(probe.inspect());
        yield* TestClock.adjust('5 seconds');
        expect(yield* Fiber.join(pending)).toEqual({ opensearch: true, nats: false, otel: false });
        expect(interrupted.sort()).toEqual(['nats', 'otel']);
      }).pipe(Effect.provide(layer), Effect.provide(TestClock.layer()))
    );
  });
});
