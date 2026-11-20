import type { Status } from '../job/index.js';
import { observationStaleAfterMs, type ScheduleSnapshot } from '../observe/index.js';
import { answerRunCurrent } from '../job/index.js';
import { capacityOccupied } from '../plan/index.js';
import { managedRepairs } from './repairs.js';
import { managedReviews } from './reviews.js';
import { managedCIWaits } from './ci-waits.js';
import type { ActivityCategory, FactoryActivity, Reason } from './model.js';
import { timestamp } from './values.js';
import { recoveryActivities } from './recovery.js';

// Taxonomy only. Presentation order and summary selection belong to the client.
const categories: readonly ActivityCategory[] = [
  'refreshing-github',
  'refreshing-t3',
  'publishing',
  'reviewing',
  'implementing',
  'restacking',
  'recovering',
  'planning',
  'gathering-planning-context',
  'checking-plan-freshness',
  'waiting-for-ci',
  'waiting-for-answers',
];
export function activityFacts(input: ScheduleSnapshot, at: string): FactoryActivity {
  const uncertainty: string[] = [];
  if (input.coordinationIdle !== true || input.state.cycle)
    uncertainty.push('Coordination activity coverage is incomplete.');
  const unfinished = input.state.admissions.some((admission) => {
    const work = input.localWork.find((w) => w.intent?.issue === admission.issue);
    if (work?.control.cancelled || work?.control.retirement) return false;
    const job = input.jobs.find((j) => j.kind === 'job' && j.intent.issue === admission.issue);
    return (
      job?.kind !== 'job' ||
      !(job.delivery?.ready || job.delivery?.landed) ||
      job.execution.kind !== 'found' ||
      !['completed', 'idle', 'cancelled', 'rolled_back'].includes(job.execution.status)
    );
  });
  if (
    unfinished ||
    input.state.recovering?.length ||
    input.state.resuming?.length ||
    input.recoveries?.some((r) => r.phase !== 'complete') ||
    input.restackActivities?.some((r) => r.phase !== 'complete')
  )
    uncertainty.push('Managed execution or wait coverage is incomplete.');
  const restacks = (input.restackActivities ?? input.recoveries ?? []).filter(
    (recovery) =>
      recovery.active !== false &&
      recovery.bindingAvailable !== false &&
      ['resolving', 'reviewing', 'verifying', 'publishing'].includes(recovery.phase ?? '')
  );
  const restackPRs = new Set(restacks.map((recovery) => recovery.pr));
  const items: FactoryActivity['items'][number][] = [
    ...managedCIWaits(input),
    ...managedReviews(input),
    ...restacks.map((recovery) => ({
      id: `restack:${recovery.issue}/${recovery.pr}`,
      category: 'restacking' as const,
      lifecycle: 'current' as const,
      issue: recovery.issue,
      pullRequest: Number(recovery.pr.split('/').at(-1)) || null,
      startedAt: timestamp(recovery.startedAt),
      reason: `Managed restack ${recovery.phase}`,
    })),
  ];
  if (input.planningVerification)
    items.push({
      id: `plan-verification:${input.planningVerification.startedAt}`,
      category: 'checking-plan-freshness',
      lifecycle: 'current',
      issue: null,
      pullRequest: null,
      startedAt: timestamp(input.planningVerification.startedAt),
      reason: 'Verifying selected prerequisites using the collected planning snapshot',
    });
  for (const admission of input.state.admissions) {
    const job = input.jobs.find((j) => j.kind === 'job' && j.intent.issue === admission.issue);
    const control = input.localWork.find((w) => w.intent?.issue === admission.issue)?.control;
    if (control?.cancelled || control?.released || !job || !implementing(job)) continue;
    const observation = input.observations.items?.[`job:${job.intent.id}`];
    if (
      observation?.failedAt !== undefined &&
      observation.failedAt >= (observation.observedAt ?? 0)
    )
      continue;
    const execution = job.execution;
    if (execution.kind !== 'found') continue;
    items.push({
      id: `implementation:${job.intent.id}:${execution.run?.id ?? execution.threadId}`,
      category: 'implementing',
      lifecycle: 'current',
      issue: admission.issue,
      pullRequest:
        job.delivery?.pr?.kind === 'found'
          ? Number(job.delivery.pr.url.split('/').at(-1)) || null
          : null,
      startedAt: timestamp(execution.run?.startedAt),
      reason:
        job.delivery?.activity === 'repairing' || job.delivery?.stage === 'babysitting'
          ? 'Repairing managed code'
          : 'Implementing admitted issue',
    });
  }
  for (const job of input.jobs) {
    if (job.kind !== 'job' || !input.state.admissions.some((a) => a.issue === job.intent.issue))
      continue;
    const control = input.localWork.find((w) => w.intent?.id === job.intent.id)?.control;
    const delivery = job.delivery;
    if (
      control?.cancelled ||
      control?.released ||
      control?.retirement ||
      (control?.parked !== undefined && control.parked.index === job.stageIndex) ||
      control?.dependencyRecovery ||
      (delivery?.pr?.kind === 'found' && restackPRs.has(delivery.pr.url)) ||
      delivery?.stage !== 'publication' ||
      delivery.ready ||
      delivery.landed ||
      delivery.active === false ||
      (delivery.activity !== undefined &&
        !['repairing', 'waiting-for-github'].includes(delivery.activity))
    )
      continue;
    const executing =
      job.execution.kind === 'found' && ['running', 'waiting'].includes(job.execution.status);
    const accepted =
      job.execution.kind === 'ambiguous' &&
      job.acknowledgement?.stage === 'publication' &&
      job.acknowledgement.index === job.stageIndex;
    if (!executing && !accepted) continue;
    items.push({
      id: `publication:${job.intent.id}:${job.stageIndex ?? 'unknown'}`,
      category: 'publishing',
      lifecycle: 'current',
      issue: job.intent.issue,
      pullRequest: null,
      startedAt:
        job.publicationStartedAt === undefined ? null : timestamp(job.publicationStartedAt),
      reason:
        delivery.activity === 'repairing'
          ? 'Publishing reviewed repair'
          : 'Publishing reviewed issue changes',
    });
  }
  items.push(
    ...managedRepairs(input).filter(
      (repair) =>
        repair.category !== 'publishing' &&
        !items.some((item) => item.category === repair.category && item.issue === repair.issue)
    )
  );
  const planning = input.planningActivity;
  if (planning?.current)
    items.push({
      id: planning.current.id,
      category: 'planning',
      lifecycle: 'current',
      issue: null,
      pullRequest: null,
      startedAt: timestamp(planning.current.startedAt),
      reason: 'Advisory model assessing eligible work',
    });
  const source = input.observations;
  if (source.refreshActive === true && source.startedAt !== undefined)
    items.push({
      id: `github-refresh:${source.startedAt}`,
      category: 'refreshing-github',
      lifecycle: 'current',
      issue: null,
      pullRequest: null,
      startedAt: timestamp(source.startedAt),
      reason: 'Reading repository and managed PR metadata',
    });
  for (const admission of input.state.admissions) {
    const work = input.localWork.find((w) => w.intent?.issue === admission.issue);
    if (work?.control.cancelled || work?.control.retirement || work?.control.released) continue;
    const job = input.jobs.find((j) => j.kind === 'job' && j.intent.issue === admission.issue);
    if (job?.kind !== 'job') continue;
    const index = job.stageIndex ?? job.resume?.index;
    const parked = work?.control.parked;
    const retained = work?.control.answerWait;
    const retainedCurrent =
      retained && (index === undefined || retained.index === index) ? retained : undefined;
    const parkingNewer =
      !retainedCurrent ||
      (parked?.run &&
        retainedCurrent.run &&
        answerRunCurrent(retainedCurrent.run, parked.run) &&
        parked.run.ordinal > retainedCurrent.run.ordinal);
    const run = job.execution.kind === 'found' ? job.execution.run : undefined;
    const stale =
      retained &&
      (index === undefined || retained.index === index) &&
      run &&
      !answerRunCurrent(retained.run, run);
    const delivery = stale ? undefined : job.delivery;
    if (delivery?.ready || delivery?.landed) continue;
    // Reconciled delivery owns the question; raw execution can be from an older run.
    // Only provisional observations need the direct execution fallback.
    const observedQuestion =
      !stale && job.controlRevision === undefined && job.execution.kind === 'found'
        ? job.execution.question
        : undefined;
    if (delivery?.activity && delivery.activity !== 'awaiting-answer' && !observedQuestion)
      continue;
    const retainedQuestion =
      retained && !retained.closed && (index === undefined || retained.index === index)
        ? retained.question
        : undefined;
    const question =
      delivery?.question ??
      retainedQuestion ??
      observedQuestion ??
      (!stale &&
      parkingNewer &&
      (!delivery?.activity || delivery.activity === 'awaiting-answer') &&
      parked &&
      (index === undefined || parked.index === index)
        ? parked.question
        : undefined);
    if (
      !question ||
      (parked?.closed && parked.question.id === question.id) ||
      (retained?.closed && retained.question?.id === question.id) ||
      (!stale &&
        job.execution.kind === 'found' &&
        (job.execution.closedQuestions?.includes(question.id) ||
          job.execution.answeredQuestions?.includes(question.id)))
    )
      continue;
    // A current answer wait supersedes provisional publication until reconciliation catches up.
    const publication = items.findIndex(
      (item) => item.category === 'publishing' && item.issue === admission.issue
    );
    if (publication !== -1) items.splice(publication, 1);
    items.push({
      id: `answer:${job.intent.id}/${question.id}`,
      category: 'waiting-for-answers',
      lifecycle: 'current',
      issue: admission.issue,
      pullRequest: null,
      startedAt: timestamp(
        question.startedAt ??
          (retained?.question?.id === question.id ? retained.question.startedAt : undefined)
      ),
      reason: question.text,
    });
  }
  for (const recovery of input.recoveries ?? []) {
    const wait =
      recovery.phase === 'awaiting-answer' && recovery.question && recovery.questionId
        ? {
            id: recovery.questionId,
            text: recovery.question,
            startedAt: recovery.questionStartedAt,
          }
        : recovery.phase === undefined && recovery.bindingAvailable === false
          ? recovery.answerWait
          : undefined;
    if (!wait) continue;
    items.push({
      id: `recovery-answer:${recovery.issue}/${recovery.pr}`,
      category: 'waiting-for-answers',
      lifecycle: 'current',
      issue: recovery.issue,
      pullRequest: Number(recovery.pr.split('/').at(-1)) || null,
      startedAt: timestamp(wait.startedAt),
      reason: wait.text,
    });
  }
  for (const item of input.planningDiscovery?.current ?? [])
    items.push({
      id: item.id,
      category: 'gathering-planning-context',
      lifecycle: 'current',
      issue: null,
      pullRequest: null,
      startedAt: timestamp(item.startedAt),
      reason: 'Collecting initial planning inputs',
    });
  if (input.threads?.refreshActive === true && input.threads.startedAt !== undefined)
    items.push({
      id: `t3-refresh:${input.threads.startedAt}`,
      category: 'refreshing-t3',
      lifecycle: 'current',
      issue: null,
      pullRequest: null,
      startedAt: timestamp(input.threads.startedAt),
      reason: 'Reading routine T3 thread metadata',
    });
  items.push(...recoveryActivities(input, items));
  const reasons: Reason[] = [];
  if (input.state.paused) reasons.push({ code: 'paused', message: 'Admissions paused' });
  if (input.state.concurrency !== -1 && capacityOccupied(input) >= input.state.concurrency)
    reasons.push({ code: 'concurrency-full', message: 'Concurrency full' });
  if (input.state.allowance !== -1 && input.state.admissions.length >= input.state.allowance)
    reasons.push({ code: 'allowance-exhausted', message: 'Admission allowance exhausted' });
  if (
    input.planningDiscovery &&
    (input.planningDiscovery.current.length > 0 ||
      input.planningDiscovery.completedAt !== undefined ||
      input.planningDiscovery.failedAt !== undefined)
      ? input.planningDiscovery.outcome === 'no-ready-matches' &&
        !input.planningDiscovery.current.length &&
        !(
          source.observedAt !== undefined &&
          source.observedAt > (input.planningDiscovery.completedAt ?? Infinity) &&
          source.facts?.issues.some((issue) => issue.open && issue.candidate)
        )
      : source.facts &&
        source.observedAt !== undefined &&
        !source.stale &&
        !source.error &&
        !source.facts.issues.some((i) => i.open && i.candidate)
  )
    reasons.push({ code: 'no-ready-matches', message: 'No ready-filter matches' });
  // Later discovery or unavailable metadata invalidates retained assessment evidence.
  const assessment = planning?.assessment;
  const discoveryFailedAt = input.planningDiscovery?.failedAt;
  const assessed =
    assessment &&
    !source.stale &&
    !source.error &&
    (discoveryFailedAt === undefined || discoveryFailedAt <= assessment.observedAt) &&
    Date.parse(at) - assessment.observedAt <= observationStaleAfterMs &&
    (source.observedAt ?? 0) <= assessment.startedAt;
  if (assessed && assessment.outcome === 'no-eligible')
    reasons.push({ code: 'planner-no-eligible', message: 'No eligible issues found by planner' });
  else if (!assessed) reasons.push({ code: 'eligibility-unknown', message: 'Eligibility unknown' });
  const covered = (category: ActivityCategory) =>
    (category === 'recovering' && input.reconciliation !== undefined) ||
    category === 'refreshing-github' ||
    category === 'refreshing-t3' ||
    category === 'publishing' ||
    category === 'reviewing' ||
    (category === 'planning' && planning !== undefined) ||
    category === 'restacking' ||
    category === 'waiting-for-ci' ||
    category === 'waiting-for-answers' ||
    (category === 'gathering-planning-context' && !!input.planningDiscovery) ||
    (category === 'checking-plan-freshness' && input.planningVerification !== undefined) ||
    !uncertainty.length;
  return {
    observedAt: at,
    items,
    uncertainty,
    admissionReasons: reasons,
    coverage: categories.map((category) => {
      const complete = covered(category);
      return {
        category,
        state: complete ? 'complete' : 'unknown',
        reason: complete ? null : 'Lifecycle not yet instrumented.',
      };
    }),
  };
}

function implementing(job: Status): job is Extract<Status, { kind: 'job' }> {
  if (job.kind !== 'job' || job.execution.kind !== 'found') return false;
  const delivery = job.delivery;
  if (
    !delivery ||
    (delivery.ciRepair && job.execution.status === 'queued') ||
    delivery.ready ||
    delivery.landed ||
    delivery.active === false ||
    delivery.question
  )
    return false;
  if (!['running', 'preparing', 'queued', 'starting'].includes(job.execution.status)) return false;
  if (
    delivery.stage === 'babysitting' &&
    (delivery.activity === 'continuation-pending' || delivery.activity === 'resume-pending')
  )
    return true;
  if (delivery.activity === 'repairing')
    return (
      delivery.stage === 'ci' ||
      delivery.stage === 'babysitting' ||
      delivery.stage === 'implementation'
    );
  return (
    delivery.stage === 'implementation' &&
    (!delivery.activity || ['resume-pending', 'continuation-pending'].includes(delivery.activity))
  );
}
