import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';
import {
  ColorEvents,
  ExtractColors,
  ExtractionUnavailable,
  ImageHistogram,
  extractionLayer,
  type ExtractionInput,
} from '../src/extraction/index.js';

const input: ExtractionInput = {
  wallpaperId: 'wallpaper-1',
  fileType: 'image',
  storage: { bucket: 'wallpapers', key: 'wallpaper-1/original.png' },
  occurrence: { source: 'wallpaperdb/ingestor', id: 'upload-1' },
  timestamp: '2026-09-24T00:00:00.000Z',
};
describe('color extraction', () => {
  it('reads the original and publishes its exact histogram before reporting completion', async () => {
    const histogram = [0.1, 0.9];
    const reads: unknown[] = [];
    const publications: unknown[] = [];
    const layer = extractionLayer.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(ImageHistogram, {
            extract: (storage) =>
              Effect.sync(() => {
                reads.push(storage);
                return histogram;
              }),
          }),
          Layer.succeed(ColorEvents, {
            publish: (result) =>
              Effect.sync(() => {
                publications.push(result);
              }),
          })
        )
      )
    );
    const outcome = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* (yield* ExtractColors).extract(input);
      }).pipe(Effect.provide(layer))
    );
    expect(outcome).toEqual({ _tag: 'Extracted' });
    expect(reads).toEqual([input.storage]);
    expect(publications).toEqual([{ input, histogram, colorSpace: 'hsv' }]);
  });
});

it('skips videos without reading or publishing', async () => {
  const layer = extractionLayer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(ImageHistogram, { extract: () => Effect.die('must not read video') }),
        Layer.succeed(ColorEvents, { publish: () => Effect.die('must not publish video') })
      )
    )
  );
  const outcome = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* (yield* ExtractColors).extract({ ...input, fileType: 'video' });
    }).pipe(Effect.provide(layer))
  );
  expect(outcome).toEqual({ _tag: 'Skipped' });
});
it('preserves the typed extraction failure and does not publish', async () => {
  const failure = new ExtractionUnavailable({
    operation: 'read',
    cause: new Error('storage unavailable'),
  });
  const layer = extractionLayer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(ImageHistogram, { extract: () => Effect.fail(failure) }),
        Layer.succeed(ColorEvents, {
          publish: () => Effect.die('must not publish failed extraction'),
        })
      )
    )
  );
  const outcome = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* (yield* ExtractColors).extract(input);
    }).pipe(Effect.flip, Effect.provide(layer))
  );
  expect(outcome).toBe(failure);
});
it('reports publication failure instead of completion', async () => {
  const failure = new ExtractionUnavailable({
    operation: 'publish',
    cause: new Error('broker unavailable'),
  });
  const layer = extractionLayer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(ImageHistogram, { extract: () => Effect.succeed([1]) }),
        Layer.succeed(ColorEvents, { publish: () => Effect.fail(failure) })
      )
    )
  );
  const outcome = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* (yield* ExtractColors).extract(input);
    }).pipe(Effect.flip, Effect.provide(layer))
  );
  expect(outcome).toBe(failure);
});
