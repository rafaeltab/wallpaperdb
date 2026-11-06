import { createHash } from 'node:crypto';
import type { Fact, Source, Entity } from './model.js';
export const version = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function entity<T extends { id: string }>(value: T): T & Entity<T['id']> {
  return { ...value, version: version(value) };
}
export const timestamp = (value: number | undefined) =>
  value === undefined ? null : new Date(value).toISOString();
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
export const issueId = (n: number) => `issue:rafaeltab/wallpaperdb/${n}` as const;
export const pullId = (n: number) => `pr:rafaeltab/wallpaperdb/${n}` as const;
export const jobId = (n: number) => `job:rafaeltab/wallpaperdb/${n}` as const;
export const threadId = (environment: string, id: string) => `thread:${environment}/${id}` as const;
export function problem(
  status: number,
  code: import('./model.js').FactoryV2Problem['code'],
  detail: string,
  commandId: string | null = null
): import('./model.js').FactoryV2Problem {
  return {
    type: `https://github.com/rafaeltab/wallpaperdb/blob/main/docs/problems/factory-v2-${code}.md`,
    status,
    code,
    title: code,
    detail,
    commandId,
    retry: code === 'stale-action' ? 'refresh' : code === 'unavailable' ? 'later' : 'never',
  };
}
