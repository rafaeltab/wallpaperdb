import { Effect } from 'effect';
import {
  Unavailable,
  type Delivery,
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
  observation: Observation
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
    if (waiting.index === 3) return yield* readiness(execution, issues, intent, waiting);
    yield* deliver(store, execution, intent, waiting);
    const evidence = yield* execution.inspectStage(intent, waiting);
    const delivery: Delivery = {
      stage: waiting.stage,
      commit: waiting.commit,
      ready: false,
      landed: false,
    };
    const verified = yield* acceptStage(store, evidence, waiting);
    if (!verified) return delivery;
    return yield* advance(store, execution, issues, intent, waiting, verified);
  }).pipe(Effect.withSpan('factory.job.stages'));
}
function accepted(
  evidence: StageEvidence | null,
  request: StageRequest
): evidence is StageEvidence {
  if (!evidence?.accepted) return false;
  if (evidence.ordinal !== request.index + 1 || evidence.runId === request.previousRunId)
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
      stage: waiting.index === 0 ? 'review' : 'publication',
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
    if (next.index === 3) return yield* readiness(execution, issues, intent, next);
    yield* deliver(store, execution, intent, next);
    return { stage: next.stage, commit: next.commit, ready: false, landed: false };
  });
}
function currentStage(store: JobStore) {
  return Effect.gen(function* () {
    for (const index of [3, 2, 1, 0]) {
      const saved = yield* store.readStage(index);
      if (saved) return saved;
    }
    return null;
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
function readiness(execution: Execution, issues: Issues, intent: Intent, accepted: StageRequest) {
  return Effect.gen(function* () {
    const evidence = yield* execution.inspectStage(intent, { ...accepted, index: 2 });
    const pr = yield* issues.pullRequest(intent);
    const matches = publicationMatches(evidence, accepted, pr);
    return {
      stage: 'ci' as const,
      commit: accepted.commit,
      pr,
      ready: matches && pr.kind === 'found' && pr.ready,
      landed: matches && pr.kind === 'found' && pr.landed,
    };
  });
}

function acceptStage(store: JobStore, evidence: StageEvidence | null, request: StageRequest) {
  return Effect.gen(function* () {
    if (!evidence || evidence.ordinal !== request.index + 1) return null;
    if (!(yield* store.bindRun(request, evidence.runId))) return null;
    return accepted(evidence, request) ? evidence : null;
  });
}
