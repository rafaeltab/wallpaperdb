import { dependencyHandback } from './handback.js';
import { recoverReconciliation, requestReconciliation } from './reconciliation.js';
import { Effect } from 'effect';
import {
  defaultAgentReconciliationLimit,
  type Delivery,
  type Control,
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
import { watchdog, endWait } from './watchdog.js';
import { stageDeliveryIndex } from './delivery.js';
import { adoptManualRepair, recoverManualRepair, retainManualRepair } from './manual-repair.js';

export function retainInitialStage(
  store: JobStore,
  intent: Intent,
  index: number,
  threadId: string
) {
  return store.saveStage({
    index,
    receiptProtocol: intent.receiptProtocol,
    ...(index > 0 ? { ordinal: 1, deliveryIndex: 0 } : {}),
    stage: 'implementation',
    threadId,
    commit: intent.base,
    previousRunId: null,
  });
}

export function reconcileStages(
  store: JobStore,
  execution: Execution,
  issues: Issues,
  intent: Intent,
  observation: Observation,
  time: Time,
  continuation: ContinuationAdmission | undefined,
  authority: Control,
  reconciliationLimit = defaultAgentReconciliationLimit
) {
  return Effect.gen(function* () {
    const initialIndex = authority.restart?.index ?? 0;
    if (((yield* store.readControl()).restart?.index ?? 0) !== initialIndex) return undefined;
    // Landing is an external delivery fact, independent of the worker receipt.
    // Check it before recovering or sending any further stage instructions.
    if (
      (observation.kind === 'found' || observation.kind === 'unverified') &&
      ['completed', 'idle', 'failed', 'interrupted', 'cancelled', 'rolled_back'].includes(
        observation.status
      )
    ) {
      const pr = yield* issues.pullRequest(intent).pipe(Effect.catch(() => Effect.succeed(null)));
      if (pr?.kind === 'found' && pr.landed && execution.isIdle) {
        const idle = yield* execution
          .isIdle(observation.threadId, observation.run?.id ?? null)
          .pipe(Effect.catch(() => Effect.succeed(false)));
        return {
          stage: 'ci' as const,
          commit: pr.commit,
          pr,
          ready: false,
          landed: idle,
          active: !idle,
          progress: idle ? undefined : 'Landing verified; managed work is active or unverified.',
        };
      }
    }
    if (observation.kind !== 'found') return undefined;
    yield* retainInitialStage(store, intent, initialIndex, observation.threadId);
    yield* recoverManualRepair(store);
    yield* recoverReconciliation(store);
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
      continuation,
      reconciliationLimit,
      authority
    );
  }).pipe(Effect.withSpan('factory.job.stages'));
}
function deliver(store: JobStore, execution: Execution, intent: Intent, request: StageRequest) {
  return Effect.gen(function* () {
    if (request.previousRunId === null || request.observedRunId) return;
    if (yield* store.claimStage(request.index)) {
      const control = yield* store.readControl();
      if (
        !control.cancelled &&
        !control.released &&
        !control.retirement &&
        !control.dependencyRecovery
      )
        yield* execution.sendStage(intent, request);
    }
  });
}
function advance(
  store: JobStore,
  execution: Execution,
  issues: Issues,
  intent: Intent,
  waiting: StageRequest,
  evidence: StageEvidence,
  time: Time
) {
  return Effect.gen(function* () {
    if (waiting.stage === 'babysitting') yield* endWait(store);
    const proposed: StageRequest = {
      publicationStartedAt: waiting.stage === 'review' ? yield* time.now() : undefined,
      ciRepair: waiting.ciRepair || waiting.stage === 'babysitting' || undefined,
      ciStartedAt: waiting.stage === 'publication' ? yield* time.now() : undefined,
      index: waiting.index + 1,
      receiptProtocol: 'delivery-v1',
      comparison: nextComparison(waiting),
      acceptedBase: evidence.base ?? waiting.acceptedBase,
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
/** Read-only provenance for retained journals created before reporting markers existed. */
export function ciRepairOrigin(store: JobStore, request: StageRequest | null) {
  return Effect.gen(function* () {
    if (!request) return false;
    for (let index = request.index; index >= 0; index--) {
      const source = index === request.index ? request : yield* store.readStage(index);
      if (!source || source.threadId !== request.threadId) return false;
      if (source.ciRepair || source.stage === 'babysitting') return true;
      if (source.stage === 'implementation' && source.previousRunId === null) return false;
    }
    return false;
  });
}

function publicationMatches(
  evidence: StageEvidence | null,
  accepted: StageRequest,
  pr: PullRequestObservation,
  manual = false
) {
  if (!evidence?.accepted || pr.kind !== 'found') return false;
  return (
    evidence.stageIndex === accepted.index - 1 &&
    (evidence.commit === accepted.commit || manual) &&
    reviewedAssociation(pr, evidence.commit) &&
    Boolean(evidence.linked?.includes(pr.url))
  );
}
function readiness(
  store: JobStore,
  execution: Execution,
  issues: Issues,
  intent: Intent,
  accepted: StageRequest,
  observation?: Extract<Observation, { kind: 'found' }>,
  reconciliationLimit = defaultAgentReconciliationLimit
) {
  return Effect.gen(function* () {
    const publication = yield* store.readStage(accepted.index - 1);
    const evidence = publication ? yield* execution.inspectStage(intent, publication) : null;
    const pr = yield* issues.pullRequest(intent);
    const retained = (yield* store.readControl()).prerequisite;
    const cached = retainedAssociation(retained, pr);
    const fresh = publicationMatches(evidence, accepted, pr, !!observation?.manual);
    // A fresh fully checked/reviewed/published state can update readiness after
    // manual work. The accepted stage journal remains immutable and never rewinds.
    const commit = fresh && evidence ? evidence.commit : accepted.commit;
    const verifiedCommit =
      pr.kind === 'found' && retained?.url === pr.url && retained.base === pr.base
        ? retained.commit
        : accepted.commit;
    const unchanged =
      observation?.manual &&
      evidence?.worktreeClean === true &&
      evidence.idle !== false &&
      !evidence.responseObserved &&
      evidence.commit === verifiedCommit &&
      pr.kind === 'found' &&
      pr.commit === verifiedCommit &&
      ['completed', 'idle'].includes(observation.status);
    const ownerActive =
      observation &&
      !['completed', 'idle', 'failed', 'interrupted', 'cancelled', 'rolled_back'].includes(
        observation.status
      );
    const matches = fresh || !!unchanged || (!observation?.manual && !ownerActive && cached);
    if (
      (pr.kind === 'found' && pr.manualRecovery) ||
      (manualReplay(pr, commit, cached) && !observation?.manual)
    )
      return {
        stage: 'ci' as const,
        commit: accepted.commit,
        ready: false,
        landed: false,
        active: false,
        activity: 'manual-recovery' as const,
        pr,
      };
    if (!observation?.manual && !matches && publication && evidence?.migrationRequired) {
      // Older installations already entered CI using legacy publication receipts.
      // Retain that history and append migration after the current CI record.
      const migration = yield* requestReconciliation(
        store,
        { ...publication, index: accepted.index },
        evidence,
        reconciliationLimit
      );
      if (migration) return migration;
    }
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
    const pending = maintenanceDelivery(pr, commit);
    const result = pending ?? observedReadiness(pr, matches, commit);
    if (
      (matches || pending !== null) &&
      !ownerActive &&
      pr.kind === 'found' &&
      !result.ready &&
      !result.landed &&
      !pr.manualRecovery
    )
      return {
        ...result,
        activity: 'waiting-for-ci' as const,
        // A retained ready publication ends the original interval. Its later rerun has no known start.
        waitStartedAt:
          pr.commit === accepted.commit &&
          !observation?.manual &&
          !(retained?.url === pr.url && retained.commit === pr.commit && retained.base === pr.base)
            ? accepted.ciStartedAt
            : undefined,
      };
    return result;
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
    const control = yield* store.readControl();
    if (
      current?.index !== request.index ||
      control.cancelled ||
      control.released ||
      !stageRunOrder(current, control, { id: evidence.runId, ordinal: evidence.ordinal })
    )
      return null;
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
      ciRepair: true,
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
  continuation: ContinuationAdmission | undefined,
  reconciliationLimit: number,
  authority: Control
) {
  return Effect.gen(function* () {
    const control = yield* controlForStage(store, waiting);
    if (
      !control.cancelled &&
      !control.released &&
      observation.run &&
      !stageRunOrder(waiting, control, observation.run)
    )
      return control.parked?.index === waiting.index
        ? parkedDelivery(waiting, control)
        : { stage: waiting.stage, commit: waiting.commit, ready: false, landed: false };
    const suspended = yield* suspension(store, waiting, observation, control);
    if (suspended) {
      yield* questionInterruption(store, execution, issues, intent, waiting, observation, time);
      return suspended;
    }
    if (waiting.stage === 'ci')
      return yield* readiness(
        store,
        execution,
        issues,
        intent,
        waiting,
        observation,
        reconciliationLimit
      );
    yield* deliver(store, execution, intent, waiting);
    const observed = yield* execution.inspectStage(intent, waiting);
    const evidence = yield* associateStage(store, observed, waiting);
    const handback = yield* dependencyHandback(
      store,
      issues,
      intent,
      waiting,
      evidence,
      reconciliationLimit,
      authority
    );
    if (handback) {
      const next = yield* currentStage(store);
      if (next) yield* deliver(store, execution, intent, next);
      return handback;
    }
    const delivery: Delivery = {
      stage: waiting.stage,
      commit: waiting.commit,
      ready: false,
      landed: false,
    };
    if (evidence?.unexpectedBase)
      return {
        ...delivery,
        active: false,
        activity: 'manual-recovery' as const,
        progress: 'Unexpected comparison base; manual recovery required.',
      };
    const verified = completedEvidence(evidence) ? evidence : null;
    const publication =
      verified && ['publication', 'babysitting'].includes(waiting.stage)
        ? yield* issues.pullRequest(intent)
        : null;
    const publicationValid =
      !publication ||
      (publication.kind === 'found' &&
        publication.commit === verified?.commit &&
        Boolean(verified?.linked?.includes(publication.url)));
    if (!verified || !publicationValid) {
      if (waiting.stage === 'babysitting') {
        const reconciled = yield* terminalCI(store, issues, intent, waiting, observation, evidence);
        if (reconciled) return reconciled;
      }
      const reconciliation = yield* requestReconciliation(
        store,
        waiting,
        verified && !publicationValid
          ? { ...verified, rejection: { kind: 'publication-mismatch' as const } }
          : evidence,
        reconciliationLimit
      );
      if (reconciliation) return reconciliation;
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
    }
    // This run has conclusively finished. A pending journal or descendant
    // recovery keeps the receipt unaccepted, without occupying another worker slot.
    if (!(yield* acceptReplayRepair(issues, intent, waiting, verified)))
      return { ...delivery, active: false };
    if (!(yield* continuationAllowed(intent, waiting, verified, continuation)))
      return { ...delivery, active: false };
    return yield* advance(store, execution, issues, intent, waiting, verified, time);
  });
}

function associatedRun(
  evidence: StageEvidence | null,
  request: StageRequest
): evidence is StageEvidence {
  return (
    evidence !== null &&
    evidence.stageIndex === request.index &&
    // Delivered ordinals encode a lower bound after the accepted predecessor,
    // not the one turn expected to complete this delivery.
    (request.observedRunId !== undefined ||
      request.previousRunId === null ||
      request.ordinal === undefined ||
      evidence.ordinal >= request.ordinal)
  );
}

export function stageRunOrder(
  waiting: StageRequest,
  control: import('./contract.js').Control,
  run: { readonly id: string; readonly ordinal: number }
) {
  const retained =
    waiting.ordinal === undefined
      ? undefined
      : waiting.observedRunId
        ? { id: waiting.observedRunId, ordinal: waiting.ordinal }
        : waiting.previousRunId
          ? {
              id: waiting.previousRunId,
              ordinal: waiting.ordinal - (waiting.stage === 'ci' ? 0 : 1),
            }
          : undefined;
  const observations = [
    retained,
    control.parked?.index === waiting.index ? control.parked.run : undefined,
    control.manualRepair?.index === waiting.index ? control.manualRepair.run : undefined,
  ];
  return (
    !control.cancelled &&
    !control.released &&
    observations.every(
      (prior) =>
        !prior ||
        run.ordinal > prior.ordinal ||
        (run.ordinal === prior.ordinal && run.id === prior.id)
    )
  );
}

function suspension(
  store: JobStore,
  waiting: StageRequest,
  observation: Extract<Observation, { kind: 'found' }>,
  control: import('./contract.js').Control
) {
  return Effect.gen(function* () {
    if (control.released)
      return {
        stage: waiting.stage,
        commit: waiting.commit,
        ready: false,
        landed: false,
        activity: 'dependency-handback' as const,
        active: false,
      };
    if (control.cancelled)
      return {
        stage: waiting.stage,
        commit: waiting.commit,
        ready: false,
        landed: false,
        activity: 'cancelled' as const,
        active: false,
      };
    if (control.dependencyRecovery)
      return {
        stage: waiting.stage,
        commit: waiting.commit,
        ready: false,
        landed: false,
        activity: 'manual-recovery' as const,
        active: false,
        progress: control.dependencyRecovery.progress,
      };
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
function completedEvidence(evidence: StageEvidence | null): evidence is StageEvidence {
  return evidence?.accepted === true;
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
  if (evidence?.idle === false && waiting.stage !== 'babysitting')
    return Effect.succeed({ ...delivery, active: true });
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
    return watchdog(store, issues, intent, waiting, observation, time, evidence, (request) =>
      deliver(store, execution, intent, request)
    );
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
    (pr.reviewedCommit ?? (pr.landed ? pr.commit : undefined)) ===
      (retained.reviewedCommit ?? retained.commit)
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
    yield* endWait(store);
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
    evidence.worktreeClean === true &&
    evidence.idle !== false &&
    evidence.dependencies === undefined
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
