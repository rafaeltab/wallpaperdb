import { Deferred, Effect, Fiber, Layer } from 'effect';
import { describe, expect, it } from 'vitest';
import {
  GenerateVariants,
  GenerationUnavailable,
  VariantEvents,
  VariantImages,
  generationLayer,
  getApplicablePresets,
  matchAspectRatioCategory,
  type GeneratedVariant,
  type GenerationInput,
  type ResolutionPreset,
} from '../src/generation/index.js';

const input: GenerationInput = {
  wallpaperId: 'wallpaper-1',
  fileType: 'image',
  mimeType: 'image/png',
  width: 1920,
  height: 1080,
  storage: { bucket: 'wallpapers', key: 'wallpaper-1/original.png' },
  occurrence: { source: 'wallpaperdb/ingestor', id: 'upload-1' },
  timestamp: '2026-09-24T00:00:00.000Z',
  correlationId: 'workflow-1',
};

function controlledAdapters(
  failGeneration?: number,
  failPublication?: number,
  publicationGate: Effect.Effect<void> = Effect.void
) {
  const generated: GeneratedVariant[] = [];
  const attempts: ResolutionPreset[] = [];
  const publications: { input: GenerationInput; variant: GeneratedVariant }[] = [];
  const failure = new GenerationUnavailable({ operation: 'controlled', cause: new Error('unavailable') });
  const layer = generationLayer.pipe(Layer.provide(Layer.mergeAll(
    Layer.succeed(VariantImages, {
      generate: (original, preset) => Effect.gen(function* () {
        attempts.push(preset);
        if (preset.width === failGeneration) return yield* Effect.fail(failure);
        const variant: GeneratedVariant = {
          wallpaperId: original.wallpaperId,
          width: preset.width,
          height: preset.height,
          aspectRatio: preset.width / preset.height,
          format: 'image/png',
          fileSizeBytes: 100,
          storageKey: `${original.wallpaperId}/variant_${preset.width}x${preset.height}.png`,
          storageBucket: 'wallpapers',
          createdAt: new Date(original.timestamp),
        };
        generated.push(variant);
        return variant;
      }),
    }),
    Layer.succeed(VariantEvents, {
      publish: (publication) => Effect.gen(function* () {
        publications.push(publication);
        yield* publicationGate;
        if (publication.variant.width === failPublication) return yield* Effect.fail(failure);
      }),
    }),
  )));
  const generate = (original = input) => Effect.gen(function* () {
    return yield* (yield* GenerateVariants).generate(original);
  }).pipe(Effect.provide(layer));
  return { generated, attempts, publications, failure, generate };
}

