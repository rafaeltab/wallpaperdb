import type { Status } from '../job/index.js';
import type { ScheduleSnapshot } from '../observe/index.js';
import { capacityOccupied } from '../plan/index.js';
import type { ActivityCategory, FactoryActivity, Reason } from './model.js';
import { timestamp } from './values.js';

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
    input.recoveries?.some((r) => r.phase !== 'complete')
  )
    uncertainty.push('Managed execution or wait coverage is incomplete.');
  if (
    input.threads?.startedAt !== undefined &&
    input.threads.startedAt > Math.max(input.threads.observedAt ?? -1, input.threads.failedAt ?? -1)
  )
    uncertainty.push('Thread refresh activity coverage is incomplete.');
  const items: FactoryActivity['items'][number][] = [];
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
  const reasons: Reason[] = [];
  if (input.state.paused) reasons.push({ code: 'paused', message: 'Admissions paused' });
  if (input.state.concurrency !== -1 && capacityOccupied(input) >= input.state.concurrency)
    reasons.push({ code: 'concurrency-full', message: 'Concurrency full' });
  if (input.state.allowance !== -1 && input.state.admissions.length >= input.state.allowance)
    reasons.push({ code: 'allowance-exhausted', message: 'Admission allowance exhausted' });
  if (
    source.facts &&
    source.observedAt !== undefined &&
    !source.stale &&
    !source.error &&
    !source.facts.issues.some((i) => i.open && i.candidate)
  )
    reasons.push({ code: 'no-ready-matches', message: 'No ready-filter matches' });
  // Candidate discovery alone cannot establish a planner assessment.
  reasons.push({ code: 'eligibility-unknown', message: 'Eligibility unknown' });
  return {
    observedAt: at,
    items,
    uncertainty,
    admissionReasons: reasons,
    coverage: categories.map((category) => ({
      category,
      state: category === 'refreshing-github' || category === 'publishing' || !uncertainty.length ? 'complete' : 'unknown',
      reason:
        category === 'refreshing-github' || category === 'publishing' || !uncertainty.length
          ? null
          : 'Lifecycle not yet instrumented.',
    })),
  };
}

function implementing(job: Status): job is Extract<Status, { kind: 'job' }> {
  if (job.kind !== 'job' || job.execution.kind !== 'found') return false;
  const delivery = job.delivery;
  if (
    !delivery ||
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
