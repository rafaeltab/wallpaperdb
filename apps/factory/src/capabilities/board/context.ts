import type { ObservedLabel, ObservedUser, ScheduleSnapshot } from '../observe/index.js';
import type { Decision, Fact, ItemDetails, Source, Tables } from './model.js';
import { entity, issueId, known, timestamp, unknown } from './values.js';
export const gh = 'source:github',
  local = 'source:factory',
  t3 = 'source:t3';
export const repositoryId = 'repository:rafaeltab/wallpaperdb';
export function source(
  kind: Source['kind'],
  input: { observedAt?: number; startedAt?: number; failedAt?: number; error?: string }
): Source {
  return entity({
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
    nextAttemptAt: null,
    failure: input.error
      ? {
          code: 'provider-unavailable',
          message: 'Refresh failed. Retained facts remain dated by their source.',
        }
      : null,
  });
}
export const reason = (code: string, message: string) => ({ code, message });
const decision = (state: Decision['state'], message: string): Decision => ({
  state,
  reasons: message ? [reason(state, message)] : [],
  sourceIds: [gh, local],
});
export const limit = (value: number): import('./model.js').Limit =>
  value === -1 ? { kind: 'unlimited' } : { kind: 'limited', maximum: value };
export function projectionContext(input: ScheduleSnapshot, at: string) {
  const tables: {
    -readonly [K in keyof Tables]: { -readonly [Id in keyof Tables[K]]: Tables[K][Id] };
  } = {
    repositories: {},
    sources: {},
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
  };
  const details: Record<string, ItemDetails> = {};
  tables.repositories[repositoryId] = entity({
    id: repositoryId,
    owner: 'rafaeltab',
    name: 'wallpaperdb',
    url: 'https://github.com/rafaeltab/wallpaperdb',
    defaultBranch: 'main',
  });
  tables.sources[gh] = source('github', input.observations);
  tables.sources[t3] = source('t3', input.threads ?? {});
  tables.sources[local] = source('factory', {
    observedAt: input.observations.jobsObservedAt ?? Date.parse(at),
  });
  const observed = timestamp(input.observations.observedAt);
  const fact = <T>(value: T): Fact<T> => (observed ? known(value, gh, observed) : unknown(gh));
  const addUser = (u: ObservedUser) => {
    const id = `user:${u.id}` as const;
    tables.users[id] = entity({ ...u, id });
    return id;
  };
  const addLabel = (l: ObservedLabel) => {
    const id = `label:${l.id}` as const;
    tables.labels[id] = entity({ ...l, id, repositoryId });
    return id;
  };
  const ensureIssue = (n: number) => {
    const id = issueId(n);
    tables.issues[id] ??= entity({
      id,
      repositoryId,
      number: n,
      metadata: unknown(gh, 'Referenced issue metadata has not been collected.'),
      project: unknown(gh),
      eligibility: decision('unknown', 'Issue evidence is unavailable.'),
    });
    return id;
  };
  return {
    tables,
    details,
    input,
    at,
    observed,
    fact,
    addUser,
    addLabel,
    ensureIssue,
    facts: input.observations.facts,
  };
}
export type ProjectionContext = ReturnType<typeof projectionContext>;
