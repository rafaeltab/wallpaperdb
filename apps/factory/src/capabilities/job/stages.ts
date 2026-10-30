import { Effect } from 'effect';
import type {
  Delivery,
  Execution,
  Intent,
  Issues,
  JobStore,
  Observation,
  StageRequest,
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
    const initial: StageRequest = {
      index: 0,
      stage: 'implementation',
      threadId: observation.threadId,
      commit: intent.base,
      previousRunId: null,
    };
    yield* store.saveStage(initial);
    const waiting = yield* currentStage(store);
    if (!waiting || waiting.threadId !== observation.threadId) return undefined;
    if (waiting.index === 3) return yield* readiness(execution, issues, intent, waiting);
    if (waiting.index > 0 && (yield* store.claimStage(waiting.index)))
      yield* execution.sendStage(intent, waiting);
    const evidence = yield* execution.inspectStage(intent, waiting);
    const delivery: Delivery = {
      stage: waiting.stage,
      commit: waiting.commit,
      ready: false,
      landed: false,
    };
    if (
      !evidence?.accepted ||
      evidence.ordinal !== waiting.index + 1 ||
      evidence.runId === waiting.previousRunId
    )
      return delivery;
    if (waiting.stage === 'publication' && evidence.commit !== waiting.commit) return delivery;
    const next: StageRequest = {
      index: waiting.index + 1,
      stage: waiting.index === 0 ? 'review' : 'publication',
      threadId: waiting.threadId,
      commit: evidence.commit,
      previousRunId: evidence.runId,
    };
    yield* store.saveStage(next);
    if (next.index === 3) return yield* readiness(execution, issues, intent, next);
    if (yield* store.claimStage(next.index)) yield* execution.sendStage(intent, next);
    return { ...delivery, stage: next.stage, commit: next.commit };
  }).pipe(Effect.withSpan('factory.job.stages'));
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
function readiness(execution: Execution, issues: Issues, intent: Intent, accepted: StageRequest) {
  return Effect.gen(function* () {
    const request = { ...accepted, index: 2 };
    const evidence = yield* execution.inspectStage(intent, request);
    const pr = yield* issues.pullRequest(intent);
    const matches =
      evidence?.accepted &&
      evidence.runId === accepted.previousRunId &&
      evidence.commit === accepted.commit &&
      pr.kind === 'found' &&
      pr.commit === accepted.commit &&
      evidence.linked?.includes(pr.url);
    return {
      stage: 'ci' as const,
      commit: accepted.commit,
      pr,
      ready: Boolean(matches && pr.kind === 'found' && pr.ready),
      landed: Boolean(matches && pr.kind === 'found' && pr.landed),
    };
  });
}
