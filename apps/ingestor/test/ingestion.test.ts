import { Cause, Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';
import {
  Ingestion,
  IngestionUnavailable,
  type ValidationRejection,
} from '../src/ingestion/index.js';
import { fixture, uploadInput } from './helpers/ingestion.js';

describe('Wallpaper ingestion', () => {
  it.each<ValidationRejection>([
    { _tag: 'InvalidFormat', mimeType: 'text/plain' },
    { _tag: 'TooLarge', fileSizeBytes: 100, maxFileSizeBytes: 50, fileType: 'image' },
    {
      _tag: 'InvalidDimensions',
      width: 1,
      height: 1,
      minWidth: 1280,
      minHeight: 720,
      maxWidth: 7680,
      maxHeight: 4320,
    },
  ])('does not persist rejected content: $_tag', async (rejection) => {
    const test = fixture({ inspection: { inspect: () => Effect.succeed(rejection) } });
    expect(
      await Effect.runPromise(
        Ingestion.use((ingestion) => ingestion.upload(uploadInput)).pipe(Effect.provide(test.layer))
      )
    ).toEqual(rejection);
    expect(test.store.records.size).toBe(0);
    expect(test.objects).toEqual([]);
  });
  it('isolates content deduplication by authenticated owner', async () => {
    const test = fixture();
    const results = await Effect.runPromise(
      Ingestion.use((ingestion) =>
        Effect.all([
          ingestion.upload(uploadInput),
          ingestion.upload({ ...uploadInput, principal: { profileId: 'profile-2' } }),
        ])
      ).pipe(Effect.provide(test.layer))
    );
    expect(results.map((result) => result._tag)).toEqual(['Accepted', 'Accepted']);
    expect(test.objects).toHaveLength(2);
  });
  it('reports an unfinished reservation without creating a second upload', async () => {
    const test = fixture({
      storage: {
        put: () => Effect.fail(new IngestionUnavailable({ operation: 'put', cause: 'offline' })),
      },
    });
    const result = await Effect.runPromise(
      Ingestion.use((ingestion) =>
        Effect.gen(function* () {
          yield* ingestion.upload(uploadInput).pipe(Effect.ignore);
          return yield* ingestion.upload(uploadInput);
        })
      ).pipe(Effect.provide(test.layer))
    );
    expect(result).toEqual({ _tag: 'InProgress' });
    expect(test.store.records.size).toBe(1);
  });
  it('recovers an ambiguous PNG upload using its persisted metadata and exact logical asset', async () => {
    const test = fixture({
      storage: {
        put: () =>
          Effect.fail(
            new IngestionUnavailable({ operation: 'put', cause: 'late acknowledgement' })
          ),
      },
    });
    await Effect.runPromise(
      Ingestion.use((ingestion) =>
        Effect.gen(function* () {
          yield* ingestion.upload(uploadInput).pipe(Effect.ignore);
          test.objects.push({ wallpaperId: 'wlpr_1', extension: 'png' });
          yield* test.advance();
          yield* ingestion.reconcile();
        })
      ).pipe(Effect.provide(test.layer))
    );
    expect(test.published[0]?.wallpaper.metadata.extension).toBe('png');
    expect(test.store.records.get('wlpr_1')?.state).toBe('processing');
  });
  it('leaves storage outages recoverable as soon as the claimed lease expires', async () => {
    let available = false;
    let inspections = 0;
    const test = fixture({
      storage: {
        put: () => Effect.fail(new IngestionUnavailable({ operation: 'put', cause: 'offline' })),
        exists: () =>
          Effect.gen(function* () {
            inspections++;
            if (!available)
              return yield* new IngestionUnavailable({ operation: 'exists', cause: 'offline' });
            return true;
          }),
      },
    });
    await Effect.runPromise(
      Ingestion.use((ingestion) =>
        Effect.gen(function* () {
          yield* ingestion.upload(uploadInput).pipe(Effect.ignore);
          expect(yield* ingestion.reconcile()).toEqual({ processed: 0 });
          expect(inspections).toBe(0);
          expect(test.store.records.get('wlpr_1')?.attempts).toBe(0);
          yield* test.advance();
          expect(yield* ingestion.reconcile()).toEqual({ processed: 0 });
          expect(inspections).toBe(1);
          expect(test.store.records.get('wlpr_1')?.state).toBe('uploading');
          expect(test.store.records.get('wlpr_1')?.attempts).toBe(0);
          available = true;
          yield* test.advance(2 * 60_000 - 1);
          expect(yield* ingestion.reconcile()).toEqual({ processed: 0 });
          expect(inspections).toBe(1);
          yield* test.advance(1);
          expect(yield* ingestion.reconcile()).toEqual({ processed: 1 });
        })
      ).pipe(Effect.provide(test.layer))
    );
    expect(test.store.records.get('wlpr_1')?.state).toBe('processing');
    expect(test.store.records.get('wlpr_1')?.attempts).toBe(0);
    expect(inspections).toBe(2);
    expect(test.published).toHaveLength(1);
  });
  it('cleans orphaned assets across pages while retaining active uploads', async () => {
    const test = fixture({
      storage: {
        list: (cursor) =>
          Effect.succeed(
            cursor
              ? { assets: [{ wallpaperId: 'orphan-two', extension: 'webp' }] }
              : {
                  assets: [
                    { wallpaperId: 'wlpr_1', extension: 'png' },
                    { wallpaperId: 'orphan-one', extension: 'png' },
                  ],
                  cursor: 'next',
                }
          ),
      },
    });
    test.objects.push(
      { wallpaperId: 'orphan-one', extension: 'png' },
      { wallpaperId: 'orphan-two', extension: 'webp' }
    );
    await Effect.runPromise(
      Ingestion.use((ingestion) =>
        Effect.gen(function* () {
          yield* ingestion.upload(uploadInput);
          yield* ingestion.cleanup();
        })
      ).pipe(Effect.provide(test.layer))
    );
    expect(test.objects).toEqual([{ wallpaperId: 'wlpr_1', extension: 'png' }]);
  });
  it.each([
    'remove',
    'disposition',
  ] as const)('continues cleanup past an asset with a failing %s and retries it on later scans', async (operation) => {
    let available = false;
    const remaining = new Set([
      'wlpr_uncertain',
      ...Array.from({ length: 6 }, (_, index) => `wlpr_same_page_${index}`),
      'wlpr_later_page',
    ]);
    const unavailable = new IngestionUnavailable({ operation, cause: 'asset unavailable' });
    const test = fixture({
      storage: {
        list: (cursor) =>
          Effect.sync(() => ({
            assets: [...remaining]
              .filter((id) => (cursor ? id === 'wlpr_later_page' : id !== 'wlpr_later_page'))
              .map((wallpaperId) => ({ wallpaperId, extension: 'png' })),
            ...(cursor ? {} : { cursor: 'next' }),
          })),
        remove: (asset) =>
          Effect.suspend(() =>
            operation === 'remove' && asset.wallpaperId === 'wlpr_uncertain' && !available
              ? Effect.fail(unavailable)
              : Effect.sync(() => {
                  remaining.delete(asset.wallpaperId);
                })
          ),
      },
    });
    if (operation === 'disposition')
      test.store.assetDisposition = (id) =>
        id === 'wlpr_uncertain' && !available ? Effect.fail(unavailable) : Effect.succeed('remove');

    await Effect.runPromise(
      Ingestion.use((ingestion) =>
        Effect.gen(function* () {
          yield* ingestion.cleanup();
          expect([...remaining]).toEqual(['wlpr_uncertain']);
          yield* ingestion.cleanup();
          expect([...remaining]).toEqual(['wlpr_uncertain']);
          available = true;
          yield* ingestion.cleanup();
          expect([...remaining]).toEqual([]);
        })
      ).pipe(Effect.provide(test.layer))
    );
  });
  it('reports a listing failure and resumes cleanup from that page after recovery', async () => {
    let available = false;
    const cursors: Array<string | undefined> = [];
    const unavailable = new IngestionUnavailable({ operation: 'list', cause: 'storage offline' });
    const test = fixture({
      storage: {
        list: (cursor) =>
          Effect.suspend(() => {
            cursors.push(cursor);
            if (cursor && !available) return Effect.fail(unavailable);
            return Effect.succeed(
              cursor
                ? { assets: [{ wallpaperId: 'orphan-two', extension: 'png' }] }
                : {
                    assets: [{ wallpaperId: 'orphan-one', extension: 'png' }],
                    cursor: 'next',
                  }
            );
          }),
      },
    });
    test.objects.push(
      { wallpaperId: 'orphan-one', extension: 'png' },
      { wallpaperId: 'orphan-two', extension: 'png' }
    );
    await Effect.runPromise(
      Ingestion.use((ingestion) =>
        Effect.gen(function* () {
          expect(yield* ingestion.cleanup().pipe(Effect.flip)).toBe(unavailable);
          expect(test.objects).toEqual([{ wallpaperId: 'orphan-two', extension: 'png' }]);
          available = true;
          yield* ingestion.cleanup();
          expect(test.objects).toEqual([]);
          expect(cursors).toEqual([undefined, 'next', 'next']);
        })
      ).pipe(Effect.provide(test.layer))
    );
  });
  it('propagates cleanup interruption without treating the asset as an isolated failure', async () => {
    const test = fixture({ storage: { remove: () => Effect.interrupt } });
    test.objects.push({ wallpaperId: 'orphan', extension: 'png' });
    const exit = await Effect.runPromiseExit(
      Ingestion.use((ingestion) => ingestion.cleanup()).pipe(Effect.provide(test.layer))
    );
    expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true);
    expect(test.objects).toEqual([{ wallpaperId: 'orphan', extension: 'png' }]);
  });
  it('rejects an absent authenticated owner before inspecting or reserving the upload', async () => {
    const test = fixture();
    const result = await Effect.runPromise(
      Ingestion.use((ingestion) =>
        ingestion.upload({ ...uploadInput, principal: { profileId: '' } })
      ).pipe(Effect.provide(test.layer))
    );
    expect(result).toEqual({ _tag: 'Unauthorized' });
    expect(test.store.records.size).toBe(0);
  });
  it('bounds missing-object recovery and never publishes an upload whose object is absent', async () => {
    const test = fixture({
      storage: {
        put: () => Effect.fail(new IngestionUnavailable({ operation: 'put', cause: 'offline' })),
      },
    });
    await Effect.runPromise(
      Ingestion.use((ingestion) =>
        Effect.gen(function* () {
          yield* ingestion.upload(uploadInput).pipe(Effect.ignore);
          yield* test.advance();
          yield* ingestion.reconcile();
          yield* test.advance();
          yield* ingestion.reconcile();
          yield* test.advance();
          yield* ingestion.reconcile();
        })
      ).pipe(Effect.provide(test.layer))
    );
    expect([...test.store.records.values()][0]?.state).toBe('failed');
    expect(test.published).toEqual([]);
  });
  it('retains a committed outbox occurrence when publication fails and replays that same occurrence', async () => {
    let available = false;
    const attempts: string[] = [];
    const test = fixture({
      events: {
        publish: (event) =>
          Effect.gen(function* () {
            attempts.push(event.id);
            if (!available)
              return yield* new IngestionUnavailable({ operation: 'publish', cause: 'offline' });
          }),
      },
    });
    await Effect.runPromise(
      Ingestion.use((ingestion) =>
        Effect.gen(function* () {
          const result = yield* ingestion.upload(uploadInput);
          expect(result._tag).toBe('Accepted');
          expect(test.store.outbox.size).toBe(1);
          available = true;
          yield* test.advance();
          yield* ingestion.reconcile();
        })
      ).pipe(Effect.provide(test.layer))
    );
    expect(attempts).toHaveLength(2);
    expect(new Set(attempts).size).toBe(1);
    expect(test.store.outbox.size).toBe(0);
  });
  it('reuses an owner’s committed content without storing or publishing it twice', async () => {
    const test = fixture();
    const results = await Effect.runPromise(
      Ingestion.use((ingestion) =>
        Effect.all([ingestion.upload(uploadInput), ingestion.upload(uploadInput)])
      ).pipe(Effect.provide(test.layer))
    );
    expect(results.map((result) => result._tag)).toEqual(['Accepted', 'Duplicate']);
    expect(test.objects).toHaveLength(1);
    expect(test.published).toHaveLength(1);
  });
  it('durably accepts an inspected wallpaper and publishes its committed snapshot', async () => {
    const test = fixture();
    const result = await Effect.runPromise(
      Ingestion.use((ingestion) => ingestion.upload(uploadInput)).pipe(Effect.provide(test.layer))
    );
    expect(result._tag).toBe('Accepted');
    if (result._tag !== 'Accepted') throw new Error('Expected accepted upload');
    expect(test.objects).toEqual([{ wallpaperId: result.upload.id, extension: 'png' }]);
    expect(test.published).toHaveLength(1);
    expect(test.published[0]?.wallpaper).toMatchObject({
      id: result.upload.id,
      profileId: 'profile-1',
      originalFilename: '.._wallpaper.png',
    });
    expect(test.store.records.get(result.upload.id)?.state).toBe('processing');
    expect(test.store.outbox.size).toBe(0);
  });
});
