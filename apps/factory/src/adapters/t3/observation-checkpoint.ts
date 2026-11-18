import { z } from 'zod';
import type { ObservationCheckpoint } from '../../capabilities/observe/index.js';
import { entity, type Projection, type Shell } from './observed-model.js';

const collections = [
  'runs',
  'attempts',
  'runtimeRequests',
  'providerThreads',
  'messages',
  'turnItems',
] as const;
export function decodeObservation(checkpoint: ObservationCheckpoint): unknown {
  const value: unknown = JSON.parse(checkpoint.value);
  const header = z
    .object({ format: z.enum(['list-1', 'projection-1']), thread: entity.optional() })
    .safeParse(value);
  if (!header.success) return value;
  if (header.data.format === 'list-1')
    return (checkpoint.entities ?? []).map((item) => JSON.parse(item.value));
  const result: Record<string, unknown> = { thread: header.data.thread };
  for (const key of collections) result[key] = [];
  const arrays = new Map<string, unknown[]>(collections.map((key) => [key, []]));
  for (const item of checkpoint.entities ?? []) {
    const [collection] = z.tuple([z.string(), z.string()]).parse(JSON.parse(item.id));
    const values = arrays.get(collection);
    if (!values) throw new Error('Unknown retained T3 collection');
    values.push(JSON.parse(item.value));
  }
  for (const [key, values] of arrays) result[key] = values;
  return result;
}

/** Encode opaque entity deltas; unchanged history does not reach SQLite again. */
export function observationEncoding() {
  let previous: Map<string, unknown> | undefined;
  return (value: Projection | Shell[]) => {
    const next = new Map<string, unknown>();
    let header: unknown;
    if (Array.isArray(value)) {
      header = { format: 'list-1' };
      for (const row of value) next.set(row.id, row);
    } else {
      header = { format: 'projection-1', thread: value.thread };
      for (const collection of collections)
        for (const row of value[collection]) next.set(JSON.stringify([collection, row.id]), row);
    }
    const entities: { id: string; value: string | null }[] = [];
    for (const [id, row] of next)
      if (previous?.get(id) !== row) entities.push({ id, value: JSON.stringify(row) });
    for (const id of previous?.keys() ?? []) if (!next.has(id)) entities.push({ id, value: null });
    return {
      value: JSON.stringify(header),
      entities,
      replaceEntities: previous === undefined,
      committed: () => {
        previous = next;
      },
    };
  };
}
