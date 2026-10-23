import { Clock, Effect, Layer, Metric } from 'effect';
import { Availability, type Health } from './capabilities/availability/index.js';

export interface MonitorOptions {
  readonly telemetryEnabled: boolean;
  readonly intervalMs?: number;
  readonly probeTimeoutMs?: number;
}

/** Process composition owns this fiber. Each completed observation updates a
 * timestamp so a stopped monitor cannot leave an apparently healthy gauge. */
export function monitorLayer(options: MonitorOptions): Layer.Layer<never, never, Availability> {
  return Layer.effectDiscard(
    Effect.gen(function* () {
      const availability = yield* Availability;
      const unhealthy: Health = {
        status: 'unhealthy',
        timestamp: '',
        totalDurationMs: 0,
        checks: {
          s3: false,
          identity: false,
          database: false,
          nats: false,
          consumer: false,
          otel: false,
        },
      };
      const observe = Effect.gen(function* () {
        const health = yield* availability.health(false).pipe(
          Effect.timeoutOrElse({
            duration: options.probeTimeoutMs ?? 20_000,
            orElse: () => Effect.succeed(unhealthy),
          }),
          Effect.catchDefect(() =>
            Effect.logError('Asset dependency monitor probe failed').pipe(Effect.as(unhealthy))
          )
        );
        for (const dependency of [
          'database',
          's3',
          'nats',
          'consumer',
          'identity',
          'otel',
        ] as const) {
          const required =
            dependency === 'identity'
              ? health.checks.identity !== undefined
              : dependency !== 'otel' || options.telemetryEnabled;
          yield* Metric.update(
            Metric.gauge('asset.dependency.healthy', {
              description: 'Whether a required Asset dependency or protective worker is healthy',
              attributes: { dependency, required: String(required) },
            }),
            !required || health.checks[dependency] === true ? 1 : 0
          );
        }
        yield* Metric.update(
          Metric.gauge('asset.dependency.observed_at_seconds', {
            description: 'Unix timestamp of the last completed Asset dependency observation',
          }),
          (yield* Clock.currentTimeMillis) / 1000
        );
      });
      yield* observe.pipe(
        Effect.andThen(Effect.sleep(options.intervalMs ?? 30_000)),
        Effect.forever,
        Effect.forkScoped
      );
    })
  );
}
