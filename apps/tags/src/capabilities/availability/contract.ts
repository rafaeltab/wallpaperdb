import { Context, type Effect } from 'effect';

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
