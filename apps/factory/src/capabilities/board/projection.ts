import type { ScheduleSnapshot } from '../observe/index.js';
import { capacityOccupied, emptyPlanningSafety, type PlanningSafetyView } from '../plan/index.js';
import { populateCards } from './cards.js';
import { limit, projectionContext } from './context.js';
import { coverageFor } from './coverage.js';
import { populateIssues } from './issues.js';
import { populateJobs } from './jobs.js';
import { populateMaintenance } from './maintenance.js';
import type { BoardSnapshot, FactoryPlanningState } from './model.js';
import { populatePulls } from './pulls.js';
import { stacks } from './stacks.js';
import { populateThreads } from './threads.js';
import { entity, version, threadId } from './values.js';
export function project(input: ScheduleSnapshot, at: string, scopeId: string, cursor: string) {
  const context = projectionContext(input, at);
  populateIssues(context);
  populatePulls(context);
  populateThreads(context);
  populateJobs(context);
  populateMaintenance(context);
  populateCards(context);
  const { tables, details, observed, facts } = context;
  const coverage = coverageFor(tables.issues, !!facts);
  const factory = entity({
    id: 'factory:local' as const,
    paused: input.state.paused,
    planning: planning(
      input.planningSafety ?? emptyPlanningSafety,
      input.threads?.facts?.environmentId
    ),
    concurrency: { limit: limit(input.state.concurrency), occupied: capacityOccupied(input) },
    admission: { limit: limit(input.state.allowance), consumed: input.state.admissions.length },
    actionIds: [],
  });
  const topology = stacks(tables, facts?.verifiedPrBases ?? [], observed);
  tables.relationships = topology.relationships;
  tables.stacks = topology.stacks;
  const snapshot: BoardSnapshot = {
    scopeId,
    cursor,
    committedAt: at,
    meta: {
      coverage,
      diagnostics: topology.diagnostics,
      factory,
      currentPlanId: null,
    },
    entities: tables,
  };
  const notice = input.planningSafety?.notice;
  return {
    snapshot,
    details,
    planningNoticeTarget: notice ? { id: notice.id, version: notice.version } : null,
  };
}

function planning(
  state: PlanningSafetyView,
  environment: string | undefined
): FactoryPlanningState {
  const notice = state.notice;
  const value = notice
    ? {
        id: `planning-notice:${notice.id}` as const,
        createdAt: new Date(notice.createdAt).toISOString(),
        acknowledgedAt:
          notice.acknowledgedAt === null ? null : new Date(notice.acknowledgedAt).toISOString(),
        failures: notice.failures.map((failure) => ({
          ...failure,
          attemptStartedAt: new Date(failure.attemptStartedAt).toISOString(),
          modelHandedOffAt: new Date(failure.modelHandedOffAt).toISOString(),
          deadline: new Date(failure.deadline).toISOString(),
          failedAt: new Date(failure.failedAt).toISOString(),
          threadId:
            failure.threadId && environment ? threadId(environment, failure.threadId) : null,
        })),
      }
    : null;
  return {
    maximumAttempts: 3,
    consecutiveModelDeadlineFailures: state.consecutiveModelDeadlineFailures,
    pendingNoticeCount: state.pendingNoticeCount,
    notice: value ? { ...value, version: version({ revision: notice?.version, ...value }) } : null,
  };
}
