import { retryAction, retryStage } from './retry.js';
import { attemptIntent, matchesRestart, restartAction } from './restart.js';
import { Effect, Layer, Random, Option } from 'effect';
import {
  reconcileStages,
  currentStage,
  controlForStage,
  ciRepairOrigin,
  hasAnsweredQuestion,
  stageRunOrder,
  answerRunCurrent,
  retainInitialStage,
} from './stages.js';
import {
  AgentReconciliationPolicy,
  defaultAgentReconciliationLimit,
  JobReporting,
  Execution,
  Issues,
  Job,
  JobStore,
  type Start,
  type Intent,
  type Delivery,
  type Status,
  Time,
  ContinuationAdmission,
  Unavailable,
} from './contract.js';
export const JobLive = Layer.effect(
  Job,
  Effect.gen(function* () {
    const store = yield* JobStore;
    const time = yield* Time;
    const issues = yield* Issues;
    const execution = yield* Execution;
    const policy = Option.getOrUndefined(yield* Effect.serviceOption(AgentReconciliationPolicy));
    const reporting = Option.getOrUndefined(yield* Effect.serviceOption(JobReporting));
    const continuation = Option.getOrUndefined(yield* Effect.serviceOption(ContinuationAdmission));
    let executionKnown = false;
    const investigate = <A, E, R>(
      intent: Intent,
      work: Effect.Effect<A, E, R>,
      stage?: import('./contract.js').Stage
    ) =>
      Effect.gen(function* () {
        const id = yield* reporting?.investigating?.(intent, stage) ?? Effect.succeed(undefined);
        return yield* work.pipe(
          Effect.ensuring(
            id === undefined ? Effect.void : (reporting?.investigated?.(id) ?? Effect.void)
          )
        );
      });
    const prepareLaunch = (intent: Intent) =>
      (
        execution.prepareLaunch?.(intent) ??
        Effect.succeed(Effect.suspend(() => execution.launch(intent)))
      ).pipe(
        Effect.mapError(
          (cause) => new Unavailable({ operation: 'prepare-launch', cause, launchNotSent: true })
        )
      );
    const launchOwned = (intent: Intent, index: number, launch: ReturnType<Execution['launch']>) =>
      Effect.gen(function* () {
        const result = yield* investigate(intent, launch);
        if (result.kind === 'submitted' && result.threadId) {
          // This records delivery ownership, never receipt acceptance.
          yield* retainInitialStage(store, intent, index, result.threadId);
          yield* retainOwnership(store, result.threadId);
        }
        return result;
      });
    const observe = (
      intent: Intent
    ): Effect.Effect<Extract<Status, { kind: 'job' }>, Unavailable> =>
      Effect.gen(function* () {
        const generation = reporting ? yield* reporting.begin() : 0;
        let observedOwnership: { threadId: string; prUrl?: string } | undefined;
        const reportingExecution: Execution = {
          ...execution,
          sendStage: (active, request) =>
            execution
              .sendStage(active, request)
              .pipe(
                Effect.andThen(
                  () =>
                    reporting?.accepted(
                      { ...active, id: intent.id },
                      request.stage,
                      request.index,
                      request.commit,
                      request.publicationStartedAt
                    ) ?? Effect.void
                )
              ),
        };
        return yield* Effect.gen(function* () {
          const before = yield* store.readControl();
          if (before.released) {
            const status = releasedStatus(intent, before, yield* time.now());
            if (reporting) yield* reporting.observed(generation, status);
            return status;
          }
          const activeIntent = attemptIntent(intent, before.restart?.index ?? 0);
          if (before.retirement) {
            const status = retiredStatus(
              { ...intent, branch: activeIntent.branch },
              before,
              before.retirement,
              yield* time.now()
            );
            yield* execution.release?.(activeIntent) ?? Effect.void;
            if (reporting) yield* reporting.observed(generation, status);
            return status;
          }
          const latestStage = yield* currentStage(store);
          const owningStage =
            latestStage && latestStage.index >= (before.restart?.index ?? 0) ? latestStage : null;
          const observation = yield* execution.observe(activeIntent, owningStage ?? undefined);
          executionKnown = observation.kind === 'found';
          yield* retainQuestionClosure(store, observation);
          yield* retainAnswerWait(store, owningStage, observation);
          const owner = observation.kind === 'found' ? observation.threadId : owningStage?.threadId;
          if (owner) observedOwnership = { threadId: owner };
          // Execution is an observed fact even if subsequent receipt validation fails.
          // Publish it before any external validation or continuation can fail.
          if (reporting) {
            const stage = yield* currentStage(store);
            const ciRepair = yield* ciRepairOrigin(store, stage);
            yield* reporting
              .observed(generation, {
                kind: 'job',
                intent,
                execution:
                  observation.kind === 'found' &&
                  owningStage &&
                  observation.run &&
                  !currentAnswerRun(owningStage, before, observation.run)
                    ? { ...observation, question: undefined }
                    : observation,
                stageIndex: stage?.index,
                publicationStartedAt:
                  stage?.stage === 'publication' ? stage.publicationStartedAt : undefined,
                elapsedMs: Math.max(0, (yield* time.now()) - intent.createdAt),
                delivery: stage
                  ? {
                      stage: stage.stage,
                      commit: stage.commit,
                      ready: false,
                      landed: false,
                      ciRepair: ciRepair || undefined,
                    }
                  : undefined,
              })
              // Provisional reporting cannot prevent cancellation or reconciliation.
              .pipe(Effect.catch(Effect.logError));
          }
          // Reporting persistence may advance control without granting execution authority.
          // Reobserve under a fresh authority snapshot rather than relabel earlier evidence.
          if ((yield* store.readControl()).revision !== before.revision)
            return yield* observe(intent);
          const cancelled = (yield* store.readControl()).cancelled;
          if (cancelled && observation.kind === 'found')
            yield* execution.interrupt(activeIntent, observation.threadId);
          // Backfill existing publications from the issue adapter, including failed CI.
          // This association is ownership evidence and does not assert readiness.
          let observedPublication: string | undefined;
          if (
            !cancelled &&
            owningStage &&
            ['publication', 'babysitting', 'ci'].includes(owningStage.stage) &&
            !(yield* store.readControl()).ownership?.prUrl
          ) {
            const publication = yield* issues.pullRequest(activeIntent);
            if (publication.kind === 'found') {
              observedPublication = publication.url;
              if (observedOwnership) observedOwnership.prUrl = publication.url;
            }
          }
          let delivery: Delivery | undefined = yield* reconcileStages(
            store,
            reportingExecution,
            issues,
            activeIntent,
            observation,
            time,
            continuation,
            before,
            policy?.limit ?? defaultAgentReconciliationLimit
          );
          // Publish adopted-stage question retention even before another found observation.
          const reportedStage = yield* currentStage(store);
          if (reportedStage) yield* controlForStage(store, reportedStage);
          yield* retainAnswerWait(store, reportedStage, observation);
          // Reconciliation can restore a question from an adopted immutable stage.
          yield* retainQuestionClosure(store, observation);
          yield* retainPrerequisite(store, delivery);
          // Verified handback retains its exact revision until admission release.
          if (owner && delivery?.activity !== 'dependency-handback')
            yield* retainOwnership(
              store,
              owner,
              delivery?.pr?.kind === 'found' ? delivery.pr.url : observedPublication
            );
          const control = yield* store.readControl();
          if ((control.restart?.index ?? 0) !== (before.restart?.index ?? 0))
            return yield* observe(intent);
          if (control.released) {
            const status = releasedStatus(intent, control, yield* time.now());
            if (reporting) yield* reporting.observed(generation, status);
            return status;
          }
          const stage = yield* currentStage(store);
          if (control.retirement) {
            const status = retiredStatus(
              { ...intent, branch: activeIntent.branch },
              control,
              control.retirement,
              yield* time.now()
            );
            if (reporting) yield* reporting.observed(generation, status);
            return status;
          }
          if (
            delivery?.activity === 'dependency-handback' &&
            (control.cancelled ||
              control.released ||
              delivery.handbackRevision !== control.revision)
          ) {
            delivery = {
              ...delivery,
              handbackRevision: undefined,
              activity: control.cancelled ? 'cancelled' : 'continuation-pending',
              active: !control.cancelled,
              progress: control.cancelled
                ? 'Attempt cancelled.'
                : 'Handback verification superseded; retaining admission.',
            };
          }
          const publicationLanded = delivery?.pr?.kind === 'found' && delivery.pr.landed;
          const resume = publicationLanded
            ? undefined
            : (resumeCommand(control, stage, observation) ??
              (yield* retryAction(
                store,
                execution,
                issues,
                activeIntent,
                control,
                stage,
                observation,
                delivery
              )));
          const now = yield* time.now();
          const ciRepair = yield* ciRepairOrigin(store, stage);
          const status = {
            kind: 'job' as const,
            controlRevision: control.revision,
            stageIndex: stage?.index,
            publicationStartedAt:
              stage?.stage === 'publication' ? stage.publicationStartedAt : undefined,
            reconciliation: control.reconciliation
              ? {
                  attempts: control.reconciliation.attempts,
                  migrated: control.reconciliation.migrated,
                  limit: policy?.limit ?? defaultAgentReconciliationLimit,
                  revision: control.revision,
                }
              : undefined,
            intent: { ...intent, branch: activeIntent.branch },
            prerequisite: control.cancelled ? undefined : control.prerequisite,
            resume,
            retry: publicationLanded
              ? undefined
              : yield* restartAction(store, execution, activeIntent, control, stage, observation),
            execution: observation,
            delivery: delivery
              ? {
                  ...delivery,
                  active: delivery.active ?? !delivery.ready,
                  ciRepair: ciRepair || undefined,
                }
              : delivery,
            elapsedMs: Math.max(0, now - intent.createdAt),
          };
          if (
            status.delivery?.landed &&
            status.delivery.active === false &&
            status.delivery.pr?.kind === 'found' &&
            (observation.kind === 'found' || observation.kind === 'unverified')
          ) {
            const latestExecution = yield* execution.observe(activeIntent, stage ?? undefined);
            status.execution = latestExecution;
            const stopped =
              (latestExecution.kind === 'found' || latestExecution.kind === 'unverified') &&
              latestExecution.threadId === observation.threadId &&
              ['completed', 'idle', 'failed', 'interrupted', 'cancelled', 'rolled_back'].includes(
                latestExecution.status
              );
            const idle =
              stopped &&
              (execution.isIdle
                ? yield* execution
                    .isIdle(latestExecution.threadId, latestExecution.run?.id ?? null)
                    .pipe(Effect.catch(() => Effect.succeed(false)))
                : true);
            if (!stopped || !idle) {
              status.delivery = { ...status.delivery, landed: false, active: true };
              if (reporting) yield* reporting.observed(generation, status);
              return status;
            }
            const pr = status.delivery.pr;
            if (
              !(yield* store.saveControl({
                ...control,
                revision: control.revision + 1,
                retirement: {
                  publication: {
                    url: pr.url,
                    commit: pr.commit,
                    base: pr.base,
                    lifecycle: pr.lifecycle,
                  },
                  execution: {
                    threadId: latestExecution.threadId,
                    status: latestExecution.status,
                    run: latestExecution.run
                      ? { id: latestExecution.run.id, ordinal: latestExecution.run.ordinal }
                      : undefined,
                  },
                  stageIndex: stage?.index,
                },
              }))
            )
              return yield* observe(intent);
            status.controlRevision = control.revision + 1;
            yield* execution.release?.(activeIntent) ?? Effect.void;
          }
          if (reporting) yield* reporting.observed(generation, status);
          return status;
        }).pipe(
          Effect.tapError((error) =>
            Effect.gen(function* () {
              // Reconciliation has stopped, so retaining ownership cannot revoke
              // a still-running handback decision's control revision.
              if (observedOwnership)
                yield* retainOwnership(
                  store,
                  observedOwnership.threadId,
                  observedOwnership.prUrl
                ).pipe(Effect.catch(Effect.logError));
              if (reporting) yield* reporting.failed(generation, intent, error.operation);
            })
          )
        );
      }).pipe(
        (work) => Effect.suspend(() => (executionKnown ? work : investigate(intent, work))),
        Effect.tapError(() =>
          Effect.sync(() => {
            executionKnown = false;
          })
        ),
        Effect.withSpan('factory.job.observe')
      );
    const resumeQuestion = (
      intent: Intent,
      command: Extract<import('./contract.js').Resume, { questionId: string }>
    ) =>
      Effect.gen(function* () {
        const waiting = yield* currentStage(store);
        const control = yield* store.readControl();
        const activeIntent = attemptIntent(intent, control.restart?.index ?? 0);
        if (!waiting) return { kind: 'rejected' as const };
        if (!matchesResume(intent, waiting, control, command)) return { kind: 'rejected' as const };
        const observed = yield* execution.observe(activeIntent, waiting);
        if (hasAnsweredQuestion(observed, command.questionId)) return yield* observe(intent);
        if (!resumable(observed, waiting)) return { kind: 'rejected' as const };
        const evidence = yield* resumeEvidence(store, execution, activeIntent, waiting, observed);
        if (!evidence) return { kind: 'rejected' as const };
        const request: import('./contract.js').StageRequest = {
          ...waiting,
          index: waiting.index + 1,
          ordinal: evidence.ordinal + 1,
          previousRunId: evidence.runId,
          resume: true,
          receiptProtocol: 'delivery-v1',
          observedRunId: undefined,
          question: undefined,
          deliveryIndex: undefined,
        };
        yield* store.saveStage(request);
        return yield* observe(intent);
      });
    return {
      retry: (command) =>
        Effect.gen(function* () {
          const intent = yield* store.read();
          if (!intent || intent.id !== command.jobId) return { kind: 'rejected' as const };
          const latest = yield* observe(intent);
          if (!matchesRestart(latest.retry, command)) return { kind: 'rejected' as const };
          const issue = yield* issues.inspect(intent.issue, {
            base: intent.base,
            includeCodeFromIssues: intent.includeCodeFromIssues,
            selectionBase: intent.selectionBase,
            prBase: intent.prBase,
          });
          if (
            !eligible(issue) ||
            (issue.prerequisite &&
              (issue.prerequisite.base !== intent.base ||
                issue.prerequisite.prBase !== intent.prBase))
          )
            return { kind: 'rejected' as const };
          const activeIntent = attemptIntent(intent, command.attempt);
          if ((yield* issues.pullRequest(activeIntent)).kind !== 'absent')
            return { kind: 'rejected' as const };
          const current = yield* observe(intent);
          if (!matchesRestart(current.retry, command)) return { kind: 'rejected' as const };
          const control = yield* store.readControl();
          const stage = yield* currentStage(store);
          if (control.revision !== command.revision || stage?.index !== command.index)
            return { kind: 'rejected' as const };
          const index = stage.index + 1;
          const active = attemptIntent(intent, index);
          const prepared = yield* prepareLaunch(active);
          if (
            !(yield* store.saveControl({
              ...control,
              revision: control.revision + 1,
              restart: { index },
              manualRepair: undefined,
              parked: undefined,
            }))
          )
            return { kind: 'rejected' as const };
          if (yield* store.claimStage(index)) {
            const current = yield* store.readControl();
            if (
              !current.cancelled &&
              !current.released &&
              !current.retirement &&
              !current.dependencyRecovery
            ) {
              const launch = yield* launchOwned(active, index, prepared);
              if (launch.kind === 'submitted' && reporting)
                yield* reporting.accepted({ ...active, id: intent.id }, 'implementation', index);
            }
          }
          return yield* observe(intent);
        }).pipe(Effect.withSpan('factory.job.retry-fresh')),
      status: () =>
        Effect.gen(function* () {
          const intent = yield* store.read();
          return intent ? yield* observe(intent) : { kind: 'empty' as const };
        }),
      resume: (command) =>
        Effect.gen(function* () {
          const intent = yield* store.read();
          if (!intent) return { kind: 'rejected' as const };
          if ('runId' in command && command.resetReconciliation) {
            const control = yield* store.readControl();
            const stage = yield* currentStage(store);
            if (
              intent.id !== command.jobId ||
              control.cancelled ||
              control.released ||
              control.retirement ||
              control.revision !== command.revision ||
              stage?.index !== command.index
            )
              return { kind: 'rejected' as const };
            const owner = yield* execution.observe(
              attemptIntent(intent, control.restart?.index ?? 0),
              stage ?? undefined
            );
            if (owner.kind !== 'found' || owner.run?.id !== command.runId)
              return { kind: 'rejected' as const };
            if (
              !(yield* store.saveControl({
                ...control,
                revision: control.revision + 1,
                reconciliation: { attempts: 0, migrated: false },
                dependencyRecovery: undefined,
              }))
            )
              return { kind: 'rejected' as const };
            return yield* observe(intent);
          }
          const stage = (yield* currentStage(store))?.stage;
          if ('runId' in command)
            return yield* investigate(intent, retryStage(store, intent, command, observe), stage);
          return yield* investigate(intent, resumeQuestion(intent, command), stage);
        }).pipe(Effect.withSpan('factory.job.resume')),
      cancel: (jobId) =>
        Effect.gen(function* () {
          const intent = yield* store.read();
          if (!intent || intent.id !== jobId) return { kind: 'rejected' as const };
          for (;;) {
            const state = yield* store.readControl();
            if (state.released) return { kind: 'rejected' as const };
            if (state.cancelled) break;
            if (
              yield* store.saveControl({ ...state, revision: state.revision + 1, cancelled: true })
            )
              break;
          }
          return yield* observe(intent);
        }).pipe(Effect.withSpan('factory.job.cancel')),
      start: (command: Start) =>
        Effect.gen(function* () {
          if (yield* store.read()) return { kind: 'occupied' as const };
          if (!validCommand(command)) return { kind: 'rejected' as const };
          const issue = yield* issues.inspect(command.issue, {
            base: command.base,
            includeCodeFromIssues: command.includeCodeFromIssues,
            selectionBase: command.selectionBase,
            prBase: command.prBase,
          });
          if (!eligible(issue)) return { kind: 'rejected' as const };
          if (!matchesPrerequisite(command, issue.prerequisite))
            return { kind: 'rejected' as const };
          const createdAt = yield* time.now();
          const id = `${createdAt}-${yield* Random.nextInt}-${yield* Random.nextInt}`;
          const intent: Intent = {
            ...command,
            ...prerequisiteBinding(command, issue.prerequisite),
            id,
            createdAt,
            issueUrl: issue.url,
            issueTitle: issue.title,
            branch: `factory/job-${id}`,
            expectedStage: 'implementation',
            receiptProtocol: 'delivery-v1',
          };
          const prepared = yield* prepareLaunch(intent);
          if (!(yield* store.reserve(intent))) return { kind: 'occupied' as const };
          if (yield* store.claimLaunch()) {
            const launch = yield* launchOwned(intent, 0, prepared);
            if (launch.kind === 'submitted' && reporting)
              yield* reporting.accepted(intent, 'implementation', 0);
          }
          return yield* observe(intent);
        }).pipe(Effect.withSpan('factory.job.start')),
    } satisfies Job;
  })
);

