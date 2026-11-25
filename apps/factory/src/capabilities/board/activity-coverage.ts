import type { ScheduleSnapshot } from '../observe/index.js';
import type { ActivityCategory, FactoryActivity } from './model.js';

const categories: readonly ActivityCategory[] = [
  'implementing',
  'reviewing',
  'publishing',
  'restacking',
  'recovering',
  'waiting-for-ci',
  'waiting-for-answers',
];

/** Coverage describes observed lifecycles, independently of delivery acceptance. */
export function managedCoverage(input: ScheduleSnapshot, items: FactoryActivity['items']) {
  let complete = true;
  let unresolved = false;
  for (const admission of input.state.admissions) {
    const work = input.localWork.find((w) => w.intent?.issue === admission.issue);
    if (work?.control.cancelled || work?.control.released || work?.control.retirement) continue;
    const job = input.jobs.find((j) => j.kind === 'job' && j.intent.issue === admission.issue);
    if (job?.kind !== 'job') {
      complete = false;
      continue;
    }
    const observation = input.observations.items?.[`job:${job.intent.id}`];
    if (
      (observation?.failedAt !== undefined &&
        observation.failedAt >= (observation.observedAt ?? 0)) ||
      (job.execution.kind !== 'found' && job.execution.kind !== 'unverified') ||
      !job.delivery
    ) {
      complete = false;
      continue;
    }
    if (job.delivery.activity === 'manual-recovery') unresolved = true;
    if (items.some((item) => item.issue === admission.issue)) continue;
    if (
      ['completed', 'idle', 'cancelled', 'rolled_back', 'failed', 'interrupted'].includes(
        job.execution.status
      )
    ) {
      if (!job.delivery.ready && !job.delivery.landed) unresolved = true;
    } else {
      complete = false;
    }
  }
  for (const recovery of input.restackActivities ?? input.recoveries ?? []) {
    if (recovery.phase === 'complete') continue;
    if (recovery.phase === undefined || recovery.bindingAvailable === false) complete = false;
    else if (recovery.phase === 'manual-recovery') unresolved = true;
    else if (recovery.phase === 'awaiting-answer' && (!recovery.questionId || !recovery.question))
      complete = false;
  }
  const claims = [
    ...(input.state.recovering ?? []),
    ...(input.state.resuming ?? []).map((claim) => claim.issue),
  ];
  for (const issue of claims) {
    const recovery = (input.restackActivities ?? input.recoveries ?? []).find(
      (owner) => owner.issue === issue
    );
    if (
      !input.reconciliation?.some((owner) => owner.issue === issue) &&
      !(recovery?.phase && recovery.bindingAvailable !== false)
    )
      complete = false;
  }
  const uncertainty: string[] = [];
  if (!complete) uncertainty.push('Managed execution or wait coverage is incomplete.');
  if (unresolved)
    uncertainty.push('Managed execution outcome requires reconciliation or manual intervention.');
  return { complete, categories, uncertainty };
}
