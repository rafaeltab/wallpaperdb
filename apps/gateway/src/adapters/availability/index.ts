import { Effect } from 'effect';
import type { AvailabilityProbe, DependencyHealth } from '../../availability/index.js';

export interface DependencyChecks {
  opensearch(): Promise<boolean>;
  nats(): Promise<boolean>;
  otel(): Promise<boolean>;
}
class InfrastructureHealth implements AvailabilityProbe {
  constructor(private readonly checks: DependencyChecks) {}
  inspect(): Effect.Effect<DependencyHealth> {
    const check = (name: keyof DependencyChecks) =>
      Effect.tryPromise(() => this.checks[name]()).pipe(
        Effect.timeout('5 seconds'),
        Effect.catchAll(() => Effect.succeed(false)),
        Effect.withSpan(`availability.inspect_${name}`)
      );
    return Effect.all(
      { opensearch: check('opensearch'), nats: check('nats'), otel: check('otel') },
      { concurrency: 'unbounded' }
    );
  }
}
export function createAvailabilityProbe(checks: DependencyChecks): AvailabilityProbe {
  return new InfrastructureHealth(checks);
}
