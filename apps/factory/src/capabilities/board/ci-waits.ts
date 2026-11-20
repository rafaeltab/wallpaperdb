import type { ScheduleSnapshot } from '../observe/index.js';
import type { FactoryActivity } from './model.js';
import { timestamp } from './values.js';

export function managedCIWaits(input: ScheduleSnapshot): FactoryActivity['items'][number][] {
  return input.jobs.flatMap((job) => {
    if (job.kind !== 'job') return [];
    const control = input.localWork.find((work) => work.intent?.id === job.intent.id)?.control;
    const delivery = job.delivery;
    if (
      !input.state.admissions.some((admission) => admission.issue === job.intent.issue) ||
      control?.cancelled ||
      control?.released ||
      control?.retirement ||
      !delivery ||
      delivery.ready ||
      delivery.landed ||
      !['waiting-for-ci', 'waiting-for-github', 'continuation-pending'].includes(
        delivery.activity ?? ''
      ) ||
      delivery.pr?.kind !== 'found' ||
      delivery.pr.commit !== (delivery.waitCommit ?? delivery.commit)
    )
      return [];
    return [
      {
        id: `ci-wait:${job.intent.id}:${job.stageIndex ?? 'unknown'}:${delivery.waitCommit ?? delivery.commit}`,
        category: 'waiting-for-ci' as const,
        lifecycle: 'current' as const,
        issue: job.intent.issue,
        pullRequest: Number(delivery.pr.url.split('/').at(-1)),
        startedAt: timestamp(delivery.waitStartedAt),
        reason:
          delivery.stage === 'ci'
            ? 'Observing the managed PR comparison'
            : 'Managed GitHub wait and continuation watchdog',
      },
    ];
  });
}
