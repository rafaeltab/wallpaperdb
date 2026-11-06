import { createHash } from 'node:crypto';
import type { Entity, Fact, Source } from './model.js';
/** Pure SHA-256 content identity. No keys, provider access or random generation. */
export const version = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function entity<T extends { id: string }>(value: T): T & Entity<T['id']> {
  return {
    ...value,
    version: version(
      Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'version'))
    ),
  };
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
export function failure(
  reason: import('./model.js').BoardFailure['reason'],
  message: string,
  commandId: string | null = null
): import('./model.js').BoardFailure {
  return { _tag: 'BoardFailure', reason, message, commandId };
}
