import { Effect } from 'effect';
import {
  type Delivery,
  type Execution,
  type Intent,
  type Issues,
  type JobStore,
  type Observation,
  type PullRequestObservation,
  type StageEvidence,
  type StageRequest,
  type Time,
  Unavailable,
  type ContinuationAdmission,
} from './contract.js';
import { watchdog } from './watchdog.js';
import { stageDeliveryIndex } from './delivery.js';
import { adoptManualRepair, recoverManualRepair, retainManualRepair } from './manual-repair.js';

export function reconcileStages(
  store: JobStore,
  execution: Execution,
  issues: Issues,
  intent: Intent,
  observation: Observation,
  time: Time,
  continuation?: ContinuationAdmission,
  initialIndex = 0
) {
  return Effect.gen(function* () {
    if (observation.kind !== 'found') return undefined;
    if (((yield* store.readControl()).restart?.index ?? 0) !== initialIndex) return undefined;
    yield* store.saveStage({
      index: initialIndex,
      receiptProtocol: intent.receiptProtocol,
      ...(initialIndex > 0 ? { ordinal: 1, deliveryIndex: 0 } : {}),
      stage: 'implementation',
      threadId: observation.threadId,
      commit: intent.base,
      previousRunId: null,
    });
    yield* recoverManualRepair(store);
    const waiting = yield* currentStage(store);
    if (!waiting || waiting.threadId !== observation.threadId) return undefined;
    return yield* reconcileStage(
      store,
      execution,
      issues,
      intent,
      waiting,
      observation,
      time,
      continuation
    );
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
    if (request.previousRunId === null || request.observedRunId) return;
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
      receiptProtocol: 'delivery-v1',
      comparison: nextComparison(waiting),
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
    const stages = new Map<number, StageRequest>();
    for (let index = 0; ; index++) {
      const saved = yield* store.readStage(index);
      if (!saved) return latest;
      stages.set(index, saved);
      const source = stages.get(saved.deliveryIndex ?? saved.index);
      // Pre-upgrade adoptions copied the initial journal position as an alias.
      // Resolve only a proven same-thread initial implementation; preserve the
      // immutable records and every explicitly delivered successor's identity.
      latest =
        !saved.receiptProtocol &&
        saved.stage === 'implementation' &&
        source?.stage === 'implementation' &&
        source.threadId === saved.threadId &&
        source.previousRunId === null
          ? { ...saved, deliveryIndex: stageDeliveryIndex(source) }
          : saved;
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
    evidence.stageIndex === accepted.index - 1 &&
    evidence.commit === accepted.commit &&
    reviewedAssociation(pr, accepted.commit) &&
    Boolean(evidence.linked?.includes(pr.url))
  );
}
function readiness(
  store: JobStore,
  execution: Execution,
  issues: Issues,
  intent: Intent,
  accepted: StageRequest,
  observation?: Extract<Observation, { kind: 'found' }>
) {
  return Effect.gen(function* () {
    const publication = yield* store.readStage(accepted.index - 1);
    const evidence = publication ? yield* execution.inspectStage(intent, publication) : null;
    const pr = yield* issues.pullRequest(intent);
    const retained = (yield* store.readControl()).prerequisite;
    const cached = retainedAssociation(retained, pr);
    const matches = publicationMatches(evidence, accepted, pr) || cached;
    if (manualReplay(pr, accepted.commit, cached))
      return {
        stage: 'ci' as const,
        commit: accepted.commit,
        ready: false,
        landed: false,
        active: false,
        activity: 'manual-recovery' as const,
        pr,
      };
    if (pr.kind === 'found' && (yield* repairAllowed(issues, intent, matches, pr))) {
      yield* dispatchRepair(store, execution, intent, accepted, evidence, pr, observation);
      return {
        stage: 'babysitting' as const,
        commit: pr.commit,
        ready: false,
        landed: false,
        pr,
      };
    }
    const pending = maintenanceDelivery(pr, accepted.commit);
    return pending ?? observedReadiness(pr, matches, accepted.commit);
  });
}

export function associateStage(
  store: JobStore,
  evidence: StageEvidence | null,
  request: StageRequest
) {
  return Effect.gen(function* () {
    if (!associatedRun(evidence, request)) return null;
    const current = yield* currentStage(store);
    if (current?.index !== request.index || (yield* store.readControl()).cancelled) return null;
    if (!(yield* store.bindRun(request, evidence.runId, evidence.ordinal))) return null;
    return evidence;
  });
}

function dispatchRepair(
  store: JobStore,
  execution: Execution,
  intent: Intent,
  accepted: StageRequest,
  evidence: StageEvidence | null,
  pr: Extract<PullRequestObservation, { kind: 'found' }>,
  observation?: Extract<Observation, { kind: 'found' }>
) {
  return Effect.gen(function* () {
    const request: StageRequest = {
      index: accepted.index + 1,
      stage: 'babysitting',
      receiptProtocol: 'delivery-v1',
      threadId: accepted.threadId,
      commit: pr.commit,
      comparison: repairComparison(pr, accepted.commit),
      ...repairRun(accepted, evidence, observation),
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
  time: Time,
  continuation?: ContinuationAdmission
) {
  return Effect.gen(function* () {
    const suspended = yield* suspension(store, waiting, observation);
    if (suspended) {
      yield* questionInterruption(store, execution, issues, intent, waiting, observation, time);
      return suspended;
    }
    if (waiting.stage === 'ci')
      return yield* readiness(store, execution, issues, intent, waiting, observation);
    yield* deliver(store, execution, intent, waiting);
    const observed = yield* execution.inspectStage(intent, waiting);
    const evidence = yield* associateStage(store, observed, waiting);
    const delivery: Delivery = {
      stage: waiting.stage,
      commit: waiting.commit,
      ready: false,
      landed: false,
    };
    const verified = completedEvidence(observation, evidence, waiting) ? evidence : null;
    if (!verified)
      return yield* pendingDelivery(
        store,
        execution,
        issues,
        intent,
        waiting,
        observation,
        time,
        evidence,
        delivery
      );
    // This run has conclusively finished. A pending journal or descendant
    // recovery keeps the receipt unaccepted, without occupying another worker slot.
    if (!(yield* acceptReplayRepair(issues, intent, waiting, verified)))
      return { ...delivery, active: false };
    if (!(yield* continuationAllowed(intent, waiting, verified, continuation)))
      return { ...delivery, active: false };
    return yield* advance(store, execution, issues, intent, waiting, verified);
  });
}

function associatedRun(
  evidence: StageEvidence | null,
  request: StageRequest
): evidence is StageEvidence {
  return (
    evidence !== null &&
    evidence.stageIndex === request.index &&
    (!request.observedRunId || request.ordinal === undefined || evidence.ordinal >= request.ordinal)
  );
}

function suspension(
  store: JobStore,
  waiting: StageRequest,
  observation: Extract<Observation, { kind: 'found' }>
) {
  return Effect.gen(function* () {
    const control = yield* controlForStage(store, waiting);
    if (control.cancelled)
      return {
        stage: waiting.stage,
        commit: waiting.commit,
        ready: false,
        landed: false,
        activity: 'cancelled' as const,
        active: false,
      };
    // These ordinals describe observations already made, never a predicted next turn.
    const observedOrdinal = Math.max(
      waiting.observedRunId ? (waiting.ordinal ?? 0) : 0,
      control.parked?.index === waiting.index ? (control.parked.run?.ordinal ?? 0) : 0
    );
    if (observation.run && observation.run.ordinal < observedOrdinal)
      return control.parked?.index === waiting.index
        ? parkedDelivery(waiting, control)
        : { stage: waiting.stage, commit: waiting.commit, ready: false, landed: false };
    if (answerContinuation(control, waiting, observation))
      return yield* adoptAnswer(store, waiting, observation, control);
    const repaired = yield* adoptManualRepair(store, waiting, observation, control);
    if (repaired) return adoptedDelivery(repaired, observation);
    if (observation.question) {
      if (changedPark(control, waiting, observation.question))
        yield* store.saveControl({
          ...control,
          revision: control.revision + 1,
          parked: { index: waiting.index, run: observation.run, question: observation.question },
        });
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
    if (control.parked?.index === waiting.index) {
      if (hasAnsweredQuestion(observation, control.parked.question.id))
        return yield* adoptAnswer(store, waiting, observation, control);
      return {
        stage: waiting.stage,
        commit: waiting.commit,
        ready: false,
        landed: false,
        activity: 'awaiting-answer' as const,
        active: false,
        question: control.parked.question,
      };
    }
    return undefined;
  });
}
function completedEvidence(
  observation: Extract<Observation, { kind: 'found' }>,
  evidence: StageEvidence | null,
  waiting: StageRequest
): evidence is StageEvidence {
  return observation.status === 'completed' && evidence !== null && accepted(evidence, waiting);
}
function questionInterruption(
  store: JobStore,
  execution: Execution,
  issues: Issues,
  intent: Intent,
  waiting: StageRequest,
  observation: Extract<Observation, { kind: 'found' }>,
  time: Time
) {
  return Effect.gen(function* () {
    if (observation.question && waiting.stage === 'babysitting')
      yield* watchdog(store, issues, intent, waiting, observation, time, null, (request) =>
        deliver(store, execution, intent, request)
      );
  });
}
function pendingDelivery(
  store: JobStore,
  execution: Execution,
  issues: Issues,
  intent: Intent,
  waiting: StageRequest,
  observation: Extract<Observation, { kind: 'found' }>,
  time: Time,
  evidence: StageEvidence | null,
  delivery: Delivery
) {
  const run = observation.run;
  if (
    waiting.stage === 'implementation' &&
    ['completed', 'failed', 'interrupted', 'cancelled'].includes(observation.status) &&
    evidence !== null &&
    run !== undefined &&
    evidence.runId === run.id
  )
    return Effect.gen(function* () {
      yield* retainManualRepair(store, waiting, run);
      return {
        ...delivery,
        activity: 'manual-recovery' as const,
        active: false,
        progress: 'Implementation finished without a validated success receipt.',
      };
    });
  if (waiting.stage === 'babysitting')
    return Effect.gen(function* () {
      const reconciled = yield* terminalCI(store, issues, intent, waiting, observation, evidence);
      if (reconciled) return reconciled;
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
    });
  return Effect.succeed(delivery);
}

function changedPark(
  control: import('./contract.js').Control,
  waiting: StageRequest,
  question: { id: string }
) {
  return control.parked?.index !== waiting.index || control.parked.question.id !== question.id;
}

function adoptAnswer(
  store: JobStore,
  waiting: StageRequest,
  observation: Extract<Observation, { kind: 'found' }>,
  control: import('./contract.js').Control
) {
  return Effect.gen(function* () {
    const parkedRun = control.parked?.run;
    const run = observation.run;
    if (run && parkedRun && run.id !== parkedRun.id) {
      if (run.ordinal <= parkedRun.ordinal) return parkedDelivery(waiting, control);
      const request: StageRequest = {
        ...waiting,
        index: waiting.index + 1,
        ordinal: run.ordinal,
        previousRunId: parkedRun.id,
        observedRunId: run.id,
        question: observation.question,
        deliveryIndex: stageDeliveryIndex(waiting),
        resume: false,
      };
      yield* store.saveStage(request);
      return adoptedDelivery(waiting, observation);
    }
    // A message-mode answer may be committed before its continuation run is created.
    // Keep the association until that run appears or this original run is accepted.
    return undefined;
  });
}

function parkedDelivery(waiting: StageRequest, control: import('./contract.js').Control): Delivery {
  return {
    stage: waiting.stage,
    commit: waiting.commit,
    ready: false,
    landed: false,
    activity: 'awaiting-answer',
    active: false,
    question: control.parked?.question,
  };
}

export function hasAnsweredQuestion(observation: Observation, questionId: string) {
  return (
    observation.kind === 'found' && observation.answeredQuestions?.includes(questionId) === true
  );
}

function answerContinuation(
  control: import('./contract.js').Control,
  waiting: StageRequest,
  observation: Extract<Observation, { kind: 'found' }>
) {
  if (control.parked?.index !== waiting.index) return false;
  if (!hasAnsweredQuestion(observation, control.parked.question.id)) return false;
  return Boolean(
    observation.run &&
      control.parked.run &&
      observation.run.id !== control.parked.run.id &&
      observation.run.ordinal > control.parked.run.ordinal
  );
}
function adoptedDelivery(
  waiting: StageRequest,
  observation: Extract<Observation, { kind: 'found' }>
): Delivery {
  if (observation.question)
    return {
      stage: waiting.stage,
      commit: waiting.commit,
      ready: false,
      landed: false,
      activity: 'awaiting-answer',
      active: false,
      question: observation.question,
    };
  return {
    stage: waiting.stage,
    commit: waiting.commit,
    ready: false,
    landed: false,
    activity: 'resume-pending',
    active: true,
  };
}
function controlForStage(store: JobStore, waiting: StageRequest) {
  return Effect.gen(function* () {
    const saved = yield* store.readControl();
    if (!canRestoreQuestion(saved, waiting)) return saved;
    const next = {
      ...saved,
      revision: saved.revision + 1,
      parked: {
        index: waiting.index,
        run: { id: waiting.observedRunId, ordinal: waiting.ordinal ?? waiting.index + 1 },
        question: waiting.question,
      },
    };
    if (yield* store.saveControl(next)) return next;
    return yield* store.readControl();
  });
}
function canRestoreQuestion(
  control: import('./contract.js').Control,
  waiting: StageRequest
): waiting is StageRequest & { observedRunId: string; question: { id: string; text: string } } {
  if (control.parked && control.parked.index >= waiting.index) return false;
  return waiting.observedRunId !== undefined && waiting.question !== undefined;
}

function reviewedAssociation(
  pr: Extract<PullRequestObservation, { kind: 'found' }>,
  commit: string
) {
  return pr.commit === commit || pr.reviewedCommit === commit;
}
function requiresRepair(matches: boolean, pr: PullRequestObservation) {
  return (
    matches &&
    pr.kind === 'found' &&
    pr.ci?.failed &&
    !pr.manualRecovery &&
    (!pr.reviewedCommit || Boolean(pr.parent && pr.base))
  );
}
function deliveryIdentity(pr: PullRequestObservation, commit: string) {
  return pr.kind === 'found'
    ? { commit: pr.commit, reviewedCommit: pr.reviewedCommit }
    : { commit };
}

function isLanded(pr: PullRequestObservation) {
  return pr.kind === 'found' && pr.landed;
}
function requiresManualRecovery(pr: PullRequestObservation, commit: string) {
  return (
    pr.kind === 'found' &&
    (pr.manualRecovery === true || (!pr.maintenancePending && !reviewedAssociation(pr, commit)))
  );
}

function maintenanceDelivery(pr: PullRequestObservation, commit: string): Delivery | null {
  if (pr.kind !== 'found' || !pr.maintenancePending) return null;
  return {
    stage: 'ci',
    ...deliveryIdentity(pr, commit),
    pr,
    ready: false,
    landed: false,
    active: true,
  };
}
function observedReadiness(pr: PullRequestObservation, matches: boolean, commit: string): Delivery {
  const landed = matches && isLanded(pr);
  return {
    stage: 'ci',
    ...deliveryIdentity(pr, commit),
    pr,
    ready: matches && isReady(pr),
    landed,
    active: landed ? false : undefined,
  };
}

function retainedAssociation(
  retained: import('./contract.js').AcceptedPublication | undefined,
  pr: PullRequestObservation
) {
  return (
    pr.kind === 'found' &&
    retained?.url === pr.url &&
    pr.reviewedCommit === (retained.reviewedCommit ?? retained.commit)
  );
}
function repairComparison(
  pr: Extract<PullRequestObservation, { kind: 'found' }>,
  previous: string
): StageRequest['comparison'] {
  if (!pr.reviewedCommit || !pr.parent || !pr.base) return undefined;
  return {
    base: pr.parent,
    prBase: pr.base,
    previousHead: pr.previousHead ?? previous,
    owningHeads: pr.owningHeads,
  };
}
function repairAllowed(
  issues: Issues,
  intent: Intent,
  matches: boolean,
  pr: Extract<PullRequestObservation, { kind: 'found' }>
) {
  if (!requiresRepair(matches, pr)) return Effect.succeed(false);
  if (!pr.reviewedCommit) return Effect.succeed(true);
  return issues.repairReplay?.(intent, pr.commit) ?? Effect.succeed(false);
}
function acceptReplayRepair(
  issues: Issues,
  intent: Intent,
  waiting: StageRequest,
  evidence: StageEvidence
) {
  if (!waiting.comparison) return Effect.succeed(true);
  if (waiting.stage !== 'babysitting' && !reviewedReplayChanged(waiting, evidence))
    return Effect.succeed(true);
  return (
    issues.repairReplay?.(
      intent,
      waiting.commit,
      evidence.commit,
      replayAuthority(waiting, evidence)
    ) ?? Effect.succeed(false)
  );
}

function replayAuthority(request: StageRequest, evidence: StageEvidence) {
  return request.stage === 'babysitting' ? undefined : { request, evidence };
}

function reviewedReplayChanged(waiting: StageRequest, evidence: StageEvidence) {
  if (waiting.stage === 'review') return waiting.commit !== evidence.commit;
  return waiting.stage === 'publication' && waiting.commit !== waiting.comparison?.previousHead;
}

function manualReplay(pr: PullRequestObservation, commit: string, cached: boolean) {
  if (pr.kind === 'found' && pr.manualRecovery) return true;
  return requiresManualRecovery(pr, commit) && !cached;
}

function repairRun(
  accepted: StageRequest,
  evidence: StageEvidence | null,
  observation?: Extract<Observation, { kind: 'found' }>
) {
  const run = observation?.run;
  if (run) return { previousRunId: run.id, ordinal: run.ordinal + 1 };
  return {
    previousRunId: accepted.previousRunId,
    ordinal: predecessorOrdinal(accepted, evidence) + 1,
  };
}

function predecessorOrdinal(accepted: StageRequest, evidence: StageEvidence | null) {
  const ordinal = evidence ? evidence.ordinal : accepted.ordinal;
  return ordinal ?? 3;
}

function nextComparison(waiting: StageRequest): StageRequest['comparison'] {
  if (waiting.stage !== 'review' || !waiting.comparison) return waiting.comparison;
  return { ...waiting.comparison, previousHead: waiting.commit };
}

function continuationAllowed(
  intent: Intent,
  request: StageRequest,
  evidence: StageEvidence,
  admission?: ContinuationAdmission
) {
  return Effect.gen(function* () {
    if (!request.comparison || !admission) return true;
    return yield* admission.authorize(intent.issue, {
      threadId: request.threadId,
      index: request.index,
      run: { id: evidence.runId, ordinal: evidence.ordinal },
    });
  });
}

function terminalCI(
  store: JobStore,
  issues: Issues,
  intent: Intent,
  waiting: StageRequest,
  observation: Extract<Observation, { kind: 'found' }>,
  evidence: StageEvidence | null
) {
  return Effect.gen(function* () {
    if (!terminalEvidence(observation, evidence, waiting.commit)) return null;
    if (!(yield* acceptedPublication(store, waiting))) return null;
    const pr = yield* issues.pullRequest(intent);
    if (!successfulPublication(pr, waiting.commit)) return null;
    return {
      stage: 'ci' as const,
      commit: waiting.commit,
      ready: pr.ready,
      landed: pr.landed,
      active: false,
      pr,
    };
  });
}
function acceptedPublication(store: JobStore, waiting: StageRequest) {
  return Effect.gen(function* () {
    // Entering CI is durable evidence that the publication receipt was accepted.
    // A failed babysitter cannot substitute a different commit for that acceptance.
    for (let index = 0; index < waiting.index; index++) {
      const stage = yield* store.readStage(index);
      if (sameAcceptedCode(stage, waiting)) return true;
    }
    return false;
  });
}
function successfulPublication(
  pr: PullRequestObservation,
  commit: string
): pr is Extract<PullRequestObservation, { kind: 'found' }> {
  return (
    pr.kind === 'found' &&
    pr.commit === commit &&
    !pr.manualRecovery &&
    !pr.maintenancePending &&
    (pr.ready || pr.landed)
  );
}

function terminalEvidence(
  observation: Extract<Observation, { kind: 'found' }>,
  evidence: StageEvidence | null,
  commit: string
) {
  return (
    ['failed', 'interrupted'].includes(observation.status) &&
    evidence !== null &&
    observation.run?.id === evidence.runId &&
    evidence.commit === commit &&
    evidence.worktreeClean === true
  );
}

function sameAcceptedCode(stage: StageRequest | null, waiting: StageRequest) {
  return (
    stage?.stage === 'ci' &&
    stage.commit === waiting.commit &&
    stage.previousRunId !== null &&
    JSON.stringify(stage.comparison) === JSON.stringify(waiting.comparison)
  );
}
