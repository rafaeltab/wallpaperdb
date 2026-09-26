import { Clock, Context, Effect, Layer } from 'effect';

export interface DependencyHealth {
  readonly database: boolean;
  readonly nats: boolean;
  readonly otel: boolean;
  readonly workers: boolean;
}
/** Each underlying probe bounds and cancels its work, translating unavailable
 * infrastructure to false. The capability never inspects vendor failures. */
export interface AvailabilityProbe {
  inspect(): Effect.Effect<DependencyHealth>;
}
export const AvailabilityProbe = Context.Service<AvailabilityProbe>(
  'wallpaperdb.user.AvailabilityProbe'
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
export const Availability = Context.Service<Availability>('wallpaperdb.user.Availability');
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
