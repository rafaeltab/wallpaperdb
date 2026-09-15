import { Effect, Fiber, TestClock, TestContext } from 'effect';
import { describe, expect, it } from 'vitest';
import { createAvailability } from '../../src/availability/index.js';

describe('gateway availability', () => {
  it('reports unhealthy when every dependency is unavailable', async () => {
    const availability = createAvailability({
      inspect: () => Effect.succeed({ opensearch: false, nats: false, otel: false }),
    });
    expect(await Effect.runPromise(availability.health(false))).toMatchObject({
      status: 'unhealthy',
      checks: { opensearch: false, nats: false, otel: false },
    });
  });

  it('returns shutdown immediately without probing dependencies or reporting a duration', async () => {
    const availability = createAvailability({
      inspect: () => Effect.die('Shutdown must not probe infrastructure'),
    });
    const result = await Effect.runPromise(
      availability.health(true).pipe(Effect.provide(TestContext.TestContext))
    );
    expect(result).toEqual({
      status: 'shutting_down',
      checks: {},
      timestamp: '1970-01-01T00:00:00.000Z',
    });
  });

  it('measures probe duration using the application clock', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const availability = createAvailability({
          inspect: () =>
            Effect.sleep('250 millis').pipe(
              Effect.as({ opensearch: true, nats: true, otel: true })
            ),
        });
        const pending = yield* Effect.fork(availability.health(false));
        yield* TestClock.adjust('250 millis');
        const result = yield* Fiber.join(pending);
        expect(result).toEqual({
          status: 'healthy',
          checks: { opensearch: true, nats: true, otel: true },
          timestamp: '1970-01-01T00:00:00.250Z',
          totalDurationMs: 250,
        });
      }).pipe(Effect.provide(TestContext.TestContext))
    );
  });

  it('reports dependency health and readiness independently', async () => {
    const availability = createAvailability({
      inspect: () => Effect.succeed({ opensearch: true, nats: true, otel: true }),
    });
    expect(await Effect.runPromise(availability.health(false))).toMatchObject({
      status: 'healthy',
    });
    expect(await Effect.runPromise(availability.ready(false, true))).toMatchObject({ ready: true });
    expect(await Effect.runPromise(availability.ready(false, false))).toMatchObject({
      ready: false,
      reason: 'Service is not yet initialized',
    });
    expect(await Effect.runPromise(availability.ready(true, true))).toMatchObject({
      ready: false,
      reason: 'Service is shutting down',
    });
  });
  it('reports unhealthy dependencies and shutdown without mutable shared probe state', async () => {
    const availability = createAvailability({
      inspect: () => Effect.succeed({ opensearch: false, nats: true, otel: false }),
    });
    const results = await Effect.runPromise(
      Effect.all([availability.health(true), availability.health(false)], {
        concurrency: 'unbounded',
      })
    );
    expect(results[0]).toMatchObject({ status: 'shutting_down', checks: {} });
    expect(results[1]).toMatchObject({ status: 'degraded', checks: { opensearch: false } });
  });
});
