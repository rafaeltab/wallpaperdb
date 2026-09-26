import { Context, DateTime, Effect, Layer } from 'effect';

export interface DependencyHealth {
  readonly database: boolean;
  readonly nats: boolean;
  readonly otel: boolean;
}
/** Inspects dependencies within bounded resource use. Technical failures become
 * false; interruption and programmer defects retain their Effect semantics. */
export interface AvailabilityProbe {
  inspect(): Effect.Effect<DependencyHealth>;
}
export const AvailabilityProbe = Context.Service<AvailabilityProbe>(
  'wallpaperdb.tags.availability.AvailabilityProbe'
);
export interface Health {
  readonly status: 'healthy' | 'degraded' | 'unhealthy' | 'shutting_down';
  readonly checks: DependencyHealth | Readonly<Record<string, never>>;
  readonly timestamp: string;
  readonly totalDurationMs?: number;
}
export interface Readiness {
  readonly ready: boolean;
  readonly timestamp: string;
  readonly reason?: string;
}
export interface Availability {
  health(shuttingDown: boolean): Effect.Effect<Health>;
  ready(shuttingDown: boolean, initialized: boolean): Effect.Effect<Readiness>;
}
export const Availability = Context.Service<Availability>(
  'wallpaperdb.tags.availability.Availability'
);
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
