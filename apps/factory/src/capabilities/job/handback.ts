import { Effect } from 'effect';
import type {
  Delivery,
  Control,
  Intent,
  Issues,
  JobStore,
  StageEvidence,
  StageRequest,
} from './contract.js';
import { requestReconciliation, retainDependencyRecovery } from './reconciliation.js';

export function dependencyHandback(
  store: JobStore,
  issues: Issues,
  intent: Intent,
  waiting: StageRequest,
  evidence: StageEvidence | null,
  limit: number,
  control: Control
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
    // This authority predates execution observation and evidence association.
    // A later snapshot may invalidate it but must never relabel stale evidence.
    const current = yield* store.readControl();
    if (
      control.cancelled ||
      control.released ||
      current.cancelled ||
      current.released ||
      current.revision !== control.revision ||
      (control.reconciliation?.pending?.index ?? -1) > waiting.index ||
      (control.manualRepair?.adoption?.index ?? -1) > waiting.index ||
      (control.restart?.index ?? -1) > waiting.index
    )
      return delivery;
    const reconcile = (request = waiting) =>
      requestReconciliation(store, request, evidence, limit, control.revision).pipe(
        Effect.map((result) => result ?? delivery)
      );
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
    if ((yield* store.readControl()).revision !== control.revision) return delivery;
    if (result === 'cycle') {
      const progress = 'Dependency cycle requires maintainer recovery.';
      if (!(yield* retainDependencyRecovery(store, control, waiting, evidence, progress)))
        return delivery;
      return { ...delivery, activity: 'manual-recovery' as const, active: false, progress };
    }
    if (result === 'invalid') return yield* reconcile();
    if (waiting.handback) {
      const same =
        dependencies.length === waiting.handback.length &&
        dependencies.every((value) => waiting.handback?.includes(value));
      if (!same) return yield* reconcile({ ...waiting, handback: dependencies });
      const verified = yield* issues.verifyHandback?.(intent, dependencies) ??
        Effect.succeed(false);
      if ((yield* store.readControl()).revision !== control.revision) return delivery;
      if (!verified) return yield* reconcile();
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
