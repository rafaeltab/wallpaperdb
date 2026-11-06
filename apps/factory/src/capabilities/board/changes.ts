import type { EntityChange, Tables } from './model.js';
function diff<Value extends { readonly id: string }>(
  before: Readonly<Record<string, Value>>,
  after: Readonly<Record<string, Value>>
) {
  const result: (
    | { operation: 'upsert'; entity: Value }
    | { operation: 'remove'; id: Value['id'] }
  )[] = [];
  for (const value of Object.values(after))
    if (JSON.stringify(before[value.id]) !== JSON.stringify(value))
      result.push({ operation: 'upsert', entity: value });
  for (const value of Object.values(before))
    if (!Object.hasOwn(after, value.id)) result.push({ operation: 'remove', id: value.id });
  return result;
}
export function entityChanges(before: Tables, after: Tables): EntityChange[] {
  return [
    ...diff(before.repositories, after.repositories).map((change) => ({
      table: 'repositories' as const,
      ...change,
    })),
    ...diff(before.sources, after.sources).map((change) => ({
      table: 'sources' as const,
      ...change,
    })),
    ...diff(before.users, after.users).map((change) => ({ table: 'users' as const, ...change })),
    ...diff(before.labels, after.labels).map((change) => ({ table: 'labels' as const, ...change })),
    ...diff(before.issues, after.issues).map((change) => ({ table: 'issues' as const, ...change })),
    ...diff(before.pullRequests, after.pullRequests).map((change) => ({
      table: 'pullRequests' as const,
      ...change,
    })),
    ...diff(before.relationships, after.relationships).map((change) => ({
      table: 'relationships' as const,
      ...change,
    })),
    ...diff(before.stacks, after.stacks).map((change) => ({ table: 'stacks' as const, ...change })),
    ...diff(before.threads, after.threads).map((change) => ({
      table: 'threads' as const,
      ...change,
    })),
    ...diff(before.jobs, after.jobs).map((change) => ({ table: 'jobs' as const, ...change })),
    ...diff(before.maintenance, after.maintenance).map((change) => ({
      table: 'maintenance' as const,
      ...change,
    })),
    ...diff(before.items, after.items).map((change) => ({ table: 'items' as const, ...change })),
    ...diff(before.actions, after.actions).map((change) => ({
      table: 'actions' as const,
      ...change,
    })),
    ...diff(before.plans, after.plans).map((change) => ({ table: 'plans' as const, ...change })),
  ];
}
