import { Effect, Layer, ManagedRuntime } from 'effect';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { orientationFixture, samplePixelGrid } from '@wallpaperdb/test-utils/fixtures';
import { sharpTransformerLayer } from '../src/adapters/assets/index.js';
import {
  AssetReader,
  Catalog,
  MediaDelivery,
  PictureAuthority,
  deliveryLayer,
  type DeliveryLimits,
  type ResizeOptions,
} from '../src/capabilities/delivery/index.js';

async function request(
  input: Buffer,
  options: ResizeOptions | undefined,
  limits: Partial<DeliveryLimits> = {},
  variant?: Buffer,
  missingOriginal = false
) {
  const stored = Buffer.from(input);
  const runtime = ManagedRuntime.make(
    deliveryLayer({
      maxResizeWidth: 7680,
      maxResizeHeight: 4320,
      maxOutputPixels: 33177600,
      ...limits,
    }).pipe(
      Layer.provide(
        Layer.mergeAll(
          sharpTransformerLayer({ maxInputPixels: 268402689 }),
          Layer.succeed(Catalog, {
            // Existing rows contain the raw dimensions. No ingestion or catalog rewrite.
            findWallpaper: () =>
              Effect.succeed({
                id: 'oriented',
                storageBucket: 'owned-fixtures',
                storageKey: 'original',
                width: 120,
                height: 80,
                fileSizeBytes: input.length,
                mimeType: 'image/png',
              }),
            findSmallestVariant: () =>
              Effect.succeed(
                variant
                  ? {
                      id: 'nominal-variant',
                      storageBucket: 'owned-fixtures',
                      storageKey: 'variant',
                      width: 60,
                      height: 80,
                    }
                  : null
              ),
            findCurrentPicture: () => Effect.succeed(null),
          }),
          Layer.succeed(AssetReader, {
            read: (asset) =>
              asset.storageKey === 'original' && missingOriginal
                ? Effect.succeed(null)
                : Effect.succeed({
                    close() {},
                    async *[Symbol.asyncIterator]() {
                      const bytes = asset.storageKey === 'variant' ? variant : input;
                      if (!bytes) throw new Error('Missing controlled image');
                      yield bytes;
                    },
                  }),
          }),
          Layer.succeed(PictureAuthority, { isAvailable: () => Effect.succeed(false) })
        )
      )
    )
  );
  try {
    const result = await runtime.runPromise(
      MediaDelivery.use((d) => d.wallpaper('oriented', options))
    );
    if (result._tag !== 'Found') return result;
    const chunks = [];
    for await (const chunk of result.body) chunks.push(chunk);
    expect(input).toEqual(stored);
    return { ...result, bytes: Buffer.concat(chunks) };
  } finally {
    expect(input).toEqual(stored);
    await runtime.dispose();
  }
}

