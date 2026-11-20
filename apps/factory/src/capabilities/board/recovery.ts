import type { ScheduleSnapshot } from '../observe/index.js';
import type { Stage } from '../job/index.js';
import type { ActivityCategory, FactoryActivity } from './model.js';
import { timestamp } from './values.js';

const responsibilities: Partial<Record<Stage, ActivityCategory>> = {
  implementation: 'implementing',
  babysitting: 'implementing',
  review: 'reviewing',
  publication: 'publishing',
};
export function recoveryActivities(
  input: ScheduleSnapshot,
  existing: FactoryActivity['items']
): FactoryActivity['items'][number][] {
  const items: FactoryActivity['items'][number][] = [];
  for (const investigation of input.reconciliation ?? []) {
    const category = investigation.stage
      ? (responsibilities[investigation.stage] ?? 'recovering')
      : 'recovering';
    if (existing.some((item) => item.category === category && item.issue === investigation.issue))
      continue;
    items.push({
      id: investigation.id,
      issue: investigation.issue,
      category,
      lifecycle: 'current',
      pullRequest: null,
      startedAt: timestamp(investigation.startedAt),
      reason: 'Establishing managed launch or resume outcome',
    });
  }
  for (const recovery of input.recoveries ?? []) {
    if (
      recovery.active !== true ||
      recovery.bindingAvailable !== true ||
      !recovery.phase ||
      !['resolving', 'reviewing', 'verifying', 'publishing'].includes(recovery.phase)
    )
      continue;
    items.push({
      id: `restack-reconciliation:${recovery.issue}:${recovery.pr}`,
      issue: recovery.issue,
      pullRequest: Number(recovery.pr.split('/').at(-1)) || null,
      category: 'restacking',
      lifecycle: 'current',
      // Historical restack workers do not supply a reliable stage start.
      startedAt: null,
      reason: recovery.progress,
    });
  }
  return items;
}
