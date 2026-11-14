import { Effect } from 'effect';
import type {
  Delivery,
  Intent,
  Issues,
  JobStore,
  StageEvidence,
  StageRequest,
} from './contract.js';
import { requestReconciliation } from './reconciliation.js';

export function dependencyHandback(
  store: JobStore,
  issues: Issues,
  intent: Intent,
  waiting: StageRequest,
  evidence: StageEvidence | null,
  limit: number
) {
  return Effect.gen(function* () {
    if (!waiting.handback && evidence?.dependencies === undefined) return null;
    const delivery: Delivery = {
      stage: waiting.stage,
      commit: waiting.commit,
      ready: false,
      landed: false,
      activity: 'continuation-pending',
      active: true,
    };
    if (!evidence?.idle) return delivery;
    const control = yield* store.readControl();
    if (control.cancelled || control.released) return null;
    const dependencies = [...new Set(evidence.dependencies)];
    const result =
      dependencies.length &&
      dependencies.length <= 100 &&
      dependencies.every(
        (value) =>
          /^[1-9][0-9]*$/.test(value) &&
          Number.isSafeInteger(Number(value)) &&
          Number(value) !== intent.issue
      )
        ? yield* issues.validateDependencies?.(intent, dependencies) ??
            Effect.succeed('invalid' as const)
        : 'invalid';
    if (result === 'cycle')
      return {
        ...delivery,
        activity: 'manual-recovery' as const,
        active: false,
        progress: 'Dependency cycle requires maintainer recovery.',
      };
    if (result === 'invalid') return yield* requestReconciliation(store, waiting, evidence, limit);
    if (waiting.handback) {
      const same =
        dependencies.length === waiting.handback.length &&
        dependencies.every((value) => waiting.handback?.includes(value));
      if (!same)
        return yield* requestReconciliation(
          store,
          { ...waiting, handback: dependencies },
          evidence,
          limit
        );
      const verified = yield* issues.verifyHandback?.(intent, dependencies) ??
        Effect.succeed(false);
      if ((yield* store.readControl()).revision !== control.revision) return delivery;
      if (!verified) return yield* requestReconciliation(store, waiting, evidence, limit);
      return {
        ...delivery,
        activity: 'dependency-handback' as const,
        handbackRevision: control.revision,
        active: false,
        progress: 'Dependencies recorded; attempt abandoned for ordinary scheduling.',
      };
    }
    const request: StageRequest = {
      ...waiting,
      index: waiting.index + 1,
      handback: dependencies,
      previousRunId: evidence.runId,
      ordinal: evidence.ordinal + 1,
      resume: true,
      observedRunId: undefined,
      reconciliation: undefined,
      deliveryIndex: undefined,
      question: undefined,
    };
    // Retain responsibility atomically before immutable instruction creation or send.
    if (
      !(yield* store.saveControl({
        ...control,
        revision: control.revision + 1,
        reconciliation: {
          ...(control.reconciliation ?? { attempts: 0, migrated: false }),
          pending: request,
        },
      }))
    )
      return delivery;
    yield* store.saveStage(request);
    return delivery;
  });
}
