import { Clock, Effect } from 'effect';

export interface DependencyHealth {
  readonly opensearch: boolean;
  readonly nats: boolean;
  readonly otel: boolean;
}
/** Inspects every required dependency with a bounded deadline; technical failures
 * and timeouts become false. Telemetry failure does not throw across this port. */
export interface AvailabilityProbe {
  inspect(): Effect.Effect<DependencyHealth>;
}
export const AvailabilityProbe = Symbol.for('wallpaperdb.gateway.availability.AvailabilityProbe');
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
export const Availability = Symbol.for('wallpaperdb.gateway.availability.Availability');
class GatewayAvailability implements Availability {
  constructor(private readonly probe: AvailabilityProbe) {}
  health(shuttingDown: boolean): Effect.Effect<Health> {
    return Effect.gen(this, function* () {
      const startedAt = yield* Clock.currentTimeMillis;
      if (shuttingDown) {
        return {
          status: 'shutting_down',
          checks: {},
          timestamp: new Date(startedAt).toISOString(),
        } satisfies Health;
      }
      const checks = yield* this.probe.inspect();
      const finishedAt = yield* Clock.currentTimeMillis;
      const values = Object.values(checks);
      return {
        status: values.every(Boolean) ? 'healthy' : values.some(Boolean) ? 'degraded' : 'unhealthy',
        checks,
        timestamp: new Date(finishedAt).toISOString(),
        totalDurationMs: finishedAt - startedAt,
      } satisfies Health;
    }).pipe(Effect.withSpan('availability.health'));
  }
  ready(shuttingDown: boolean, initialized: boolean): Effect.Effect<Readiness> {
    return Clock.currentTimeMillis.pipe(
      Effect.map((now) => ({
        ready: !shuttingDown && initialized,
        timestamp: new Date(now).toISOString(),
        ...(shuttingDown
          ? { reason: 'Service is shutting down' }
          : !initialized
            ? { reason: 'Service is not yet initialized' }
            : {}),
      })),
      Effect.withSpan('availability.ready')
    );
  }
}
export function createAvailability(probe: AvailabilityProbe): Availability {
  return new GatewayAvailability(probe);
}
