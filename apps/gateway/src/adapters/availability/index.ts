import { Effect, Layer } from 'effect';
import { AvailabilityProbe, type DependencyHealth } from '../../availability/index.js';

export interface DependencyChecks {
  opensearch(): Effect.Effect<boolean, unknown>;
  nats(): Effect.Effect<boolean, unknown>;
  otel(): Effect.Effect<boolean, unknown>;
}
export function availabilityProbeLayer(checks: DependencyChecks): Layer.Layer<AvailabilityProbe> {
  return Layer.effect(
    AvailabilityProbe,
    Effect.sync(() => {
      const check = Effect.fn('availability.inspect_dependency')(function* (
        name: keyof DependencyChecks
      ) {
        return yield* checks[name]().pipe(
          Effect.timeout('5 seconds'),
          Effect.catch(() => Effect.succeed(false)),
          Effect.annotateSpans({ dependency: name })
        );
      });
      const inspect = Effect.fn('availability.inspect')(
        function* (): Effect.fn.Return<DependencyHealth> {
          return yield* Effect.all(
            { opensearch: check('opensearch'), nats: check('nats'), otel: check('otel') },
            { concurrency: 'unbounded' }
          );
        }
      );
      return AvailabilityProbe.of({ inspect });
    })
  );
}
