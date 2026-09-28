import { Context, type Effect } from 'effect';

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

export const AvailabilityProbe = Context.Service<AvailabilityProbe>(
  'wallpaperdb.gateway.availability.AvailabilityProbe'
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
  'wallpaperdb.gateway.availability.Availability'
);
