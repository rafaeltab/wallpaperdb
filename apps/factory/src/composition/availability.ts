import { Clock, Effect, Metric } from 'effect';

/** An observation is complete on either success or failure. Idle, paused and
 * question-waiting ticks succeed; blocked external operations fail or go stale. */
export function availabilityObservation(healthy: boolean) {
  return Effect.gen(function* () {
    yield* Metric.update(Metric.gauge('factory_scheduler_healthy'), healthy ? 1 : 0);
    yield* Metric.update(
      Metric.gauge('factory_scheduler_observed_at_seconds'),
      (yield* Clock.currentTimeMillis) / 1000
    );
  });
}