function validCommand(command: Start): boolean {
  return (
    Number.isSafeInteger(command.issue) &&
    command.issue > 0 &&
    command.context.length <= 16000 &&
    /^[a-f0-9]{40}$/.test(command.base)
  );
}
export function eligible(issue: {
  open: boolean;
  author: string;
  labels: readonly string[];
  blockersReady: boolean;
}): boolean {
  return (
    issue.open &&
    trustedAuthor(issue.author) &&
    issue.labels.includes('ready-for-agent') &&
    !issue.labels.some((label) => ['future-work', 'spec'].includes(label)) &&
    issue.blockersReady
  );
}

function matchesResume(
  intent: Intent,
  waiting: import('./contract.js').StageRequest,
  control: import('./contract.js').Control,
  command: { jobId: string; index: number; questionId: string }
) {
  return (
    intent.id === command.jobId &&
    !control.cancelled &&
    !control.released &&
    !control.retirement &&
    !control.dependencyRecovery &&
    waiting.index === command.index &&
    control.parked?.index === waiting.index &&
    control.parked.question.id === command.questionId
  );
}
function resumable(
  observed: import('./contract.js').Observation,
  waiting: import('./contract.js').StageRequest
): observed is Extract<import('./contract.js').Observation, { kind: 'found' }> {
  return (
    observed.kind === 'found' &&
    observed.threadId === waiting.threadId &&
    !observed.question &&
    ['completed', 'interrupted', 'failed', 'cancelled'].includes(observed.status)
  );
}