describe('variant generation', () => {
  it('publishes every generated preset and preserves metadata and occurrence context', async () => {
    const adapters = controlledAdapters();
    const outcome = await Effect.runPromise(adapters.generate());
    expect(outcome).toEqual({ _tag: 'Generated', variants: adapters.generated });
    expect(adapters.attempts.map((preset) => preset.width)).toEqual([1600, 1280, 854, 640]);
    expect(adapters.publications).toEqual(adapters.generated.map((variant) => ({ input, variant })));
  });

  it.each([
    { original: { ...input, fileType: 'video' as const }, reason: 'not_image' },
    { original: { ...input, width: 1000, height: 1000 }, reason: 'no_presets' },
    { original: { ...input, width: 640, height: 360 }, reason: 'no_presets' },
  ])('skips without external effects: $reason', async ({ original, reason }) => {
    const adapters = controlledAdapters();
    expect(await Effect.runPromise(adapters.generate(original))).toEqual({ _tag: 'Skipped', reason });
    expect(adapters.attempts).toEqual([]);
    expect(adapters.publications).toEqual([]);
  });

  it('continues after an image failure but fails the batch for retry', async () => {
    const adapters = controlledAdapters(1280);
    expect(await Effect.runPromise(adapters.generate().pipe(Effect.flip))).toBe(adapters.failure);
    expect(adapters.attempts.map((preset) => preset.width)).toEqual([1600, 1280, 854, 640]);
    expect(adapters.publications.map(({ variant }) => variant.width)).toEqual([1600, 854, 640]);
  });

  it('continues after a publication failure but never reports batch completion', async () => {
    const adapters = controlledAdapters(undefined, 1600);
    expect(await Effect.runPromise(adapters.generate().pipe(Effect.flip))).toBe(adapters.failure);
    expect(adapters.publications.map(({ variant }) => variant.width)).toEqual([1600, 1280, 854, 640]);
  });

  it('waits for publication before starting the next image', async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const adapters = controlledAdapters(undefined, undefined,
        Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(release))));
      const fiber = yield* adapters.generate().pipe(Effect.forkScoped);
      yield* Deferred.await(started);
      expect(adapters.attempts.map((preset) => preset.width)).toEqual([1600]);
      yield* Deferred.succeed(release, undefined);
      const outcome = yield* Fiber.join(fiber);
      expect(outcome._tag).toBe('Generated');
      expect(adapters.attempts).toHaveLength(4);
    }).pipe(Effect.scoped));
  });

  it('interrupts in-flight publication and does not start further variants', async () => {
    let released = false;
    await Effect.runPromise(Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const adapters = controlledAdapters(undefined, undefined,
        Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Effect.never),
          Effect.ensuring(Effect.sync(() => { released = true; }))
        ));
      const fiber = yield* adapters.generate().pipe(Effect.forkScoped);
      yield* Deferred.await(started);
      yield* Fiber.interrupt(fiber);
      expect(adapters.attempts.map((preset) => preset.width)).toEqual([1600]);
      expect(released).toBe(true);
    }).pipe(Effect.scoped));
  });

  it('keeps unexpected defects out of the technical failure channel', async () => {
    const defect = new Error('programmer error');
    const layer = generationLayer.pipe(Layer.provide(Layer.mergeAll(
      Layer.succeed(VariantImages, { generate: () => Effect.die(defect) }),
      Layer.succeed(VariantEvents, { publish: () => Effect.die('must not publish') }),
    )));
    const effect = Effect.gen(function* () { return yield* (yield* GenerateVariants).generate(input); });
    await expect(Effect.runPromise(effect.pipe(Effect.provide(layer)))).rejects.toThrow('programmer error');
  });
});

describe('resolution policy', () => {
  it.each([
    [3840, 2160, 'standard'], [1920, 1200, 'standard'],
    [3440, 1440, 'ultrawide'], [1080, 1920, 'phone'], [1080, 2340, 'phone'],
    [1000, 1000, null],
  ])('matches %i x %i to %s', (width, height, category) => {
    expect(matchAspectRatioCategory(width, height)).toBe(category);
  });

  it.each([
    {
      width: 7680, height: 4320,
      dimensions: [[3840, 2160], [2560, 1440], [1920, 1080], [1600, 900], [1280, 720], [854, 480], [640, 360]],
    },
    { width: 6880, height: 2880, dimensions: [[5120, 2160], [3440, 1440], [2560, 1080]] },
    { width: 2160, height: 4800, dimensions: [[1440, 3200], [1080, 2400], [1080, 1920], [720, 1280], [480, 854]] },
    { width: 3840, height: 2160, dimensions: [[2560, 1440], [1920, 1080], [1600, 900], [1280, 720], [854, 480], [640, 360]] },
    { width: 1920, height: 1080, dimensions: [[1600, 900], [1280, 720], [854, 480], [640, 360]] },
    { width: 640, height: 360, dimensions: [] },
    { width: 3440, height: 1440, dimensions: [[2560, 1080]] },
    { width: 1080, height: 2400, dimensions: [[720, 1280], [480, 854]] },
    { width: 2000, height: 2000, dimensions: [] },
  ])('preserves ordered preset dimensions for $width x $height', ({ width, height, dimensions }) => {
    expect(getApplicablePresets(width, height).map((preset) => [preset.width, preset.height])).toEqual(dimensions);
  });
});
