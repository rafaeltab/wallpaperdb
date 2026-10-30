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
      return yield* suspended(store, request, delivery);
    if (!(yield* store.bindRun(request, evidence.runId))) return delivery;
    const progress = yield* observedProgress(issues, intent);
    if (progress === null) return delivery;
    const now = yield* time.now();
    const saved = yield* store.readWait();
    if (!saved || saved.progress !== progress)
      return yield* recordProgress(store, saved, progress, now, delivery);
    if (saved.nudged) return yield* recoverContinuation(store, request, saved, delivery, send);
    if (now < saved.deadline)
      return { ...delivery, activity: 'waiting-for-github' as const, deadline: saved.deadline };
    return yield* continueWaiting(store, request, evidence, saved, delivery, send);
  });
}
function explicitWait(
  observation: Extract<Observation, { kind: 'found' }>,
  request: StageRequest,
  evidence: StageEvidence | null
): evidence is StageEvidence {
  if (!evidence?.waitingForGitHub) return false;
  return (
    observation.status === 'completed' &&
    evidence.ordinal === (request.ordinal ?? request.index + 1) &&
    evidence.runId !== request.previousRunId
  );
}
function suspended(store: JobStore, request: StageRequest, delivery: Delivery) {
  return Effect.gen(function* () {
    const saved = yield* store.readWait();
    if (saved?.continuation?.index === request.index)
      return { ...delivery, activity: 'continuation-pending' as const, deadline: saved.deadline };
    if (saved && !saved.nudged && saved.progress !== '')
      yield* store.saveWait({ ...saved, revision: saved.revision + 1, progress: '' });
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
      deadline: now + 3600000,
      nudged: false,
    };
    if (!(yield* store.saveWait(next))) return delivery;
    return { ...delivery, activity: 'waiting-for-github' as const, deadline: next.deadline };
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
    return { ...delivery, activity: 'continuation-pending' as const, deadline: saved.deadline };
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
      previousRunId: evidence.runId,
      ordinal: (request.ordinal ?? request.index + 1) + 1,
      continuation: true,
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
    return { ...delivery, activity: 'continuation-pending' as const, deadline: saved.deadline };
  });
}

function observedProgress(issues: Issues, intent: Intent) {
  return Effect.gen(function* () {
    const pr = yield* issues.pullRequest(intent);
    if (pr.kind !== 'found' || !pr.ci) return null;
    return `${pr.commit}:${pr.ci.progress}`;
  });
}