describe('stored source geometry and real native output', () => {
  it('rejects the reviewed width40 request when its actual oriented height exceeds 50', async () => {
    const result = await request(
      await orientationFixture('png', 6),
      { width: 40, fit: 'contain' },
      { maxResizeHeight: 50 }
    );
    expect(result).toMatchObject({ _tag: 'Rejected' });
  });
  describe.each([5, 6, 7, 8])('swapped orientation %s', (orientation) => {
    it.each([
      { name: 'height cap', options: { width: 40 }, limits: { maxResizeHeight: 50 } },
      { name: 'width cap', options: { height: 40 }, limits: { maxResizeWidth: 25 } },
      { name: 'pixel budget', options: { width: 40 }, limits: { maxOutputPixels: 2399 } },
    ])('rejects the actual output beyond the $name', async ({ options, limits }) => {
      expect(
        await request(
          await orientationFixture('png', orientation),
          { ...options, fit: 'contain' },
          limits
        )
      ).toMatchObject({ _tag: 'Rejected' });
    });
    it('admits a valid height-only request and emits the dimensions admission used', async () => {
      const result = await request(
        await orientationFixture('png', orientation),
        { height: 40, fit: 'contain' },
        { maxResizeWidth: 30, maxResizeHeight: 50, maxOutputPixels: 1080 }
      );
      if (result._tag !== 'Found') throw new Error('Expected an admitted derivative');
      expect(await sharp(result.bytes).metadata()).toMatchObject({ width: 27, height: 40 });
      expect((await sharp(result.bytes).metadata()).exif).toBeUndefined();
    });
  });
  it('applies oriented no-enlargement geometry and keeps the six expected color blocks', async () => {
    const result = await request(await orientationFixture('png', 6), {
      width: 100,
      fit: 'contain',
    });
    if (result._tag !== 'Found') throw new Error('Expected derivative');
    expect(await sharp(result.bytes).metadata()).toMatchObject({ width: 80, height: 120 });
    expect(await samplePixelGrid(result.bytes, 2, 3)).toEqual([
      [
        [255, 255, 0],
        [255, 0, 0],
      ],
      [
        [255, 0, 255],
        [0, 255, 0],
      ],
      [
        [0, 255, 255],
        [0, 0, 255],
      ],
    ]);
  });
  it('preserves exact original bytes for unchanged and displayed-size original delivery', async () => {
    const input = await orientationFixture('png', 6);
    for (const options of [undefined, { width: 80, height: 120, fit: 'contain' as const }]) {
      const result = await request(input, options, { maxResizeWidth: 50, maxResizeHeight: 50 });
      if (result._tag !== 'Found') throw new Error('Expected original');
      expect(result.bytes).toEqual(input);
      expect(result.fileSizeBytes).toBe(input.length);
    }
  });
  it('transforms a raw-size match instead of bypassing displayed geometry', async () => {
    const result = await request(await orientationFixture('png', 6), {
      width: 120,
      height: 80,
      fit: 'contain',
    });
    if (result._tag !== 'Found') throw new Error('Expected derivative');
    expect(await sharp(result.bytes).metadata()).toMatchObject({ width: 53, height: 80 });
    expect((await sharp(result.bytes).metadata()).orientation).toBeUndefined();
    expect(result.fileSizeBytes).toBeUndefined();
  });
  it.each([
    'orientation tag',
    'nominal bounds',
  ] as const)('rechecks actual variant geometry and safely falls back for %s', async (kind) => {
    const candidate = await orientationFixture('png', 6);
    const variant =
      kind === 'orientation tag' ? candidate : await sharp(candidate).rotate().png().toBuffer();
    const result = await request(
      await orientationFixture('png', 'absent'),
      { width: 40, fit: 'contain' },
      { maxResizeHeight: 50 },
      variant
    );
    if (result._tag !== 'Found') throw new Error('Expected a safe original fallback');
    expect(await sharp(result.bytes).metadata()).toMatchObject({ width: 40, height: 27 });
    expect((await sharp(result.bytes).metadata()).exif).toBeUndefined();
  });
  it('delivers retained variant bytes when its original object is absent', async () => {
    const input = await orientationFixture('png', 'absent');
    const variant = await sharp(input).resize(60, 40).png().toBuffer();
    const result = await request(
      input,
      { width: 60, height: 40, fit: 'contain' },
      {},
      variant,
      true
    );
    if (result._tag !== 'Found') throw new Error('Expected retained variant');
    expect(result.bytes).toEqual(variant);
  });
  it.each([
    { options: { width: 40 }, limits: { maxResizeHeight: 50 }, outcome: 'Rejected' },
    { options: { width: 40 }, limits: { maxOutputPixels: 2399 }, outcome: 'Rejected' },
    {
      options: { height: 40 },
      limits: { maxResizeWidth: 30, maxResizeHeight: 50, maxOutputPixels: 1080 },
      outcome: 'Found',
    },
  ])('uses actual retained-variant geometry when the original is missing: %j', async ({
    options,
    limits,
    outcome,
  }) => {
    const result = await request(
      await orientationFixture('png', 'absent'),
      { ...options, fit: 'contain' },
      limits,
      await orientationFixture('png', 6),
      true
    );
    expect(result._tag).toBe(outcome);
    if (result._tag === 'Found') {
      expect(await sharp(result.bytes).metadata()).toMatchObject({ width: 27, height: 40 });
      expect((await sharp(result.bytes).metadata()).exif).toBeUndefined();
    }
  });
});
