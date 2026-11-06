import { randomUUID } from 'node:crypto';
import type { ScheduleSnapshot } from '../observe/index.js';
import type {
  FactoryV2Delta,
  FactoryV2Changes,
  FactoryV2Problem,
  FactoryV2ItemDetails,
  FactoryV2Command,
  FactoryV2IssueSearch,
  FactoryV2PlanDetails,
} from './model.js';
import { version, problem } from './values.js';
import { project } from './projection.js';
import { entityChanges } from './changes.js';

/** Local projection lifetime. Publication completes before listeners see a revision. */
export async function liveBoard(config: {
  scopeId: string;
  initial: ScheduleSnapshot;
  now?: () => number;
}) {
  const now = config.now ?? Date.now;
  const epoch = randomUUID();
  let revision = 0;
  const cursor = () =>
    Buffer.from(JSON.stringify({ scope: config.scopeId, epoch, revision })).toString('base64url');
  let current = project(config.initial, new Date(now()).toISOString(), config.scopeId, cursor());
  const history: FactoryV2Delta[] = [];
  const listeners = new Set<() => void>();
  let identity = version(stable(config.initial));
  return {
    snapshot: () => current.snapshot,
    publish: async (input: ScheduleSnapshot) => {
      const nextIdentity = version(stable(input));
      if (identity === nextIdentity) return;
      const before = current.snapshot;
      revision++;
      const next = project(input, new Date(now()).toISOString(), config.scopeId, cursor());
      const delta: FactoryV2Delta = {
        apiVersion: 2,
        scopeId: config.scopeId,
        fromCursor: before.cursor,
        toCursor: next.snapshot.cursor,
        committedAt: next.snapshot.committedAt,
        changes: entityChanges(before.entities, next.snapshot.entities),
        meta: next.snapshot.meta,
      };
      history.push(delta);
      if (history.length > 64) history.shift();
      current = next;
      identity = nextIdentity;
      for (const listener of listeners) listener();
    },
    changes: (after: string): FactoryV2Changes | FactoryV2Problem => {
      if (after === current.snapshot.cursor) return { kind: 'unchanged', cursor: after };
      const index = history.findIndex((d) => d.fromCursor === after);
      if (index < 0) return { kind: 'resync-required', reason: 'reset' };
      const batches = history.slice(index, index + 32);
      return {
        kind: 'changes',
        batches,
        nextCursor: batches[batches.length - 1].toCursor,
        hasMore: index + batches.length < history.length,
      };
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    receipt: (_id: string) => undefined,
    submit: (_command: FactoryV2Command): FactoryV2Problem =>
      problem(503, 'unavailable', 'Command execution is not configured.'),
    search: (query: string, _limit: number, _token?: string): FactoryV2IssueSearch => ({
      apiVersion: 2,
      query,
      nextPageToken: null,
      coverage: current.snapshot.meta.coverage,
      sources: current.snapshot.entities.sources,
      hits: [],
      users: current.snapshot.entities.users,
      labels: current.snapshot.entities.labels,
      repositories: current.snapshot.entities.repositories,
    }),
    details: (id: string): FactoryV2ItemDetails | undefined => current.details[id],
    plan: (_id: string): FactoryV2PlanDetails | undefined => undefined,
    close: () => {
      listeners.clear();
    },
  };
}
function stable(input: ScheduleSnapshot) {
  return {
    ...input,
    jobs: input.jobs.map((j) => (j.kind === 'job' ? { ...j, elapsedMs: undefined } : j)),
    observations: { ...input.observations, ageMs: undefined, stale: undefined, state: undefined },
    threads: input.threads
      ? { ...input.threads, ageMs: undefined, stale: undefined, state: undefined }
      : undefined,
  };
}
