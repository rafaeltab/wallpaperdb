import { Effect, Layer, Metric } from 'effect';
import { describe, expect, it } from 'vitest';
import {
  AssetReader,
  Catalog,
  DeliveryUnavailable,
  ImageTransformer,
  MediaDelivery,
  PictureAuthority,
  deliveryLayer,
  type ResizeOptions,
  type Wallpaper,
} from '../src/capabilities/delivery/index.js';

const original: Wallpaper = {
  id: 'wall_1',
  storageBucket: 'media',
  storageKey: 'original',
  mimeType: 'image/png',
  fileSizeBytes: 3,
  width: 1920,
  height: 1080,
};
function fixture(
  overrides: {
    maxPictureBytes?: number;
    maxOutputPixels?: number;
    authorityFailure?: boolean;
    readFailure?: boolean;
    catalogFailure?: boolean;
    wallpaper?: Wallpaper;
    maxResizeWidth?: number;
    maxResizeHeight?: number;
    displayedGeometry?: { width: number; height: number; requiresOrientation: boolean };
    variantGeometry?: { width: number; height: number; requiresOrientation: boolean };
  } = {}
) {
  const reads: string[] = [];
  const queries: number[][] = [];
  const wallpaperLookups: string[] = [];
  const resizes: ResizeOptions[] = [];
  const sources = new WeakMap<object, string>();
  let allowed = true;
  let missingVariant = false;
  let missingOriginal = false;
  const dependencies = Layer.mergeAll(
    Layer.succeed(Catalog, {
      findWallpaper: (id) => {
        wallpaperLookups.push(id);
        return overrides.catalogFailure
          ? Effect.fail(
              new DeliveryUnavailable({ operation: 'catalog', cause: new Error('offline') })
            )
          : Effect.succeed(overrides.wallpaper ?? original);
      },
      findSmallestVariant: (_id, w, h) => {
        queries.push([w, h]);
        return Effect.succeed(
          w <= 960 && h <= 1080
            ? {
                id: 'variant',
                storageBucket: 'media',
                storageKey: 'variant',
                width: 960,
                height: 1080,
              }
            : null
        );
      },
      findCurrentPicture: () => Effect.succeed(original),
    }),
    Layer.succeed(AssetReader, {
      read: (asset) => {
        reads.push(asset.storageKey);
        if (overrides.readFailure)
          return Effect.fail(
            new DeliveryUnavailable({ operation: 'storage', cause: new Error('offline') })
          );
        if (missingOriginal && asset.storageKey === 'original') return Effect.succeed(null);
        if (missingVariant && asset.storageKey === 'variant') return Effect.succeed(null);
        const stream = Object.assign(
          (async function* () {
            yield new Uint8Array([1, 2, 3]);
          })(),
          { close() {} }
        );
        sources.set(stream, asset.storageKey);
        return Effect.succeed(stream);
      },
    }),
    Layer.succeed(PictureAuthority, {
      isAvailable: () =>
        overrides.authorityFailure
          ? Effect.fail(
              new DeliveryUnavailable({ operation: 'authority', cause: new Error('offline') })
            )
          : Effect.succeed(allowed),
    }),
    Layer.succeed(ImageTransformer, {
      inspect: (body) =>
        Effect.sync(() => {
          body.close();
          return sources.get(body) === 'variant'
            ? (overrides.variantGeometry ?? {
                width: 960,
                height: 1080,
                requiresOrientation: false,
              })
            : (overrides.displayedGeometry ?? {
                width: (overrides.wallpaper ?? original).width,
                height: (overrides.wallpaper ?? original).height,
                requiresOrientation: false,
              });
        }),
      resize: (body, options) => {
        resizes.push(options);
        return Effect.succeed(body);
      },
    })
  );
  return {
    reads,
    queries,
    wallpaperLookups,
    resizes,
    loseOriginal: () => {
      missingOriginal = true;
    },
    loseVariant: () => {
      missingVariant = true;
    },
    deny: () => {
      allowed = false;
    },
    run: <A, E>(effect: Effect.Effect<A, E, MediaDelivery>) =>
      Effect.runPromise(
        effect.pipe(
          Effect.provide(
            deliveryLayer({
              maxResizeWidth: overrides.maxResizeWidth ?? 16384,
              maxResizeHeight: overrides.maxResizeHeight ?? 16384,
              maxOutputPixels: overrides.maxOutputPixels ?? 268435456,
              maxPictureBytes: overrides.maxPictureBytes,
            }).pipe(Layer.provide(dependencies))
          )
        )
      ),
  };
}
describe('media delivery', () => {
  it('rejects a width-only resize whose displayed height exceeds the cap', async () => {
    const f = fixture({
      wallpaper: { ...original, width: 120, height: 80 },
      displayedGeometry: { width: 80, height: 120, requiresOrientation: true },
      maxResizeHeight: 50,
    });
    expect(
      await f.run(MediaDelivery.use((d) => d.wallpaper('wall_1', { width: 40, fit: 'contain' })))
    ).toMatchObject({ _tag: 'Rejected' });
    expect(f.resizes).toEqual([]);
    expect(f.queries).toEqual([]);
  });
  it('retains exact variant delivery when its original object is missing', async () => {
    const f = fixture();
    f.loseOriginal();
    expect(
      await f.run(
        MediaDelivery.use((d) =>
          d.wallpaper('wall_1', { width: 960, height: 1080, fit: 'contain' })
        )
      )
    ).toMatchObject({ _tag: 'Found' });
    expect(f.reads).toEqual(['original', 'variant', 'variant']);
    expect(f.resizes).toEqual([]);
  });
  it('rejects an explicit output pixel budget before variant inspection when its original is absent', async () => {
    const f = fixture({ maxOutputPixels: 10 });
    f.loseOriginal();
    expect(
      await f.run(
        MediaDelivery.use((d) => d.wallpaper('wall_1', { width: 20, height: 20, fit: 'contain' }))
      )
    ).toMatchObject({ _tag: 'Rejected' });
    expect(f.queries).toEqual([]);
    expect(f.resizes).toEqual([]);
  });
  it('transforms an orientation-bearing retained variant even at its exact displayed size', async () => {
    const f = fixture({ variantGeometry: { width: 80, height: 120, requiresOrientation: true } });
    f.loseOriginal();
    expect(
      await f.run(
        MediaDelivery.use((d) => d.wallpaper('wall_1', { width: 80, height: 120, fit: 'contain' }))
      )
    ).toMatchObject({ _tag: 'Found' });
    expect(f.resizes).toEqual([{ width: 80, height: 120, fit: 'contain', mimeType: 'image/png' }]);
  });
  it.each([
    {
      name: 'reject unknown-original output beyond its actual width cap',
      cap: 25,
      outcome: 'Rejected',
    },
    {
      name: 'accept a valid output without inferring from the missing original catalog dimensions',
      cap: 30,
      outcome: 'Found',
    },
  ])('$name', async ({ cap, outcome }) => {
    const f = fixture({
      variantGeometry: { width: 80, height: 120, requiresOrientation: true },
      maxResizeWidth: cap,
    });
    f.loseOriginal();
    expect(
      await f.run(MediaDelivery.use((d) => d.wallpaper('wall_1', { height: 40, fit: 'contain' })))
    ).toMatchObject({ _tag: outcome });
    expect(f.queries).toEqual([[1, 40]]);
    expect(f.resizes).toEqual(
      outcome === 'Found' ? [{ height: 40, fit: 'contain', mimeType: 'image/png' }] : []
    );
  });
  it.each([
    {
      name: 'inferred width',
      raw: [120, 80],
      displayed: [80, 120],
      options: { height: 40 },
      limits: { maxResizeWidth: 25 },
    },
    {
      name: 'inferred pixels',
      raw: [120, 80],
      displayed: [80, 120],
      options: { width: 40 },
      limits: { maxOutputPixels: 2399 },
    },
    {
      name: 'landscape inferred width',
      raw: [80, 120],
      displayed: [120, 80],
      options: { height: 40 },
      limits: { maxResizeWidth: 50 },
    },
    {
      name: 'default height cap',
      raw: [7680, 5120],
      displayed: [5120, 7680],
      options: { width: 4000 },
      limits: { maxResizeWidth: 7680, maxResizeHeight: 4320, maxOutputPixels: 33177600 },
    },
  ])('rejects output beyond $name using inspected dimensions', async ({
    raw,
    displayed,
    options,
    limits,
  }) => {
    const f = fixture({
      wallpaper: { ...original, width: raw[0]!, height: raw[1]! },
      displayedGeometry: { width: displayed[0]!, height: displayed[1]!, requiresOrientation: true },
      ...limits,
    });
    expect(
      await f.run(MediaDelivery.use((d) => d.wallpaper('wall_1', { ...options, fit: 'contain' })))
    ).toMatchObject({ _tag: 'Rejected' });
    expect(f.reads).toEqual(['original']);
    expect(f.resizes).toEqual([]);
    expect(f.queries).toEqual([]);
  });
  it('accepts a height-only resize that raw dimensions would falsely reject', async () => {
    const f = fixture({
      wallpaper: { ...original, width: 120, height: 80 },
      displayedGeometry: { width: 80, height: 120, requiresOrientation: true },
      maxResizeWidth: 30,
      maxResizeHeight: 50,
      maxOutputPixels: 1080,
    });
    expect(
      await f.run(MediaDelivery.use((d) => d.wallpaper('wall_1', { height: 40, fit: 'contain' })))
    ).toMatchObject({ _tag: 'Found' });
    expect(f.resizes).toEqual([{ height: 40, fit: 'contain', mimeType: 'image/png' }]);
  });
  it('matches original delivery using displayed dimensions and preserves its oversized-source exemption', async () => {
    const f = fixture({
      wallpaper: { ...original, width: 120, height: 80 },
      displayedGeometry: { width: 80, height: 120, requiresOrientation: true },
      maxResizeWidth: 50,
      maxResizeHeight: 50,
    });
    expect(
      await f.run(
        MediaDelivery.use((d) => d.wallpaper('wall_1', { width: 80, height: 120, fit: 'contain' }))
      )
    ).toMatchObject({ _tag: 'Found', fileSizeBytes: 3 });
    expect(
      await f.run(
        MediaDelivery.use((d) => d.wallpaper('wall_1', { width: 120, height: 80, fit: 'contain' }))
      )
    ).toMatchObject({ _tag: 'Rejected' });
    expect(f.resizes).toEqual([]);
    expect(f.queries).toEqual([]);
  });
  it.each([
    { width: 1920, height: 1080, requiresOrientation: true },
    { width: 1080, height: 1920, requiresOrientation: true },
  ])('avoids historical variants with unproven orientation for %j', async (displayedGeometry) => {
    const f = fixture({ displayedGeometry });
    expect(
      await f.run(MediaDelivery.use((d) => d.wallpaper('wall_1', { width: 500, fit: 'contain' })))
    ).toMatchObject({ _tag: 'Found' });
    expect(f.queries).toEqual([]);
    expect(f.reads).toEqual(['original', 'original']);
    expect(f.resizes).toHaveLength(1);
  });
  it.each([
    { width: 40, height: 120, requiresOrientation: false },
    { width: 80, height: 120, requiresOrientation: true },
  ])('falls back to the inspected original when a nominal variant is unsafe: %j', async (variantGeometry) => {
    const f = fixture({
      wallpaper: { ...original, width: 120, height: 80 },
      variantGeometry,
      maxResizeHeight: 100,
    });
    expect(
      await f.run(MediaDelivery.use((d) => d.wallpaper('wall_1', { width: 40, fit: 'contain' })))
    ).toMatchObject({ _tag: 'Found' });
    expect(f.queries).toEqual([[40, 80]]);
    expect(f.reads).toEqual(['original', 'variant', 'original']);
    expect(f.resizes).toEqual([{ width: 40, fit: 'contain', mimeType: 'image/png' }]);
  });
  it('compares actual variant dimensions instead of treating nominal bounds as an exact match', async () => {
    const f = fixture({ variantGeometry: { width: 800, height: 900, requiresOrientation: false } });
    expect(
      await f.run(
        MediaDelivery.use((d) =>
          d.wallpaper('wall_1', { width: 960, height: 1080, fit: 'contain' })
        )
      )
    ).toMatchObject({ _tag: 'Found' });
    expect(f.reads).toEqual(['original', 'variant', 'variant']);
    expect(f.resizes).toEqual([
      { width: 960, height: 1080, fit: 'contain', mimeType: 'image/png' },
    ]);
  });
  it.each([
    { width: 7681 },
    { height: 4321 },
  ])('rejects oversized one-dimensional requests without consulting an unavailable catalog: %j', async (options) => {
    const f = fixture({ catalogFailure: true, maxResizeWidth: 7680, maxResizeHeight: 4320 });
    expect(
      await f.run(
        Effect.flatMap(MediaDelivery, (d) => d.wallpaper('wall_1', { ...options, fit: 'contain' }))
      )
    ).toEqual({ _tag: 'Rejected', reason: 'Requested dimensions exceed media limits' });
    expect(f.wallpaperLookups).toEqual([]);
    expect(f.reads).toEqual([]);
  });
  it('counts exact-original delivery as no resize rather than a variant miss', async () => {
    const f = fixture();
    const snapshots = await f.run(
      Effect.gen(function* () {
        const delivery = yield* MediaDelivery;
        const outcome = yield* delivery.wallpaper('wall_1', {
          width: original.width,
          height: original.height,
          fit: 'contain',
        });
        expect(outcome._tag).toBe('Found');
        return yield* Metric.snapshot;
      }).pipe(Effect.provideService(Metric.MetricRegistry, new Map()))
    );
    expect(
      snapshots.filter((metric) => metric.id === 'media.variant_selection.total')
    ).toMatchObject([
      { type: 'Counter', attributes: { result: 'no_resize' }, state: { count: 1 } },
    ]);
    expect(f.queries).toEqual([]);
  });
  it.each([
    { width: 3000, height: 6000 },
    { width: 12000, height: 2000 },
    { width: 8000, height: 8000 },
  ])('streams a $width×$height original at its source dimensions above resize limits', async ({
    width,
    height,
  }) => {
    const f = fixture({
      wallpaper: { ...original, width, height },
      maxResizeWidth: 7680,
      maxResizeHeight: 4320,
      maxOutputPixels: 33177600,
    });
    for (const fit of ['contain', 'cover', 'fill'] as const) {
      const outcome = await f.run(
        Effect.flatMap(MediaDelivery, (d) => d.wallpaper('wall_1', { width, height, fit }))
      );
      expect(outcome).toMatchObject({ _tag: 'Found', mimeType: 'image/png', fileSizeBytes: 3 });
      if (outcome._tag !== 'Found') throw new Error('expected original');
      const chunks = [];
      for await (const chunk of outcome.body) chunks.push(...chunk);
      expect(chunks).toEqual([1, 2, 3]);
    }
    expect(f.reads).toEqual([
      'original',
      'original',
      'original',
      'original',
      'original',
      'original',
    ]);
    expect(f.resizes).toEqual([]);
    expect(f.queries).toEqual([]);
  });
  it.each([
    { width: 3000, height: 5999, inspected: true },
    { width: 3000, height: 6001, inspected: true },
    { height: 6000, inspected: false },
    { width: 3000, inspected: true },
    { width: 0, height: 6000, inspected: false },
    { width: 3000.5, height: 6000, inspected: false },
    { width: Number.NaN, height: 6000, inspected: false },
    { width: Number.MAX_SAFE_INTEGER + 1, height: 6000, inspected: false },
  ])('keeps rejecting invalid or oversized transformations of a large original: %j', async ({
    inspected,
    ...options
  }) => {
    const f = fixture({
      wallpaper: { ...original, width: 3000, height: 6000 },
      maxResizeWidth: 7680,
      maxResizeHeight: 4320,
    });
    expect(
      await f.run(
        Effect.flatMap(MediaDelivery, (d) => d.wallpaper('wall_1', { ...options, fit: 'contain' }))
      )
    ).toMatchObject({ _tag: 'Rejected' });
    expect(f.reads).toEqual(inspected ? ['original'] : []);
    expect(f.resizes).toEqual([]);
  });
  it.each([
    'contain',
    'cover',
    'fill',
  ] as const)('streams matching originals and variants without encoding for %s', async (fit) => {
    for (const width of [1920, 960]) {
      const f = fixture();
      const outcome = await f.run(
        Effect.flatMap(MediaDelivery, (d) => d.wallpaper('wall_1', { width, height: 1080, fit }))
      );
      expect(outcome).toMatchObject({ _tag: 'Found', mimeType: 'image/png' });
      expect(f.reads).toEqual(
        width === 1920 ? ['original', 'original'] : ['original', 'variant', 'variant']
      );
      expect(f.resizes).toEqual([]);
      if (outcome._tag !== 'Found') throw new Error('expected image');
      expect(outcome.fileSizeBytes).toBe(width === 1920 ? original.fileSizeBytes : undefined);
      const chunks = [];
      for await (const chunk of outcome.body) chunks.push(...chunk);
      expect(chunks).toEqual([1, 2, 3]);
    }
  });
  it('still resizes the original when an exact-size variant is missing', async () => {
    const f = fixture();
    f.loseVariant();
    await f.run(
      Effect.flatMap(MediaDelivery, (d) =>
        d.wallpaper('wall_1', { width: 960, height: 1080, fit: 'contain' })
      )
    );
    expect(f.reads).toEqual(['original', 'variant', 'original']);
    expect(f.resizes).toMatchObject([{ width: 960, height: 1080, fit: 'contain' }]);
  });
  it('fails closed when authority is unavailable without reading storage', async () => {
    const f = fixture({ authorityFailure: true });
    await expect(
      f.run(Effect.flatMap(MediaDelivery, (d) => d.picture('pic_1')))
    ).rejects.toMatchObject({ operation: 'authority' });
    expect(f.reads).toEqual([]);
  });
  it('does not mask a storage outage as absence or attempt a second object', async () => {
    const f = fixture({ readFailure: true });
    await expect(
      f.run(
        Effect.flatMap(MediaDelivery, (d) =>
          d.wallpaper('wall_1', { width: 500, height: 300, fit: 'cover' })
        )
      )
    ).rejects.toMatchObject({ operation: 'storage' });
    expect(f.reads).toEqual(['original']);
  });
  it('rejects oversized full picture reads before making them cacheable', async () => {
    const f = fixture({ maxPictureBytes: 2 });
    await expect(
      f.run(Effect.flatMap(MediaDelivery, (d) => d.picture('pic_1')))
    ).rejects.toMatchObject({ operation: 'read_picture' });
  });
  it('bounds inferred one-dimensional output pixel counts', async () => {
    const f = fixture({ maxOutputPixels: 100000 });
    expect(
      await f.run(
        Effect.flatMap(MediaDelivery, (d) => d.wallpaper('wall_1', { width: 1000, fit: 'fill' }))
      )
    ).toMatchObject({ _tag: 'Rejected' });
    expect(f.reads).toEqual(['original']);
    expect(f.resizes).toEqual([]);
  });
  it('treats an authorized picture with a missing object as unavailable', async () => {
    const f = fixture();
    f.loseOriginal();
    await expect(
      f.run(Effect.flatMap(MediaDelivery, (d) => d.picture('pic_1')))
    ).rejects.toMatchObject({ _tag: 'DeliveryUnavailable', operation: 'read_picture' });
  });
  it('uses the original missing dimension when choosing variants', async () => {
    const f = fixture();
    await f.run(
      Effect.flatMap(MediaDelivery, (d) => d.wallpaper('wall_1', { width: 500, fit: 'contain' }))
    );
    expect(f.queries).toEqual([[500, 1080]]);
    expect(f.reads).toEqual(['original', 'variant', 'variant']);
  });
  it('avoids selecting a variant when contain would upscale', async () => {
    const f = fixture();
    await f.run(
      Effect.flatMap(MediaDelivery, (d) => d.wallpaper('wall_1', { width: 2000, fit: 'contain' }))
    );
    expect(f.queries).toEqual([]);
    expect(f.reads).toEqual(['original', 'original']);
  });
  it('falls back to the original when a selected variant object is absent', async () => {
    const f = fixture();
    f.loseVariant();
    const outcome = await f.run(
      Effect.flatMap(MediaDelivery, (d) =>
        d.wallpaper('wall_1', { width: 500, height: 300, fit: 'cover' })
      )
    );
    expect(outcome._tag).toBe('Found');
    expect(f.reads).toEqual(['original', 'variant', 'original']);
  });
  it('verifies picture availability and returns fully read bytes', async () => {
    const f = fixture();
    const result = await f.run(Effect.flatMap(MediaDelivery, (d) => d.picture('pic_1')));
    expect(result._tag).toBe('Found');
    if (result._tag !== 'Found') throw new Error('expected picture');
    expect(result.fileSizeBytes).toBe(3);
    expect(result.mimeType).toBe('image/webp');
    f.deny();
    f.reads.length = 0;
    expect(await f.run(Effect.flatMap(MediaDelivery, (d) => d.picture('pic_1')))).toEqual({
      _tag: 'NotFound',
    });
    expect(f.reads).toEqual([]);
  });
  it('rejects excessive output dimensions before storage access', async () => {
    const f = fixture();
    expect(
      await f.run(
        Effect.flatMap(MediaDelivery, (d) => d.wallpaper('wall_1', { width: 20000, fit: 'fill' }))
      )
    ).toMatchObject({ _tag: 'Rejected' });
    expect(f.reads).toEqual([]);
  });
  it('delivers original bytes and exact metadata without resizing', async () => {
    const f = fixture();
    const outcome = await f.run(
      Effect.flatMap(MediaDelivery, (delivery) => delivery.wallpaper('wall_1'))
    );
    expect(outcome._tag).toBe('Found');
    if (outcome._tag !== 'Found') throw new Error('expected asset');
    expect(outcome.mimeType).toBe('image/png');
    expect(outcome.fileSizeBytes).toBe(3);
    const chunks = [];
    for await (const chunk of outcome.body) chunks.push(...chunk);
    expect(chunks).toEqual([1, 2, 3]);
    expect(f.reads).toEqual(['original']);
    expect(f.queries).toEqual([]);
  });
});
