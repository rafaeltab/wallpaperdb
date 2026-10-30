import { Effect } from 'effect';
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
    if (waiting.stage === 'ci' || waiting.index === 3)
      return yield* readiness(store, execution, issues, intent, waiting);
    yield* deliver(store, execution, intent, waiting);
    const evidence = yield* execution.inspectStage(intent, waiting);
    const delivery: Delivery = {
      stage: waiting.stage,
      commit: waiting.commit,
      ready: false,
      landed: false,
    };
    const verified = yield* acceptStage(store, evidence, waiting);
    if (!verified) {
      if (waiting.stage === 'babysitting')
        return yield* watchdog(
          store,
          execution,
          issues,
          intent,
          waiting,
          observation,
          time,
          evidence
        );
      return delivery;
    }
    return yield* advance(store, execution, issues, intent, waiting, verified);
  }).pipe(Effect.withSpan('factory.job.stages'));
}
function accepted(
  evidence: StageEvidence | null,
  request: StageRequest
): evidence is StageEvidence {
  if (!evidence?.accepted) return false;
  if (
    evidence.ordinal !== (request.ordinal ?? request.index + 1) ||
    evidence.runId === request.previousRunId
  )
    return false;
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
function currentStage(store: JobStore) {
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
      ready: matches && pr.kind === 'found' && pr.ready,
      landed: matches && pr.kind === 'found' && pr.landed,
    };
  });
}

function watchdog(
  store: JobStore,
  execution: Execution,
  issues: Issues,
  intent: Intent,
  request: StageRequest,
  observation: Extract<Observation, { kind: 'found' }>,
  time: Time,
  evidence: StageEvidence | null
) {
  return Effect.gen(function* () {
    const delivery: Delivery = {
      stage: 'babysitting',
      activity: 'repairing',
      commit: request.commit,
      ready: false,
      landed: false,
    };
    // Only a finished babysitting turn can be stuck awaiting a missed GitHub wake.
    // Running work and pending human questions do not authorize a continuation.
    if (
      observation.status !== 'completed' ||
      !evidence?.waitingForGitHub ||
      evidence.ordinal !== (request.ordinal ?? request.index + 1)
    ) {
      const saved = yield* store.readWait();
      if (saved?.continuation?.index === request.index)
        return { ...delivery, activity: 'continuation-pending' as const, deadline: saved.deadline };
      if (saved && !saved.nudged && saved.progress !== '')
        yield* store.saveWait({ ...saved, revision: saved.revision + 1, progress: '' });
      return delivery;
    }
    if (
      evidence.runId === request.previousRunId ||
      !(yield* store.bindRun(request, evidence.runId))
    )
      return delivery;
    const pr = yield* issues.pullRequest(intent);
    if (pr.kind !== 'found' || !pr.ci) return delivery;
    const progress = `${pr.commit}:${pr.ci.progress}`;
    const now = yield* time.now();
    const saved = yield* store.readWait();
    if (!saved || saved.progress !== progress) {
      yield* store.saveWait({
        revision: (saved?.revision ?? -1) + 1,
        progress,
        deadline: now + 3600000,
        nudged: false,
      });
      return { ...delivery, activity: 'waiting-for-github' as const, deadline: now + 3600000 };
    }
    if (saved.nudged) {
      if (saved.continuation && saved.continuation.index > request.index) {
        yield* store.saveStage(saved.continuation);
        yield* deliver(store, execution, intent, saved.continuation);
      }
      return { ...delivery, activity: 'continuation-pending' as const, deadline: saved.deadline };
    }
    if (now < saved.deadline)
      return { ...delivery, activity: 'waiting-for-github' as const, deadline: saved.deadline };
    // Persist the new stage before claiming delivery. A lost CLI response stays
    // pending; neither restart nor replay grants a second non-idempotent send.
    const continuation: StageRequest = {
      ...request,
      index: request.index + 1,
      commit: evidence.commit,
      previousRunId: evidence.runId,
      ordinal: (request.ordinal ?? request.index + 1) + 1,
      continuation: true,
    };
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
    if (winning) yield* deliver(store, execution, intent, winning);
    return delivery;
  });
}

function acceptStage(store: JobStore, evidence: StageEvidence | null, request: StageRequest) {
  return Effect.gen(function* () {
    if (!evidence || evidence.ordinal !== (request.ordinal ?? request.index + 1)) return null;
    if (!(yield* store.bindRun(request, evidence.runId))) return null;
    return accepted(evidence, request) ? evidence : null;
  });
}