function resumeCommand(
  control: import('./contract.js').Control,
  stage: import('./contract.js').StageRequest | null,
  observation: import('./contract.js').Observation
) {
  const parked = control.parked;
  if (
    control.cancelled ||
    control.released ||
    control.dependencyRecovery ||
    !parked ||
    parked.index !== stage?.index
  )
    return undefined;
  if (hasAnsweredQuestion(observation, parked.question.id)) return undefined;
  return { index: parked.index, questionId: parked.question.id };
}

function resumeEvidence(
  store: import('./contract.js').JobStore,
  execution: import('./contract.js').Execution,
  intent: Intent,
  waiting: import('./contract.js').StageRequest,
  observed: Extract<import('./contract.js').Observation, { kind: 'found' }>
) {
  return Effect.gen(function* () {
    const evidence = observed.run
      ? { runId: observed.run.id, ordinal: observed.run.ordinal }
      : yield* execution.inspectStage(intent, waiting);
    if (!evidence) return null;
    return stageRunOrder(waiting, yield* store.readControl(), {
      id: evidence.runId,
      ordinal: evidence.ordinal,
    })
      ? evidence
      : null;
  });
}

function matchesPrerequisite(command: Start, prerequisite?: { base: string }) {
  return !prerequisite || command.base === prerequisite.base;
}

