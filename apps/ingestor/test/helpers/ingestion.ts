import { Effect, Layer } from 'effect';
import { AssetStorage, ContentInspection, IngestionStore, UploadEvents, ingestionLayer, type AssetReference, type UploadedEvent, type UploadRecord } from '../../src/ingestion/index.js';

export const metadata = { fileType: 'image' as const, mimeType: 'image/png', width: 1920, height: 1080, fileSizeBytes: 3, contentHash: 'hash', extension: 'png' };
export const uploadInput = { principal: { profileId: 'profile-1' }, bytes: new Uint8Array([1, 2, 3]), filename: '../wallpaper.png', declaredMimeType: 'image/png' };

export class ControlledStore implements IngestionStore {
  readonly records = new Map<string, UploadRecord>();
  readonly outbox = new Map<string, UploadedEvent>();
  reserve: IngestionStore['reserve'] = (record) => Effect.sync(() => {
    const existing = [...this.records.values()].find((entry) => entry.state !== 'failed' && entry.wallpaper.profileId === record.wallpaper.profileId && entry.wallpaper.metadata.contentHash === record.wallpaper.metadata.contentHash);
    if (existing) return { _tag: 'Existing', record: existing };
    this.records.set(record.wallpaper.id, record);
    return { _tag: 'Reserved', record };
  });
  stored: IngestionStore['stored'] = (record) => Effect.sync(() => {
    this.records.set(record.wallpaper.id, { ...record, state: 'stored' });
    this.outbox.set(record.event.id, record.event);
    return true;
  });
  published: IngestionStore['published'] = (record) => Effect.sync(() => {
    this.records.set(record.wallpaper.id, { ...record, state: 'processing' });
    this.outbox.delete(record.event.id);
  });
  defer: IngestionStore['defer'] = (record, _now, maxAttempts) => Effect.sync(() => {
    const attempts = record.attempts + 1;
    this.records.set(record.wallpaper.id, { ...record, attempts, state: record.state === 'uploading' && attempts >= maxAttempts ? 'failed' : record.state });
  });
  claim: IngestionStore['claim'] = (_now, _staleBefore, _leaseUntil, limit) => Effect.sync(() => [...this.records.values()].filter((record) => (record.state === 'uploading' || record.state === 'stored') && record.attempts < 10).slice(0, limit));
  expireIntents = () => Effect.void;
  assetDisposition: IngestionStore['assetDisposition'] = (id) => Effect.sync(() => {
    const record = this.records.get(id);
    return !record || record.state === 'failed' ? 'remove' : 'retain';
  });
}
export function fixture(overrides: { inspection?: ContentInspection; storage?: Partial<AssetStorage>; events?: UploadEvents } = {}) {
  const store = new ControlledStore();
  const objects: AssetReference[] = [];
  const published: UploadedEvent[] = [];
  const storage: AssetStorage = {
    put: (input) => Effect.sync(() => { objects.push({ wallpaperId: input.wallpaperId, extension: input.metadata.extension }); }),
    exists: (ref) => Effect.sync(() => objects.some((item) => item.wallpaperId === ref.wallpaperId && item.extension === ref.extension)),
    remove: (ref) => Effect.sync(() => { const index = objects.findIndex((item) => item.wallpaperId === ref.wallpaperId); if (index >= 0) objects.splice(index, 1); }),
    list: () => Effect.succeed({ assets: [...objects] }),
    ...overrides.storage,
  };
  const layer = ingestionLayer().pipe(Layer.provide(Layer.mergeAll(
    Layer.succeed(IngestionStore, store),
    Layer.succeed(ContentInspection, overrides.inspection ?? { inspect: () => Effect.succeed({ _tag: 'Inspected', metadata }) }),
    Layer.succeed(AssetStorage, storage),
    Layer.succeed(UploadEvents, overrides.events ?? { publish: (event) => Effect.sync(() => { published.push(event); }) }),
  )));
  return { store, objects, published, layer };
}
