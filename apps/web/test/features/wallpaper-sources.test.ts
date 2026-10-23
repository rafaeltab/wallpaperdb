import { expect, it } from 'vitest';
import { createWallpaperSourceBatch, type SourceBatchApi } from '@/features/wallpaper-creation';

it('keeps one initial Wallpaper through independent rejection and retry without uploading successful Sources again', async () => {
  let revision = 0;
  const uploads: string[] = [], intents: string[] = [];
  const candidates = new Map<string, { candidateId: string; status: string; expectedSourceSetRevision: string; sourceId?: string }>();
  const wallpaper = { wallpaperId: 'wallpaper', assetId: 'asset', sourceId: null, state: 'awaiting-source' as const, createdAt: 'now' };
  let published = false, badAttempts = 0;
  const api: SourceBatchApi<string> = {
    begin: async () => wallpaper,
    wallpaper: async () => published ? { ...wallpaper, state: 'published', sourceId: 'source-good' } : wallpaper,
    list: async () => ({ sourceSetRevision: String(revision), sources: revision ? [{sourceId: 'source-good'}] : [], candidates: [] }),
    create: async (_asset, key, expected) => {
      const candidate = { candidateId: key, status: 'awaiting-bytes', expectedSourceSetRevision: expected };
      candidates.set(key, candidate); return candidate;
    },
    status: async (_asset, id) => { const candidate = candidates.get(id); if (!candidate) throw new Error('Unknown candidate'); return candidate; },
    upload: async (_asset, id, file) => {
      uploads.push(file);
      const candidate = { candidateId: id, expectedSourceSetRevision: String(revision), status: file === 'bad' && ++badAttempts === 1 ? 'rejected' : 'ready' };
      candidates.set(id, candidate); return candidate;
    },
    expectSource: async (_wallpaper, id) => { intents.push(id); },
    accept: async (_asset, id, expectedRevision) => {
      expect(expectedRevision).toBe(String(revision)); revision++; published = true;
      const candidate = { candidateId: id, expectedSourceSetRevision: expectedRevision, status: 'accepted', sourceId: `source-${id}` };
      candidates.set(id, candidate); return candidate;
    },
    cancel: async () => {},
    wait: async () => {},
  };
  const batch = createWallpaperSourceBatch(api, { creationKey: 'one-request' });
  batch.addFiles([{ value: 'bad', name: 'bad.png' }, { value: 'good', name: 'good.png' }]);
  await batch.run();
  expect(batch.getSnapshot()).toMatchObject({ wallpaperId: 'wallpaper', rows: [{ status: 'failed' }, { status: 'accepted' }] });
  const bad = batch.getSnapshot().rows[0]; if (!bad) throw new Error('Missing failed row');
  batch.retry(bad.id); await batch.run();
  expect(batch.getSnapshot().rows.map(row => row.status)).toEqual(['accepted', 'accepted']);
  expect(uploads).toEqual(['bad', 'good', 'bad']);
  expect(intents).toHaveLength(1);
});
