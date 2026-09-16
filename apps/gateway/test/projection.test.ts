import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';
import {
  ProjectCatalogue,
  projectionLayer,
  ProjectionStore,
  ProjectionUnavailable,
  type ProjectionMutation,
  type ProjectionWrite,
} from '../src/projection/index.js';

class ControlledProjection implements ProjectionStore {
  readonly changes: ProjectionMutation[] = [];
  constructor(
    private readonly result: ProjectionWrite | ProjectionUnavailable = { _tag: 'Applied' }
  ) {}
  apply = Effect.fn('test.projection.apply')(function* (
    this: ControlledProjection,
    change: ProjectionMutation
  ) {
    if (this.result._tag === 'ProjectionUnavailable') return yield* this.result;
    this.changes.push(change);
    return this.result;
  });
}
function layer(store: ProjectionStore) {
  return projectionLayer.pipe(Layer.provide(Layer.succeed(ProjectionStore, store)));
}
const occurrence = {
  source: 'wallpaperdb/color-extractor',
  id: 'colors-1',
  occurredAt: '2026-01-01T00:00:00.000Z',
};

describe('Catalogue projection', () => {
  it.each(
    [
      [],
      [1],
      Array(64).fill(0),
      [-1, ...Array(63).fill(1)],
      [Number.NaN, ...Array(63).fill(1)],
      [Number.POSITIVE_INFINITY, ...Array(63).fill(1)],
    ].map((colorHistogram) => ({ colorHistogram }))
  )('rejects a histogram that cannot represent catalogue color similarity', async ({
    colorHistogram,
  }) => {
    const store = new ControlledProjection();
    const outcome = await Effect.runPromise(
      ProjectCatalogue.use((projection) =>
        projection.record({
          _tag: 'ColorsExtracted',
          occurrence,
          wallpaperId: 'wallpaper',
          colorHistogram,
          colorSpace: 'hsv',
        })
      ).pipe(Effect.provide(layer(store)))
    );
    expect(outcome).toEqual({ _tag: 'Rejected', reason: 'invalid-color-histogram' });
    expect(store.changes).toEqual([]);
  });
  it('preserves occurrence identity and creates a deterministic upload snapshot', async () => {
    const store = new ControlledProjection();
    const outcome = await Effect.runPromise(
      ProjectCatalogue.use((projection) =>
        projection.record({
          _tag: 'WallpaperUploaded',
          occurrence,
          wallpaperId: 'wallpaper',
          profileId: 'profile',
          uploadedAt: occurrence.occurredAt,
        })
      ).pipe(Effect.provide(layer(store)))
    );
    expect(outcome).toEqual({ _tag: 'Completed' });
    expect(store.changes).toEqual([
      {
        _tag: 'PublishWallpaper',
        occurrence,
        wallpaperId: 'wallpaper',
        profileId: 'profile',
        uploadedAt: occurrence.occurredAt,
      },
    ]);
  });
  it('propagates typed persistence unavailability', async () => {
    const unavailable = new ProjectionUnavailable({ cause: 'controlled outage' });
    const outcome = await Effect.runPromise(
      ProjectCatalogue.use((projection) =>
        projection.record({
          _tag: 'ColorsExtracted',
          occurrence,
          wallpaperId: 'wallpaper',
          colorHistogram: Array(64).fill(1),
          colorSpace: 'hsv',
        })
      ).pipe(Effect.flip, Effect.provide(layer(new ControlledProjection(unavailable))))
    );
    expect(outcome).toBe(unavailable);
  });
  it.each([
    { write: { _tag: 'Unchanged' }, outcome: { _tag: 'Ignored' } },
    { write: { _tag: 'Rejected' }, outcome: { _tag: 'Rejected', reason: 'invalid-projection' } },
  ] satisfies Array<{
    write: ProjectionWrite;
    outcome: object;
  }>)('translates persistence result $write._tag', async ({ write, outcome }) => {
    expect(
      await Effect.runPromise(
        ProjectCatalogue.use((projection) =>
          projection.record({
            _tag: 'WallpaperUploaded',
            occurrence,
            wallpaperId: 'wallpaper',
            profileId: 'profile',
            uploadedAt: occurrence.occurredAt,
          })
        ).pipe(Effect.provide(layer(new ControlledProjection(write))))
      )
    ).toEqual(outcome);
  });
  it('publishes variant and profile snapshots through the transactional port', async () => {
    const store = new ControlledProjection();
    const variant = {
      width: 1920,
      height: 1080,
      aspectRatio: 1920 / 1080,
      format: 'webp',
      fileSizeBytes: 100,
      createdAt: occurrence.occurredAt,
    };
    const profile = {
      id: 'profile',
      handle: 'artist',
      displayName: 'Artist',
      biographyMarkdown: '',
      pictureAssetId: null,
      version: 1,
      claimGeneration: 1,
      createdAt: occurrence.occurredAt,
      updatedAt: occurrence.occurredAt,
    };
    await Effect.runPromise(
      Effect.gen(function* () {
        const projection = yield* ProjectCatalogue;
        expect(
          yield* projection.record({
            _tag: 'VariantAvailable',
            occurrence,
            wallpaperId: 'wallpaper',
            variant,
          })
        ).toEqual({ _tag: 'Completed' });
        expect(yield* projection.record({ _tag: 'ProfilePublished', occurrence, profile })).toEqual(
          { _tag: 'Completed' }
        );
      }).pipe(Effect.provide(layer(store)))
    );
    expect(store.changes).toEqual([
      { _tag: 'PublishVariant', occurrence, wallpaperId: 'wallpaper', variant },
      { _tag: 'PublishProfile', occurrence, profile },
    ]);
  });
});
