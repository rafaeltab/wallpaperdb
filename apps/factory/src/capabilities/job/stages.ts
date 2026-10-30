import { Effect } from 'effect';
import { watchdog } from './watchdog.js';
import {
  Unavailable,
  type Delivery,
  type Time,
  type Execution,
  type Intent,
  type Issues,
  type JobStore,
  type Observation,
  type StageEvidence,
  type StageRequest,
  type PullRequestObservation,
} from './contract.js';

export function reconcileStages(
  store: JobStore,
  execution: Execution,
  issues: Issues,
  intent: Intent,
  observation: Observation,
  time: Time
) {
  return Effect.gen(function* () {
    if (observation.kind !== 'found') return undefined;
    yield* store.saveStage({
      index: 0,
      stage: 'implementation',
      threadId: observation.threadId,
      commit: intent.base,
      previousRunId: null,
    });
    const waiting = yield* currentStage(store);
    if (!waiting || waiting.threadId !== observation.threadId) return undefined;
    return yield* reconcileStage(store, execution, issues, intent, waiting, observation, time);
  }).pipe(Effect.withSpan('factory.job.stages'));
}
function accepted(
  evidence: StageEvidence | null,
  request: StageRequest
): evidence is StageEvidence {
  if (!evidence?.accepted) return false;
  return request.stage !== 'publication' || evidence.commit === request.commit;
}
function deliver(store: JobStore, execution: Execution, intent: Intent, request: StageRequest) {
  return Effect.gen(function* () {
    if (request.index === 0) return;
    if (yield* store.claimStage(request.index)) yield* execution.sendStage(intent, request);
  });
}
function advance(
  store: JobStore,
  execution: Execution,
  issues: Issues,
  intent: Intent,
  waiting: StageRequest,
  evidence: StageEvidence
) {
  return Effect.gen(function* () {
    const proposed: StageRequest = {
      index: waiting.index + 1,
      stage:
        waiting.stage === 'publication'
          ? 'ci'
          : waiting.stage === 'review'
            ? 'publication'
            : 'review',
      ordinal: evidence.ordinal + (waiting.stage === 'publication' ? 0 : 1),
      threadId: waiting.threadId,
      commit: evidence.commit,
      previousRunId: evidence.runId,
    };
    yield* store.saveStage(proposed);
    const next = yield* store.readStage(proposed.index);
    if (!next)
      return yield* Effect.fail(
        new Unavailable({ operation: 'stage-record-missing', cause: null })
      );
    if (next.stage === 'ci') return yield* readiness(store, execution, issues, intent, next);
    yield* deliver(store, execution, intent, next);
    return { stage: next.stage, commit: next.commit, ready: false, landed: false };
  });
}
export function currentStage(store: JobStore) {
  return Effect.gen(function* () {
    let latest: StageRequest | null = null;
    for (let index = 0; ; index++) {
      const saved = yield* store.readStage(index);
      if (!saved) return latest;
      latest = saved;
    }
  });
}
function publicationMatches(
  evidence: StageEvidence | null,
  accepted: StageRequest,
  pr: PullRequestObservation
) {
  if (!evidence?.accepted || pr.kind !== 'found') return false;
  return (
    evidence.runId === accepted.previousRunId &&
    evidence.commit === accepted.commit &&
    pr.commit === accepted.commit &&
    Boolean(evidence.linked?.includes(pr.url))
  );
}
function readiness(
  store: JobStore,
  execution: Execution,
  issues: Issues,
  intent: Intent,
  accepted: StageRequest
) {
  return Effect.gen(function* () {
    const publication = yield* store.readStage(accepted.index - 1);
    const evidence = publication ? yield* execution.inspectStage(intent, publication) : null;
    const pr = yield* issues.pullRequest(intent);
    const matches = publicationMatches(evidence, accepted, pr);
    if (matches && pr.kind === 'found' && pr.ci?.failed) {
      yield* dispatchRepair(store, execution, intent, accepted, evidence);
      return {
        stage: 'babysitting' as const,
        commit: accepted.commit,
        ready: false,
        landed: false,
        pr,
      };
    }
    return {
      stage: 'ci' as const,
      commit: accepted.commit,
      pr,
      ready: matches && isReady(pr),
      landed: false,
    };
  });
}

