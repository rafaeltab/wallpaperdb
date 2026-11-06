import type { ScheduleSnapshot } from '../observe/index.js';
import { capacityOccupied } from '../plan/index.js';
import { populateCards } from './cards.js';
import { limit, projectionContext } from './context.js';
import { coverageFor } from './coverage.js';
import { populateIssues } from './issues.js';
import { populateJobs } from './jobs.js';
import { populateMaintenance } from './maintenance.js';
import type { BoardSnapshot } from './model.js';
import { populatePulls } from './pulls.js';
import { stacks } from './stacks.js';
import { populateThreads } from './threads.js';
import { entity } from './values.js';
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
  return { snapshot, details };
}
