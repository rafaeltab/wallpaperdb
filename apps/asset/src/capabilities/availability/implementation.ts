import { DateTime, Effect, Layer } from 'effect';
import type { Health, Readiness } from './contract.js';
import { Availability, AvailabilityProbe } from './contract.js';

export const availabilityLayer: Layer.Layer<Availability, never, AvailabilityProbe> = Layer.effect(
  Availability,
  Effect.gen(function* () {
    const probe = yield* AvailabilityProbe;
    const health = Effect.fn('availability.health')(function* (
      shuttingDown: boolean
    ): Effect.fn.Return<Health> {
      const startedAt = yield* DateTime.now;
      if (shuttingDown)
        return { status: 'shutting_down', checks: {}, timestamp: DateTime.formatIso(startedAt) };
      const checks = yield* probe.inspect();
      const finishedAt = yield* DateTime.now;
      const values = Object.values(checks);
      return {
        status: values.every(Boolean) ? 'healthy' : values.some(Boolean) ? 'degraded' : 'unhealthy',
        checks,
        timestamp: DateTime.formatIso(finishedAt),
        totalDurationMs: DateTime.toEpochMillis(finishedAt) - DateTime.toEpochMillis(startedAt),
      };
    });
    const ready = Effect.fn('availability.ready')(function* (
      shuttingDown: boolean,
      initialized: boolean
    ): Effect.fn.Return<Readiness> {
      const now = yield* DateTime.now;
      return {
        ready: !shuttingDown && initialized,
        timestamp: DateTime.formatIso(now),
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
