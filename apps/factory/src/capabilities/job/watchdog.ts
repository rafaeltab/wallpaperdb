import { Effect } from 'effect';
import type {
  Delivery,
  Intent,
  Issues,
  JobStore,
  Observation,
  StageEvidence,
  StageRequest,
  Time,
  Unavailable,
  WaitState,
} from './contract.js';
type Send = (request: StageRequest) => Effect.Effect<void, Unavailable>;
export function watchdog(
  store: JobStore,
  issues: Issues,
  intent: Intent,
  request: StageRequest,
  observation: Extract<Observation, { kind: 'found' }>,
  time: Time,
  evidence: StageEvidence | null,
  send: Send
) {
  return Effect.gen(function* () {
    const delivery: Delivery = {
      stage: 'babysitting',
      activity: 'repairing',
      commit: request.commit,
      ready: false,
      landed: false,
    };
    if (!explicitWait(observation, request, evidence))
      return yield* suspended(store, issues, intent, request, delivery, observation.status);

    const pr = yield* issues.pullRequest(intent);
    if (pr.kind !== 'found' || !pr.ci || pr.commit !== evidence.commit) return delivery;
    const progress = `${pr.commit}:${pr.ci.progress}`;
    const now = yield* time.now();
    let saved = yield* store.readWait();
    const waitingDelivery = { ...delivery, pr, waitCommit: evidence.commit };
    if (saved?.startedAt === null) {
      const next = { ...saved, revision: saved.revision + 1, startedAt: now };
      if (yield* store.saveWait(next)) saved = next;
    }
    if (!saved || saved.progress !== progress)
      return yield* recordProgress(store, saved, progress, now, waitingDelivery);
    if (evidence.idle === false)
      return {
        ...waitingDelivery,
        activity: 'waiting-for-github' as const,
        waitStartedAt: saved.startedAt ?? undefined,
        deadline: saved.deadline,
      };
    if (saved.nudged)
      return yield* recoverContinuation(store, request, saved, waitingDelivery, send);
    if (now < saved.deadline)
      return {
        ...waitingDelivery,
        activity: 'waiting-for-github' as const,
        waitStartedAt: saved.startedAt ?? undefined,
        deadline: saved.deadline,
      };
    return yield* continueWaiting(store, request, evidence, saved, waitingDelivery, send);
  });
}
function explicitWait(
  observation: Extract<Observation, { kind: 'found' }>,
  request: StageRequest,
  evidence: StageEvidence | null
): evidence is StageEvidence {
  if (!evidence?.waitingForGitHub) return false;
  return observation.status === 'completed' && evidence.stageIndex === request.index;
}
function suspended(
  store: JobStore,
  issues: Issues,
  intent: Intent,
  request: StageRequest,
  delivery: Delivery,
  status: string
) {
  return Effect.gen(function* () {
    const saved = yield* store.readWait();
    const pending = saved?.continuation?.index === request.index;
    const repairing = ['running', 'preparing', 'starting'].includes(status);
    if (
      saved &&
      typeof saved.startedAt === 'number' &&
      (repairing || !pending) &&
      status !== 'waiting-for-input'
    )
      yield* store.saveWait({ ...saved, revision: saved.revision + 1, startedAt: null });
    if (status === 'waiting-for-input') yield* interruptForQuestion(store, saved);
    if (pending) {
      const pr =
        !repairing && status !== 'waiting-for-input' ? yield* issues.pullRequest(intent) : null;
      return {
        ...delivery,
        activity: 'continuation-pending' as const,
        waitStartedAt: repairing ? undefined : (saved.startedAt ?? undefined),
        pr: pr?.kind === 'found' && pr.commit === request.commit ? pr : undefined,
        deadline: saved.deadline,
      };
    }
    return delivery;
  });
}
function recordProgress(
  store: JobStore,
  saved: WaitState | null,
  progress: string,
  now: number,
  delivery: Delivery
) {
  return Effect.gen(function* () {
    const next = {
      revision: (saved?.revision ?? -1) + 1,
      progress,
      // Progress within one comparison preserves its interval; a validated new head starts another.
      startedAt:
        saved && saved.progress.startsWith(`${delivery.waitCommit}:`) ? saved.startedAt : now,
      deadline: now + 3600000,
      nudged: false,
    };
    if (!(yield* store.saveWait(next))) return delivery;
    return {
      ...delivery,
      activity: 'waiting-for-github' as const,
      waitStartedAt: next.startedAt ?? undefined,
      deadline: next.deadline,
    };
  });
}
function recoverContinuation(
  store: JobStore,
  request: StageRequest,
  saved: WaitState,
  delivery: Delivery,
  send: Send
) {
  return Effect.gen(function* () {
    if (saved.continuation && saved.continuation.index > request.index) {
      yield* store.saveStage(saved.continuation);
      yield* send(saved.continuation);
    }
    return {
      ...delivery,
      activity: 'continuation-pending' as const,
      waitStartedAt: saved.startedAt ?? undefined,
      deadline: saved.deadline,
    };
  });
}
function continueWaiting(
  store: JobStore,
  request: StageRequest,
  evidence: StageEvidence,
  saved: WaitState,
  delivery: Delivery,
  send: Send
) {
  return Effect.gen(function* () {
    const continuation: StageRequest = {
      ...request,
      index: request.index + 1,
      commit: evidence.commit,
      receiptProtocol: 'delivery-v1',
      previousRunId: evidence.runId,
      ordinal: evidence.ordinal + 1,
      continuation: true,
      observedRunId: undefined,
      deliveryIndex: undefined,
      question: undefined,
      resume: undefined,
    };
    // Persist the identity before claiming a send. Without transport idempotency,
    // a crash after a claim stays pending instead of repeating an uncertain send.
    if (
      !(yield* store.saveWait({
        ...saved,
        revision: saved.revision + 1,
        nudged: true,
        continuation,
      }))
    )
      return delivery;
    yield* store.saveStage(continuation);
    const winning = yield* store.readStage(continuation.index);
    if (winning) yield* send(winning);
    return {
      ...delivery,
      activity: 'continuation-pending' as const,
      waitStartedAt: saved.startedAt ?? undefined,
      deadline: saved.deadline,
    };
  });
}

function interruptForQuestion(store: JobStore, saved: WaitState | null) {
  return Effect.gen(function* () {
    if (saved && (typeof saved.startedAt === 'number' || (!saved.nudged && saved.progress !== '')))
      yield* store.saveWait({
        ...saved,
        revision: saved.revision + 1,
        progress: saved.nudged ? saved.progress : '',
        startedAt: null,
      });
  });
}

/** End display timing independently of watchdog progress, deadlines and send claims. */
export function endWait(store: JobStore) {
  return Effect.gen(function* () {
    const saved = yield* store.readWait();
    if (saved && typeof saved.startedAt === 'number')
      yield* store.saveWait({ ...saved, revision: saved.revision + 1, startedAt: null });
  });
}
