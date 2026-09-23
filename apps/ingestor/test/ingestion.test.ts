import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { Ingestion, IngestionUnavailable, type ValidationRejection } from '../src/ingestion/index.js';
import { fixture, uploadInput } from './helpers/ingestion.js';

describe('Wallpaper ingestion', () => {
  it.each<ValidationRejection>([
    { _tag: 'InvalidFormat', mimeType: 'text/plain' },
    { _tag: 'TooLarge', fileSizeBytes: 100, maxFileSizeBytes: 50, fileType: 'image' },
    { _tag: 'InvalidDimensions', width: 1, height: 1, minWidth: 1280, minHeight: 720, maxWidth: 7680, maxHeight: 4320 },
  ])('does not persist rejected content: $_tag', async (rejection) => {
    const test = fixture({ inspection: { inspect: () => Effect.succeed(rejection) } });
    expect(await Effect.runPromise(Ingestion.use((ingestion) => ingestion.upload(uploadInput)).pipe(Effect.provide(test.layer)))).toEqual(rejection);
    expect(test.store.records.size).toBe(0);
    expect(test.objects).toEqual([]);
  });
  it('isolates content deduplication by authenticated owner', async () => {
    const test = fixture();
    const results = await Effect.runPromise(Ingestion.use((ingestion) => Effect.all([ingestion.upload(uploadInput), ingestion.upload({ ...uploadInput, principal: { profileId: 'profile-2' } })])).pipe(Effect.provide(test.layer)));
    expect(results.map((result) => result._tag)).toEqual(['Accepted', 'Accepted']);
    expect(test.objects).toHaveLength(2);
  });
  it('reports an unfinished reservation without creating a second upload', async () => {
    const test = fixture({ storage: { put: () => Effect.fail(new IngestionUnavailable({ operation: 'put', cause: 'offline' })) } });
    const result = await Effect.runPromise(Ingestion.use((ingestion) => Effect.gen(function* () { yield* ingestion.upload(uploadInput).pipe(Effect.ignore); return yield* ingestion.upload(uploadInput); })).pipe(Effect.provide(test.layer)));
    expect(result).toEqual({ _tag: 'InProgress' });
    expect(test.store.records.size).toBe(1);
  });
  it('recovers an ambiguous PNG upload using its persisted metadata and exact logical asset', async () => {
    const test = fixture({ storage: { put: () => Effect.fail(new IngestionUnavailable({ operation: 'put', cause: 'late acknowledgement' })) } });
    await Effect.runPromise(Ingestion.use((ingestion) => Effect.gen(function* () {
      yield* ingestion.upload(uploadInput).pipe(Effect.ignore);
      test.objects.push({ wallpaperId: 'wlpr_1', extension: 'png' });
      yield* test.advance();
      yield* ingestion.reconcile();
    })).pipe(Effect.provide(test.layer)));
    expect(test.published[0]?.wallpaper.metadata.extension).toBe('png');
    expect(test.store.records.get('wlpr_1')?.state).toBe('processing');
  });
  it('does not claim recent uploads and leaves storage outages recoverable', async () => {
    const test = fixture({ storage: { put: () => Effect.fail(new IngestionUnavailable({ operation: 'put', cause: 'offline' })), exists: () => Effect.fail(new IngestionUnavailable({ operation: 'exists', cause: 'offline' })) } });
    await Effect.runPromise(Ingestion.use((ingestion) => Effect.gen(function* () {
      yield* ingestion.upload(uploadInput).pipe(Effect.ignore);
      yield* ingestion.reconcile();
      expect(test.store.records.get('wlpr_1')?.attempts).toBe(0);
      yield* test.advance();
      yield* ingestion.reconcile();
    })).pipe(Effect.provide(test.layer)));
    expect(test.store.records.get('wlpr_1')?.state).toBe('uploading');
    expect(test.store.records.get('wlpr_1')?.attempts).toBe(0);
  });
  it('cleans orphaned assets across pages while retaining active uploads', async () => {
    const test = fixture({ storage: { list: (cursor) => Effect.succeed(cursor ? { assets: [{ wallpaperId: 'orphan-two', extension: 'webp' }] } : { assets: [{ wallpaperId: 'wlpr_1', extension: 'png' }, { wallpaperId: 'orphan-one', extension: 'png' }], cursor: 'next' }) } });
    test.objects.push({ wallpaperId: 'orphan-one', extension: 'png' }, { wallpaperId: 'orphan-two', extension: 'webp' });
    await Effect.runPromise(Ingestion.use((ingestion) => Effect.gen(function* () { yield* ingestion.upload(uploadInput); yield* ingestion.cleanup(); })).pipe(Effect.provide(test.layer)));
    expect(test.objects).toEqual([{ wallpaperId: 'wlpr_1', extension: 'png' }]);
  });
  it('rejects an absent authenticated owner before inspecting or reserving the upload', async () => {
    const test = fixture();
    const result = await Effect.runPromise(Ingestion.use((ingestion) => ingestion.upload({ ...uploadInput, principal: { profileId: '' } })).pipe(Effect.provide(test.layer)));
    expect(result).toEqual({ _tag: 'Unauthorized' });
    expect(test.store.records.size).toBe(0);
  });
  it('bounds missing-object recovery and never publishes an upload whose object is absent', async () => {
    const test = fixture({ storage: { put: () => Effect.fail(new IngestionUnavailable({ operation: 'put', cause: 'offline' })) } });
    await Effect.runPromise(Ingestion.use((ingestion) => Effect.gen(function* () {
      yield* ingestion.upload(uploadInput).pipe(Effect.ignore);
      yield* test.advance();
      yield* ingestion.reconcile();
      yield* test.advance();
      yield* ingestion.reconcile();
      yield* test.advance();
      yield* ingestion.reconcile();
    })).pipe(Effect.provide(test.layer)));
    expect([...test.store.records.values()][0]?.state).toBe('failed');
    expect(test.published).toEqual([]);
  });
  it('retains a committed outbox occurrence when publication fails and replays that same occurrence', async () => {
    let available = false;
    const attempts: string[] = [];
    const test = fixture({ events: { publish: (event) => Effect.gen(function* () { attempts.push(event.id); if (!available) return yield* new IngestionUnavailable({ operation: 'publish', cause: 'offline' }); }) } });
    await Effect.runPromise(Ingestion.use((ingestion) => Effect.gen(function* () {
      const result = yield* ingestion.upload(uploadInput);
      expect(result._tag).toBe('Accepted');
      expect(test.store.outbox.size).toBe(1);
      available = true;
      yield* test.advance();
      yield* ingestion.reconcile();
    })).pipe(Effect.provide(test.layer)));
    expect(attempts).toHaveLength(2);
    expect(new Set(attempts).size).toBe(1);
    expect(test.store.outbox.size).toBe(0);
  });
  it('reuses an owner’s committed content without storing or publishing it twice', async () => {
    const test = fixture();
    const results = await Effect.runPromise(Ingestion.use((ingestion) => Effect.all([ingestion.upload(uploadInput), ingestion.upload(uploadInput)])).pipe(Effect.provide(test.layer)));
    expect(results.map((result) => result._tag)).toEqual(['Accepted', 'Duplicate']);
    expect(test.objects).toHaveLength(1);
    expect(test.published).toHaveLength(1);
  });
  it('durably accepts an inspected wallpaper and publishes its committed snapshot', async () => {
    const test = fixture();
    const result = await Effect.runPromise(Ingestion.use((ingestion) => ingestion.upload(uploadInput)).pipe(Effect.provide(test.layer)));
    expect(result._tag).toBe('Accepted');
    if (result._tag !== 'Accepted') throw new Error('Expected accepted upload');
    expect(test.objects).toEqual([{ wallpaperId: result.upload.id, extension: 'png' }]);
    expect(test.published).toHaveLength(1);
    expect(test.published[0]?.wallpaper).toMatchObject({ id: result.upload.id, profileId: 'profile-1', originalFilename: '.._wallpaper.png' });
    expect(test.store.records.get(result.upload.id)?.state).toBe('processing');
    expect(test.store.outbox.size).toBe(0);
  });
});
