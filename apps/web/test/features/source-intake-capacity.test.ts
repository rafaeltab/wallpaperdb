import { expect, it } from 'vitest';
import {
  createWallpaperSourceBatch,
  type ManagedCandidate,
  type SourceBatchApi,
} from '@/features/wallpaper-creation';

it('reserves recovery capacity for an ambiguous initial acceptance with fifteen files waiting', async () => {
  const wallpaper = {
    wallpaperId: 'saved',
    assetId: 'asset',
    sourceId: null,
    state: 'awaiting-source' as const,
    createdAt: 'now',
  };
  let accepted = false;
  const uploads: string[] = [];
  const api: SourceBatchApi<string> = {
    identifier: () => crypto.randomUUID(),
    begin: async () => wallpaper,
    wallpaper: async () => ({ ...wallpaper, state: 'published', sourceId: 'first' }),
    list: async () => ({
      sourceSetRevision: accepted ? '1' : '0',
      sources: accepted ? [{ sourceId: 'first' }] : [],
      candidates: [],
      hasPendingCandidates: false,
    }),
    create: async (_asset, id, revision) => ({
      candidateId: id,
      status: 'awaiting-bytes',
      expectedSourceSetRevision: revision,
    }),
    status: async (_asset, id) => ({
      candidateId: id,
      status: 'accepted',
      sourceId: 'first',
      expectedSourceSetRevision: '0',
    }),
    upload: async (_asset, id, file) => {
      uploads.push(file);
      return { candidateId: id, status: 'ready', expectedSourceSetRevision: accepted ? '1' : '0' };
    },
    accept: async (_asset, id, revision) => {
      if (!accepted) {
        accepted = true;
        throw new Error('Lost acceptance response');
      }
      return {
        candidateId: id,
        status: 'accepted',
        sourceId: id,
        expectedSourceSetRevision: revision,
      };
    },
    expectSource: async () => {},
    cancel: async () => {
      throw new Error('Do not cancel ambiguous work');
    },
    wait: async () => {},
  };
  const batch = createWallpaperSourceBatch(api, { creationKey: 'same-request' });
  batch.addFiles(Array.from({ length: 16 }, (_, i) => ({ value: String(i), name: `${i}.png` })));
  await batch.run(new AbortController().signal);
  expect(uploads).toEqual(['0']);
  expect(batch.addFiles([{ value: 'extra', name: 'extra.png' }])).toBe(false);
  const first = batch.getSnapshot().rows[0];
  if (!first) throw new Error('Missing initial row');
  batch.retry(first.id);
  await batch.run(new AbortController().signal);
  expect(uploads).toHaveLength(16);
  expect(uploads.filter((value) => value === '0')).toHaveLength(1);
  expect(batch.getSnapshot().rows.every((row) => row.status === 'accepted')).toBe(true);
});

it('reuses intake capacity after sixteen outcomes while retaining independent retries and saved recovery', async () => {
  const wallpaper = {
    wallpaperId: 'wallpaper',
    assetId: 'asset',
    sourceId: 'original',
    state: 'published' as const,
    createdAt: 'now',
  };
  const candidates = new Map<string, ManagedCandidate>();
  const uploads: string[] = [];
  let fail = true;
  const api: SourceBatchApi<string> = {
    identifier: () => crypto.randomUUID(),
    begin: async () => wallpaper,
    wallpaper: async () => wallpaper,
    list: async () => ({
      sourceSetRevision: '1',
      sources: [{ sourceId: 'original' }],
      hasPendingCandidates: false,
      candidates: [],
    }),
    create: async (_asset, key) => {
      const candidate = {
        candidateId: key,
        expectedSourceSetRevision: '1',
        status: 'awaiting-bytes',
      };
      candidates.set(key, candidate);
      return candidate;
    },
    status: async (_asset, id) => {
      const candidate = candidates.get(id);
      if (!candidate) throw new Error('Missing candidate');
      return candidate;
    },
    upload: async (_asset, id, file) => {
      uploads.push(file);
      if (file === 'retry' && fail) {
        fail = false;
        throw new Error('Temporary failure');
      }
      return { candidateId: id, expectedSourceSetRevision: '1', status: 'ready' };
    },
    accept: async (_asset, id) => ({
      candidateId: id,
      expectedSourceSetRevision: '1',
      status: 'accepted',
      sourceId: id,
    }),
    expectSource: async () => {},
    cancel: async () => {},
    wait: async () => {},
  };
  const batch = createWallpaperSourceBatch(api, { wallpaperId: 'wallpaper' });
  const files = Array.from({ length: 16 }, (_, i) => ({
    value: i === 0 ? 'retry' : String(i),
    name: `${i}.png`,
  }));
  expect(batch.addFiles(files)).toBe(true);
  expect(batch.addFiles([{ value: 'overflow', name: 'overflow.png' }])).toBe(false);
  await batch.run(new AbortController().signal);
  expect(batch.getSnapshot().rows.filter((row) => row.status === 'accepted')).toHaveLength(15);
  expect(batch.addFiles([{ value: 'extra', name: 'extra.png' }])).toBe(true);
  expect(batch.replace({ value: 'replacement', name: 'replacement.png' }, 'original')).toBe(true);
  const saved = { candidateId: 'saved', expectedSourceSetRevision: '1', status: 'awaiting-bytes' };
  candidates.set(saved.candidateId, saved);
  expect(batch.resume({ value: 'saved-bytes', name: 'saved.png' }, saved)).toBe(true);
  const failed = batch.getSnapshot().rows[0];
  if (!failed) throw new Error('Missing failed row');
  batch.retry(failed.id);
  await batch.run(new AbortController().signal);
  expect(batch.getSnapshot().rows).toHaveLength(19);
  expect(batch.getSnapshot().rows.every((row) => row.status === 'accepted')).toBe(true);
  expect(uploads.filter((value) => value === 'retry')).toHaveLength(2);
  expect(uploads.filter((value) => value === '1')).toHaveLength(1);
});