function associateStage(store: JobStore, evidence: StageEvidence | null, request: StageRequest) {
  return Effect.gen(function* () {
    if (!associatedRun(evidence, request)) return null;
    if (!(yield* store.bindRun(request, evidence.runId, evidence.ordinal))) return null;
    return evidence;
  });
}

function dispatchRepair(
  store: JobStore,
  execution: Execution,
  intent: Intent,
  accepted: StageRequest,
  evidence: StageEvidence | null
) {
  return Effect.gen(function* () {
    const request: StageRequest = {
      index: accepted.index + 1,
      stage: 'babysitting',
      threadId: accepted.threadId,
      commit: accepted.commit,
      previousRunId: accepted.previousRunId,
      ordinal: (evidence?.ordinal ?? 3) + 1,
    };
    yield* store.saveStage(request);
    const saved = yield* store.readStage(request.index);
    if (saved) yield* deliver(store, execution, intent, saved);
  });
}

function isReady(pr: PullRequestObservation) {
  return pr.kind === 'found' && pr.ready;
}

function reconcileStage(
  store: JobStore,
  execution: Execution,
  issues: Issues,
  intent: Intent,
  waiting: StageRequest,
  observation: Extract<Observation, { kind: 'found' }>,
  time: Time
) {
  return Effect.gen(function* () {
    const control = yield* store.readControl();
    if (control.cancelled)
      return {
        stage: waiting.stage,
        commit: waiting.commit,
        ready: false,
        landed: false,
        activity: 'cancelled' as const,
        active: false,
      };
    if (observation.question) {
      if (
        control.parked?.index !== waiting.index ||
        control.parked.question.id !== observation.question.id
      )
        yield* store.saveControl({
          ...control,
          revision: control.revision + 1,
          parked: { index: waiting.index, question: observation.question },
        });
      if (waiting.stage === 'babysitting')
        yield* watchdog(store, issues, intent, waiting, observation, time, null, (request) =>
          deliver(store, execution, intent, request)
        );
      return {
        stage: waiting.stage,
        commit: waiting.commit,
        ready: false,
        landed: false,
        activity: 'awaiting-answer' as const,
        active: false,
        question: observation.question,
      };
    }
    if (control.parked?.index === waiting.index)
      return {
        stage: waiting.stage,
        commit: waiting.commit,
        ready: false,
        landed: false,
        activity: 'awaiting-answer' as const,
        active: false,
        question: control.parked.question,
      };
    if (waiting.stage === 'ci') return yield* readiness(store, execution, issues, intent, waiting);
    yield* deliver(store, execution, intent, waiting);
    const observed = yield* execution.inspectStage(intent, waiting);
    const evidence = yield* associateStage(store, observed, waiting);
    const delivery: Delivery = {
      stage: waiting.stage,
      commit: waiting.commit,
      ready: false,
      landed: false,
    };
    const verified =
      observation.status === 'completed' && evidence && accepted(evidence, waiting)
        ? evidence
        : null;
    if (!verified) {
      if (waiting.stage === 'babysitting')
        return yield* watchdog(
          store,
          issues,
          intent,
          waiting,
          observation,
          time,
          evidence,
          (request) => deliver(store, execution, intent, request)
        );
      return delivery;
    }
    return yield* advance(store, execution, issues, intent, waiting, verified);
  });
}

function associatedRun(
  evidence: StageEvidence | null,
  request: StageRequest
): evidence is StageEvidence {
  if (!evidence || evidence.runId === request.previousRunId) return false;
  const expected = request.ordinal ?? request.index + 1;
  if (evidence.ordinal === expected) return true;
  return (
    request.stage === 'babysitting' &&
    evidence.ordinal > expected &&
    evidence.stageIndex === request.index
  );
}
