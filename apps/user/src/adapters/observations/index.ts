import { Effect, Metric } from 'effect';

type ObservedDependency = 'identity' | 'picture-storage' | 'picture-source';

/** Record only observed dependency work: local rejection or a missing-row no-op
 * cannot establish that a previously failed external dependency has recovered. */
export const recordDependencyHealth = (dependency: ObservedDependency, healthy: boolean) =>
  Metric.update(
    Metric.gauge('user.dependency.last_operation_healthy', {
      description: 'Whether the most recent dependency operation succeeded',
      attributes: { dependency },
    }),
    healthy ? 1 : 0
  );

/** On-demand dependencies stay failed during idle periods and retry backoff.
 * Use this wrapper when every successful result represents dependency contact. */
export const monitorDependency =
  (dependency: ObservedDependency) =>
  <A, E, R>(operation: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    operation.pipe(
      Effect.tap(() => recordDependencyHealth(dependency, true)),
      Effect.tapError(() => recordDependencyHealth(dependency, false))
    );