function prerequisiteBinding(command: Start, prerequisite?: { prBase: string; evidence: string }) {
  return prerequisite
    ? { prBase: prerequisite.prBase, prerequisiteEvidence: prerequisite.evidence }
    : { prBase: command.prBase, prerequisiteEvidence: command.prerequisiteEvidence };
}

function retainPrerequisite(
  store: import('./contract.js').JobStore,
  delivery: Delivery | undefined
) {
  return Effect.gen(function* () {
    const pr = verifiedPublication(delivery);
    if (!pr) return;
    const prerequisite = {
      url: pr.url,
      commit: pr.commit,
      reviewedCommit: pr.reviewedCommit,
      parent: pr.parent,
      base: pr.base,
    };
    for (;;) {
      const current = yield* store.readControl();
      if (current.released) return;
      if (JSON.stringify(current.prerequisite) === JSON.stringify(prerequisite)) return;
      if (yield* store.saveControl({ ...current, revision: current.revision + 1, prerequisite }))
        return;
    }
  }).pipe(Effect.withSpan('factory.job.retain-prerequisite'));
}

function verifiedPublication(delivery: Delivery | undefined) {
  if (!(delivery?.ready || delivery?.landed)) return null;
  return delivery.pr?.kind === 'found' ? delivery.pr : null;
}

