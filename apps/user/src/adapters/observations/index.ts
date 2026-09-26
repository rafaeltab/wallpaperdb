import { Effect, Metric } from 'effect';

/** On-demand dependencies stay failed during idle periods and retry backoff.
 * Only a subsequent successful operation establishes recovery. */
export const monitorDependency = (
  dependency: 'identity' | 'picture-storage' | 'picture-source'
) => {
  const health = Metric.gauge('user.dependency.last_operation_healthy', {
    description: 'Whether the most recent dependency operation succeeded',
    attributes: { dependency },
  });
  return <A, E, R>(operation: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    operation.pipe(
      Effect.tap(() => Metric.update(health, 1)),
      Effect.tapError(() => Metric.update(health, 0))
    );
};
