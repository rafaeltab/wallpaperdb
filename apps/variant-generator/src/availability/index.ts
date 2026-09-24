import { Context, DateTime, Effect, Layer } from 'effect';

export interface DependencyHealth {
  readonly s3: boolean;
  readonly consumer: boolean;
  readonly nats: boolean;
  readonly otel: boolean;
}
/** Inspects every required dependency with a bounded deadline; technical failures
 * and timeouts become false. Telemetry failure does not throw across this port. */
export interface AvailabilityProbe {
  inspect(): Effect.Effect<DependencyHealth>;
}
export const AvailabilityProbe = Context.Service<AvailabilityProbe>(
  'wallpaperdb.variant-generator.availability.AvailabilityProbe'
);
export type Health =
  | {
      readonly status: 'shutting_down';
      readonly checks: Readonly<Record<string, never>>;
      readonly timestamp: string;
      readonly totalDurationMs?: never;
    }
  | {
      readonly status: 'healthy' | 'degraded' | 'unhealthy';
      readonly checks: DependencyHealth;
      readonly timestamp: string;
      readonly totalDurationMs: number;
    };
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
  'wallpaperdb.variant-generator.availability.Availability'
);
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