function retainOwnership(
  store: import('./contract.js').JobStore,
  threadId: string,
  prUrl?: string
) {
  return Effect.gen(function* () {
    for (;;) {
      const control = yield* store.readControl();
      if (control.released) return;
      const ownership = {
        threadId,
        prUrl: prUrl ?? control.ownership?.prUrl ?? control.prerequisite?.url,
      };
      if (JSON.stringify(ownership) === JSON.stringify(control.ownership)) return;
      if (yield* store.saveControl({ ...control, revision: control.revision + 1, ownership }))
        return;
    }
  });
}

export function trustedAuthor(author: string) {
  return ['rafaeltab', 'zero-two-rafaeltab'].includes(author);
}

function retiredStatus(
  intent: Intent,
  control: import('./contract.js').Control,
  retirement: NonNullable<import('./contract.js').Control['retirement']>,
  now: number
): Extract<import('./contract.js').Status, { kind: 'job' }> {
  return {
    kind: 'job',
    intent,
    controlRevision: control.revision,
    stageIndex: retirement.stageIndex,
    prerequisite: control.prerequisite,
    execution: { kind: 'unverified', ...retirement.execution },
    elapsedMs: Math.max(0, now - intent.createdAt),
    delivery: {
      stage: 'ci',
      commit: retirement.publication.commit,
      ready: false,
      landed: true,
      active: false,
      pr: { kind: 'found', ...retirement.publication, ready: false, landed: true },
    },
  };
}

