import { DateTime, Effect, Layer } from 'effect';

import { Availability, AvailabilityProbe } from './contract.js';

export const availabilityLayer = Layer.effect(
  Availability,
  Effect.gen(function* () {
    const probe = yield* AvailabilityProbe;
    return Availability.of({
      ready: Effect.fn('availability.ready')(function* (
        shuttingDown: boolean,
        initialized: boolean
      ) {
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
      }),
      health: Effect.fn('availability.health')(function* (shuttingDown: boolean) {
        const startedAt = yield* DateTime.now;
        if (shuttingDown)
          return {
            status: 'shutting_down' as const,
            checks: {},
            timestamp: DateTime.formatIso(startedAt),
          };
        const checks = yield* probe.inspect();
        const finishedAt = yield* DateTime.now;
        return {
          status: Object.values(checks).every(Boolean)
            ? ('healthy' as const)
            : Object.values(checks).some(Boolean)
              ? ('degraded' as const)
              : ('unhealthy' as const),
          checks,
          timestamp: DateTime.formatIso(finishedAt),
          totalDurationMs: DateTime.toEpochMillis(finishedAt) - DateTime.toEpochMillis(startedAt),
        };
      }),
    });
  })
);
