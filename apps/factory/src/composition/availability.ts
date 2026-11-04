import { Clock, Effect, Metric } from 'effect';
import type { ScheduleStatus } from '../capabilities/plan/index.js';

/** An observation is complete on either success or failure. Idle, paused and
 * question-waiting ticks succeed; blocked external operations fail or go stale. */
export function availabilityObservation(healthy: boolean) {
  return Effect.gen(function* () {
    yield* Metric.update(Metric.gauge('factory_scheduler_healthy'), healthy ? 1 : 0);
    yield* Metric.update(
      Metric.gauge('factory_scheduler_observed_at_seconds', { attributes: { unit: 's' } }),
      (yield* Clock.currentTimeMillis) / 1000
    );
  });
}

/** A known failed run is still observable and can await explicit operator action.
 * A missing or conflicting binding cannot advance retained work, even when the tick returns. */
export function retainedWorkAvailable(snapshot: ScheduleStatus): boolean {
  return (
    snapshot.jobs.length === snapshot.state.admissions.length &&
    snapshot.jobs.every((job) => job.kind === 'job' && job.execution.kind === 'found') &&
    (snapshot.recoveries ?? []).every((recovery) => recovery.bindingAvailable !== false)
  );
}
