import type { ScheduleSnapshot } from '../observe/index.js';
import type { FactoryActivity } from './model.js';
import { timestamp } from './values.js';

export function managedReviews(input: ScheduleSnapshot): FactoryActivity['items'][number][] {
  return input.jobs.flatMap((job) => {
    if (job.kind !== 'job') return [];
    const control = input.localWork.find((work) => work.intent?.id === job.intent.id)?.control;
    const delivery = job.delivery;
    const observation = input.observations.items?.[`job:${job.intent.id}`];
    if (
      !input.state.admissions.some((admission) => admission.issue === job.intent.issue) ||
      control?.cancelled ||
      control?.released ||
      control?.retirement ||
      control?.dependencyRecovery ||
      (control?.parked !== undefined && control.parked.index === job.stageIndex) ||
      (observation?.failedAt !== undefined &&
        observation.failedAt >= (observation.observedAt ?? 0)) ||
      !delivery ||
      delivery.stage !== 'review' ||
      delivery.ready ||
      delivery.landed ||
      delivery.active === false ||
      delivery.question ||
      (delivery.activity !== undefined && delivery.activity !== 'repairing') ||
      job.execution.kind !== 'found' ||
      job.execution.status !== 'running' ||
      job.execution.question
    )
      return [];
    return [
      {
        id: `review:${job.intent.id}:${job.execution.run?.id ?? job.execution.threadId}`,
        category: 'reviewing',
        lifecycle: 'current',
        issue: job.intent.issue,
        pullRequest:
          delivery.pr?.kind === 'found' ? Number(delivery.pr.url.split('/').at(-1)) || null : null,
        startedAt: timestamp(job.execution.run?.startedAt),
        reason: delivery.ciRepair
          ? 'Reviewing CI repairs'
          : 'Independently reviewing admitted issue',
      },
    ];
  });
}
