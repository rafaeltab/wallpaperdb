import type { Stage } from '../job/index.js';
import type { ScheduleSnapshot } from '../observe/index.js';
import type { ActivityCategory, FactoryActivity } from './model.js';

// Only CI-repair-origin delivery is instrumented here, not general delivery categories.
const responsibility: Partial<Record<Stage, { category: ActivityCategory; reason: string }>> = {
  implementation: { category: 'implementing', reason: 'Repairing managed CI failures' },
  babysitting: { category: 'implementing', reason: 'Repairing managed CI failures' },
  review: { category: 'reviewing', reason: 'Reviewing CI repairs' },
  publication: { category: 'publishing', reason: 'Publishing CI repairs' },
};
export function managedRepairs(input: ScheduleSnapshot): FactoryActivity['items'][number][] {
  return input.jobs.flatMap((job) => {
    if (job.kind !== 'job') return [];
    const control = input.localWork.find((work) => work.intent?.id === job.intent.id)?.control;
    const delivery = job.delivery;
    const current = delivery?.ciRepair ? responsibility[delivery.stage] : undefined;
    if (
      !current ||
      !delivery ||
      delivery.ready ||
      delivery.landed ||
      delivery.active === false ||
      control?.cancelled ||
      control?.released ||
      control?.retirement ||
      !input.state.admissions.some((admission) => admission.issue === job.intent.issue) ||
      job.execution.kind !== 'found' ||
      job.execution.question ||
      !['running', 'preparing', 'starting'].includes(job.execution.status)
    )
      return [];
    return [
      {
        id: `ci-repair:${job.intent.id}:${job.stageIndex ?? 'unknown'}:${delivery.stage}`,
        ...current,
        lifecycle: 'current' as const,
        issue: job.intent.issue,
        pullRequest:
          delivery.pr?.kind === 'found' ? Number(delivery.pr.url.split('/').at(-1)) : null,
        // Admission/stage entry cannot establish when this observed repair run actually started.
        startedAt: null,
      },
    ];
  });
}
