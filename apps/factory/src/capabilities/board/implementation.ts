import { createHash, randomUUID } from 'node:crypto';
import type { ScheduleSnapshot } from '../observe/index.js';
import type {
  FactoryV2Snapshot,
  Source,
  Fact,
  FactoryV2Changes,
  FactoryV2Problem,
} from './model.js';

export const version = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const timestamp = (value: number | undefined) =>
  value === undefined ? null : new Date(value).toISOString();
export function source(
  kind: Source['kind'],
  input: { observedAt?: number; startedAt?: number; failedAt?: number; error?: string }
): Source {
  const value = {
    id: `source:${kind}` as const,
    kind,
    observedAt: timestamp(input.observedAt),
    staleAt:
      input.observedAt === undefined || kind === 'factory'
        ? null
        : timestamp(input.observedAt + 240000),
    refresh: input.error
      ? ('failed' as const)
      : input.observedAt === undefined
        ? ('unavailable' as const)
        : (input.startedAt ?? 0) > input.observedAt
          ? ('refreshing' as const)
          : ('idle' as const),
    lastAttemptAt: timestamp(input.startedAt),
    nextAttemptAt:
      input.startedAt === undefined || kind === 'factory'
        ? null
        : timestamp(input.startedAt + 120000),
    failure: input.error
      ? {
          code: 'provider-unavailable',
          message: 'Refresh failed. Retained facts remain dated by their source.',
        }
      : null,
  };
  return { ...value, version: version(value) };
}
export const known = <T>(value: T, sourceId: Source['id'], observedAt: string): Fact<T> => ({
  state: 'known',
  value,
  sourceId,
  observedAt,
});
export const unknown = (sourceId: Source['id'], reason = 'Not observed.'): Fact<never> => ({
  state: 'unknown',
  sourceId,
  reason,
});
export async function liveBoard(config: {
  scopeId: string;
  initial: ScheduleSnapshot;
  now?: () => number;
}) {
  const now = config.now ?? Date.now;
  const initial = config.initial;
  const cursor = randomUUID();
  const at = new Date(now()).toISOString();
  const factory = {
    id: 'factory:local' as const,
    version: String(initial.state.revision),
    paused: initial.state.paused,
    concurrency: { limit: limit(initial.state.concurrency), occupied: 0 },
    admission: { limit: limit(initial.state.allowance), consumed: initial.state.admissions.length },
    actionIds: [],
  };
  const snapshot: FactoryV2Snapshot = {
    apiVersion: 2,
    scopeId: config.scopeId,
    cursor,
    committedAt: at,
    meta: {
      dataMode: 'live',
      coverage: {
        state: 'unavailable',
        reasons: [{ code: 'initial', message: 'Provider facts have not been observed.' }],
        unresolvedIssueIds: [],
      },
      diagnostics: [],
      factory,
      currentPlanId: null,
      transport: { changes: true, events: true, suggestedPollMs: 1000 },
    },
    entities: {
      repositories: {},
      sources: {
        'source:github': source('github', initial.observations),
        'source:t3': source('t3', initial.threads ?? {}),
        'source:factory': source('factory', { observedAt: now() }),
      },
      users: {},
      labels: {},
      issues: {},
      pullRequests: {},
      relationships: {},
      stacks: {},
      threads: {},
      jobs: {},
      maintenance: {},
      items: {},
      actions: {},
      plans: {},
    },
  };
  return {
    snapshot: () => snapshot,
    changes: (after: string): FactoryV2Changes | FactoryV2Problem =>
      after === cursor
        ? { kind: 'unchanged', cursor }
        : { kind: 'resync-required', reason: 'reset' },
    subscribe: (_listener: () => void) => () => {},
    receipt: (_id: string) => undefined,
    submit: (_command: import('./model.js').FactoryV2Command): FactoryV2Problem => ({
      type: 'https://github.com/rafaeltab/wallpaperdb/blob/main/docs/problems/factory-v2-unavailable.md',
      status: 503,
      code: 'unavailable',
      title: 'Commands unavailable',
      detail: 'Command execution is not configured.',
      retry: 'later',
      commandId: null,
    }),
    search: (
      _query: string,
      _limit: number,
      _token?: string
    ): import('./model.js').FactoryV2IssueSearch => ({
      apiVersion: 2,
      query: _query,
      nextPageToken: null,
      coverage: snapshot.meta.coverage,
      sources: snapshot.entities.sources,
      hits: [],
      users: {},
      labels: {},
      repositories: {},
    }),
    details: (_id: string): import('./model.js').FactoryV2ItemDetails | undefined => undefined,
    plan: (_id: string): import('./model.js').FactoryV2PlanDetails | undefined => undefined,
    close: () => {},
  };
}
function limit(value: number): import('./model.js').Limit {
  return value === -1 ? { kind: 'unlimited' } : { kind: 'limited', maximum: value };
}
