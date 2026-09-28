import { Context, type Effect } from 'effect';

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
