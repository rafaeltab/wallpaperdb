import { Effect } from 'effect';
import { retainManualRepair } from './manual-repair.js';
import type { Delivery, JobStore, StageEvidence, StageRequest, Unavailable } from './contract.js';

/** New authorizations reserve the counter and immutable instruction together,
 * before its send claim. Recover older pending-only records without resending. */
export function recoverReconciliation(store: JobStore) {
  return Effect.gen(function* () {
    const pending = (yield* store.readControl()).reconciliation?.pending;
    if (pending) yield* store.saveStage(pending);
  });
}
export function requestReconciliation(
  store: JobStore,
  waiting: StageRequest,
  evidence: StageEvidence | null,
  limit: number
): Effect.Effect<Delivery | null, Unavailable> {
  return Effect.gen(function* () {
    if (!evidence?.idle || evidence.dependencies) return null;
    const control = yield* store.readControl();
    if (control.cancelled || control.parked?.index === waiting.index) return null;
    const state = control.reconciliation ?? { attempts: 0, migrated: false };
    // The pending instruction is also the authorization high-water mark. Read
    // it from the same revision used below so overlapping observations cannot
    // spend another attempt for a stage whose successor already won.
    if ((state.pending?.index ?? -1) > waiting.index)
      return {
        stage: waiting.stage,
        commit: evidence.commit,
        ready: false,
        landed: false,
        activity: 'continuation-pending',
        active: true,
      } satisfies Delivery;
    const migration = evidence.migrationRequired === true;
    const failedMigration =
      state.migrated &&
      waiting.reconciliation === 'migration' &&
      evidence.migrationRequired !== false &&
      !evidence.accepted;
    if (
      failedMigration ||
      (migration && state.migrated) ||
      (!migration && state.attempts >= limit)
    ) {
      if (waiting.stage === 'implementation')
        yield* retainManualRepair(store, waiting, {
          id: evidence.runId,
          ordinal: evidence.ordinal,
        });
      return {
        stage: waiting.stage,
        commit: evidence.commit,
        ready: false,
        landed: false,
        active: false,
        activity: 'manual-recovery',
        progress:
          migration || failedMigration
            ? 'Agent response migration failed. Maintainer intervention required.'
            : 'Agent reconciliation attempt limit reached. Maintainer intervention and explicit reset required.',
      } satisfies Delivery;
    }
    const request: StageRequest = {
      ...waiting,
      index: waiting.index + 1,
      previousRunId: evidence.runId,
      ordinal: evidence.ordinal + 1,
      observedRunId: undefined,
      question: undefined,
      deliveryIndex: undefined,
      resume: true,
      reconciliation: migration ? 'migration' : 'state',
    };
    if (
      !(yield* store.saveControl(
        {
          ...control,
          revision: control.revision + 1,
          reconciliation: {
            attempts: state.attempts + (migration ? 0 : 1),
            migrated: state.migrated || migration,
            pending: request,
          },
        },
        request
      ))
    ) {
      // This observation lost authority. Keep the slot until a fresh observation
      // validates the winner; never authorize another attempt with stale evidence.
      if ((yield* store.readControl()).cancelled) return null;
      return {
        stage: waiting.stage,
        commit: evidence.commit,
        ready: false,
        landed: false,
        active: true,
        activity: 'continuation-pending',
      } satisfies Delivery;
    }
    yield* recoverReconciliation(store);
    return {
      stage: waiting.stage,
      commit: evidence.commit,
      ready: false,
      landed: false,
      activity: 'continuation-pending',
      active: true,
      progress: migration
        ? 'Migrating agent response to version 1.'
        : `Agent reconciliation attempt ${state.attempts + 1} of ${limit}.`,
    } satisfies Delivery;
  });
}