function releasedStatus(
  intent: Intent,
  control: import('./contract.js').Control,
  now: number
): Extract<import('./contract.js').Status, { kind: 'job' }> {
  return {
    kind: 'job',
    intent,
    controlRevision: control.revision,
    execution: { kind: 'absent' },
    elapsedMs: Math.max(0, now - intent.createdAt),
    delivery: {
      stage: control.reconciliation?.pending?.stage ?? 'implementation',
      commit: control.reconciliation?.pending?.commit ?? intent.base,
      activity: 'dependency-handback',
      active: false,
      ready: false,
      landed: false,
      progress: 'Attempt released; retained for history only.',
    },
  };
}

function retainQuestionClosure(
  store: import('./contract.js').JobStore,
  observation: import('./contract.js').Observation
) {
  return Effect.gen(function* () {
    if (observation.kind !== 'found') return;
    for (;;) {
      const control = yield* store.readControl();
      const parked = control.parked;
      if (
        control.released ||
        !parked ||
        parked.closed ||
        !(
          observation.closedQuestions?.includes(parked.question.id) ||
          observation.answeredQuestions?.includes(parked.question.id)
        )
      )
        return;
      if (
        yield* store.saveControl({
          ...control,
          revision: control.revision + 1,
          parked: { ...parked, closed: true },
        })
      )
        return;
    }
  });
}

