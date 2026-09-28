import { Clock, Effect, Layer } from 'effect';
import type { Health, Readiness } from './contract.js';
import { Availability, AvailabilityProbe } from './contract.js';

export const availabilityLayer = Layer.effect(
  Availability,
  Effect.gen(function* () {
    const probe = yield* AvailabilityProbe;
    const health = Effect.fn('user.health')(function* (
      shuttingDown: boolean
    ): Effect.fn.Return<Health> {
      const started = yield* Clock.currentTimeMillis;
      const timestamp = new Date(started).toISOString();
      if (shuttingDown) return { status: 'shutting_down', checks: {}, timestamp };
      const checks = yield* probe.inspect();
      const values = Object.values(checks);
      return {
        status: values.every(Boolean) ? 'healthy' : values.some(Boolean) ? 'degraded' : 'unhealthy',
        checks,
        timestamp,
        totalDurationMs: (yield* Clock.currentTimeMillis) - started,
      };
    });
    const ready = Effect.fn('user.ready')(function* (
      shuttingDown: boolean,
      initialized: boolean
    ): Effect.fn.Return<Readiness> {
      return {
        ready: !shuttingDown && initialized,
        timestamp: new Date(yield* Clock.currentTimeMillis).toISOString(),
        ...(shuttingDown
          ? { reason: 'Service is shutting down' }
          : !initialized
            ? { reason: 'Service is not yet initialized' }
            : {}),
      };
    });
    return Availability.of({ health, ready });
  })
);
