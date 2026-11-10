import type { ScheduleSnapshot } from '../observe/index.js';
import { version } from './values.js';
/** Relevant planning facts exclude source freshness, elapsed time and presentation. */
export function planningIdentity(input: ScheduleSnapshot) {
  const pulls = new Map(input.observations.facts?.pullRequests.map((pr) => [pr.number, pr]));
  return version({
    state: input.state,
    issues: input.observations.facts?.issues.map((i) => ({
      number: i.number,
      open: i.open,
      candidate: i.candidate,
      labels: i.labels,
      projectStatus: i.projectStatus,
      projectPriority: i.projectPriority,
      projectSize: i.projectSize,
      updatedAt: i.updatedAt,
      blockers: i.blockers,
      parents: i.parents,
      pullRequests: i.pullRequests.map((number) => {
        const pr = pulls.get(number);
        return { number, url: pr?.url, state: pr?.state };
      }),
      evaluation: i.evaluation
        ? {
            allowed: i.evaluation.allowed,
            blockersReady: i.evaluation.blockersReady,
            prerequisites: i.evaluation.prerequisites,
          }
        : undefined,
    })),
    jobs: input.jobs.map((j) =>
      j.kind === 'job'
        ? {
            issue: j.intent.issue,
            prerequisite: j.prerequisite,
            delivery: j.delivery,
            execution: j.execution.kind === 'found' ? j.execution.status : j.execution.kind,
          }
        : j
    ),
  });
}