function retainAnswerWait(
  store: import('./contract.js').JobStore,
  stage: import('./contract.js').StageRequest | null,
  observation: import('./contract.js').Observation
) {
  return Effect.gen(function* () {
    if (observation.kind !== 'found' || !stage || stage.threadId !== observation.threadId) return;
    for (;;) {
      const control = yield* store.readControl();
      if (control.cancelled || control.released || control.retirement) return;
      const latest = yield* currentStage(store);
      if (latest?.index !== stage.index) return;
      const previous = control.answerWait;
      if (observation.run && !currentAnswerRun(stage, control, observation.run)) return;
      const isClosed = (id: string) =>
        observation.closedQuestions?.includes(id) || observation.answeredQuestions?.includes(id);
      let next = previous;
      if (observation.question) {
        const same = previous?.question?.id === observation.question.id;
        next = {
          index: stage.index,
          run: observation.run,
          question: {
            ...observation.question,
            startedAt:
              observation.question.startedAt ?? (same ? previous?.question?.startedAt : undefined),
          },
          closed: isClosed(observation.question.id) || (same && previous?.closed) || undefined,
        };
      } else if (
        (previous?.question && isClosed(previous.question.id)) ||
        (observation.run &&
          (!previous ||
            previous.index !== stage.index ||
            (previous.run && observation.run.ordinal > previous.run.ordinal)))
      ) {
        next = {
          index: stage.index,
          run: observation.run ?? previous?.run,
          question: previous?.index === stage.index ? previous.question : undefined,
          closed: true,
        };
      }
      if (JSON.stringify(next) === JSON.stringify(previous)) return;
      if (
        yield* store.saveControl({ ...control, revision: control.revision + 1, answerWait: next })
      )
        return;
    }
  });
}

function currentAnswerRun(
  stage: import('./contract.js').StageRequest,
  control: import('./contract.js').Control,
  run: { readonly id: string; readonly ordinal: number }
) {
  return (
    stageRunOrder(stage, control, run) &&
    (control.answerWait?.index !== stage.index || answerRunCurrent(control.answerWait.run, run))
  );
}
