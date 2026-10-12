import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';
import { AvailabilityProbe, availabilityLayer } from '../src/capabilities/availability/index.js';
import {
  AssetReader,
  Catalog,
  ImageTransformer,
  MediaDelivery,
  PictureAuthority,
  deliveryLayer,
  type AssetBody,
  type ResizeOptions,
  type Variant,
  type Wallpaper,
} from '../src/capabilities/delivery/index.js';
import { createHttpApp } from '../src/http/index.js';

function body(value: string): AssetBody {
  return {
    close() {},
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(value);
    },
  };
}
async function text(stream: AssetBody) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString();
}

function fixture() {
  const source: Wallpaper = {
    id: 'wallpaper',
    storageBucket: 'sources',
    storageKey: 'original',
    width: 3840,
    height: 2160,
    mimeType: 'image/jpeg',
    fileSizeBytes: 8,
  };
  const wallpapers = new Map([[source.id, source]]);
  const renditions = new Map<string, Array<Variant>>();
  const objects = new Map([['sources/original', 'original']]);
  const reads: string[] = [];
  const resizes: Array<ResizeOptions & { mimeType: string; input: string }> = [];
  const dependencies = Layer.mergeAll(
    Layer.succeed(Catalog, {
      findWallpaper: (id) => Effect.succeed(wallpapers.get(id) ?? null),
      findSmallestVariant: (id, width, height) =>
        Effect.succeed(
          (renditions.get(id) ?? [])
            .filter((r) => r.width >= width && r.height >= height)
            .sort((a, b) => a.width * a.height - b.width * b.height)[0] ?? null
        ),
      findCurrentPicture: () => Effect.succeed(null),
    }),
    Layer.succeed(AssetReader, {
      read: (asset) =>
        Effect.sync(() => {
          const key = `${asset.storageBucket}/${asset.storageKey}`;
          reads.push(key);
          const value = objects.get(key);
          return value === undefined ? null : body(value);
        }),
    }),
    Layer.succeed(ImageTransformer, {
      resize: (input, options) =>
        Effect.promise(async () => {
          const value = await text(input);
          resizes.push({ ...options, input: value });
          return body(`resized ${value}`);
        }),
    }),
    Layer.succeed(PictureAuthority, { isAvailable: () => Effect.succeed(false) })
  );
  const delivery = deliveryLayer({
    maxResizeWidth: 7680,
    maxResizeHeight: 4320,
    maxOutputPixels: 33177600,
  }).pipe(Layer.provide(dependencies));
  const health = availabilityLayer.pipe(
    Layer.provide(
      Layer.succeed(AvailabilityProbe, {
        inspect: () =>
          Effect.succeed({ database: true, s3: true, nats: true, consumer: true, otel: true }),
      })
    )
  );
  return {
    source,
    wallpapers,
    renditions,
    objects,
    reads,
    resizes,
    addRendition(width: number, height: number, key: string, present = true) {
      const rendition = { id: key, storageBucket: 'renditions', storageKey: key, width, height };
      renditions.set(source.id, [...(renditions.get(source.id) ?? []), rendition]);
      if (present) objects.set(`renditions/${key}`, key);
    },
    request: (options?: ResizeOptions) =>
      Effect.runPromise(
        MediaDelivery.use((d) => d.wallpaper(source.id, options)).pipe(Effect.provide(delivery))
      ),
    app: () => createHttpApp({ nodeEnv: 'test', port: 0 }, Layer.merge(health, delivery)),
  };
}

describe('resize HTTP validation', () => {
  it.each([
    ['w=1920', { width: 1920, fit: 'contain' }],
    ['h=1080', { height: 1080, fit: 'contain' }],
    ['fit=cover', undefined],
    ['w=1920&h=1080', { width: 1920, height: 1080, fit: 'contain' }],
    ['w=800&h=600&fit=cover', { width: 800, height: 600, fit: 'cover' }],
    ['w=1200&h=800&fit=fill', { width: 1200, height: 800, fit: 'fill' }],
  ] as const)('accepts %s and defaults omitted fit', async (query, options) => {
    const f = fixture();
    const app = await f.app();
    try {
      expect((await app.inject(`/wallpapers/wallpaper?${query}`)).statusCode).toBe(200);
      if (options) expect(f.resizes).toMatchObject([options]);
      else expect(f.resizes).toEqual([]);
      expect((await app.inject(`/wallpapers/unknown?${query}`)).statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
  it.each([
    'w=0',
    'w=7681',
    'h=0',
    'h=4321',
    'fit=stretch',
  ])('rejects %s with invalid-dimensions before storage', async (query) => {
    const f = fixture();
    const app = await f.app();
    try {
      const response = await app.inject(`/wallpapers/wallpaper?${query}`);
      expect(response.statusCode).toBe(400);
      expect(response.json().type).toContain('/invalid-dimensions.md');
      expect(f.reads).toEqual([]);
      expect(f.resizes).toEqual([]);
    } finally {
      await app.close();
    }
  });
  it.each([
    'image/jpeg',
    'image/png',
    'image/webp',
  ])('streams %s resized bytes with immutable caching and no Content-Length', async (mimeType) => {
    const f = fixture();
    f.wallpapers.set(f.source.id, { ...f.source, mimeType });
    const app = await f.app();
    try {
      const resized = await app.inject('/wallpapers/wallpaper?w=960');
      expect(resized.statusCode).toBe(200);
      expect(resized.body).toBe('resized original');
      expect(resized.headers['content-type']).toBe(mimeType);
      expect(resized.headers['cache-control']).toBe('public, max-age=31536000, immutable');
      expect(resized.headers['content-length']).toBeUndefined();
      expect(f.resizes).toMatchObject([
        { width: 960, fit: 'contain', mimeType, input: 'original' },
      ]);
      const original = await app.inject('/wallpapers/wallpaper');
      expect(original.statusCode).toBe(200);
      expect(original.body).toBe('original');
      expect(original.headers['content-length']).toBe('8');
    } finally {
      await app.close();
    }
  });
});

describe('rendition source selection', () => {
  it.each([
    { name: 'exact', width: 1920, height: 1080, key: 'medium', resized: false },
    { name: 'between sizes', width: 1600, height: 900, key: 'medium', resized: true },
    { name: 'above all renditions', width: 2560, height: 1440, key: 'original', resized: true },
  ])('uses the smallest suitable materialized rendition for $name', async ({
    width,
    height,
    key,
    resized,
  }) => {
    const f = fixture();
    // Deliberately insert out of order, with decoys that satisfy only one dimension.
    if (key !== 'original') f.addRendition(2560, 1440, 'large');
    f.addRendition(1280, 720, 'small');
    f.addRendition(1920, 1080, 'medium');
    f.addRendition(4000, 100, 'too-short');
    f.addRendition(100, 4000, 'too-narrow');
    f.renditions.set('other-wallpaper', [
      { id: 'other', storageBucket: 'renditions', storageKey: 'other', width: 1920, height: 1080 },
    ]);
    const result = await f.request({ width, height, fit: 'contain' });
    expect(result._tag).toBe('Found');
    if (result._tag !== 'Found') throw new Error('expected rendition');
    expect(await text(result.body)).toBe(resized ? `resized ${key}` : key);
    expect(f.reads).toEqual([key === 'original' ? 'sources/original' : `renditions/${key}`]);
    expect(f.resizes).toEqual(
      resized ? [{ width, height, fit: 'contain', mimeType: 'image/jpeg', input: key }] : []
    );
  });
  it('resizes the source when no materialized renditions exist', async () => {
    const f = fixture();
    const result = await f.request({ width: 1920, fit: 'contain' });
    expect(result._tag).toBe('Found');
    if (result._tag !== 'Found') throw new Error('expected rendition');
    expect(await text(result.body)).toBe('resized original');
    expect(f.reads).toEqual(['sources/original']);
  });
  it('falls back after a materialized object disappears and reports absence when both objects are gone', async () => {
    const f = fixture();
    f.addRendition(1920, 1080, 'medium');
    f.objects.delete('renditions/medium');
    const options = { width: 1920, height: 1080, fit: 'contain' } as const;
    const result = await f.request(options);
    expect(result._tag).toBe('Found');
    if (result._tag !== 'Found') throw new Error('expected fallback');
    expect(await text(result.body)).toBe('resized original');
    expect(f.reads).toEqual(['renditions/medium', 'sources/original']);
    expect(f.resizes).toEqual([{ ...options, mimeType: 'image/jpeg', input: 'original' }]);
    f.objects.delete('sources/original');
    expect(await f.request(options)).toEqual({ _tag: 'NotFound' });
    expect(f.reads.slice(2)).toEqual(['renditions/medium', 'sources/original']);
    expect(f.resizes).toHaveLength(1);
  });
  it.each([
    { width: 5000, height: 3000, fit: 'contain' },
    { width: 5000, fit: 'contain' },
    { width: 5000, height: 3000, fit: 'cover' },
  ] as const)('uses the source rather than a smaller rendition when upscaling is prohibited: %j', async (options) => {
    const f = fixture();
    f.addRendition(1920, 1080, 'medium');
    expect((await f.request(options))._tag).toBe('Found');
    expect(f.reads).toEqual(['sources/original']);
    expect(f.resizes).toEqual([{ ...options, mimeType: 'image/jpeg', input: 'original' }]);
  });
  it('passes fill upscaling through to the image adapter', async () => {
    const f = fixture();
    expect((await f.request({ width: 5000, height: 3000, fit: 'fill' }))._tag).toBe('Found');
    expect(f.resizes).toEqual([
      { width: 5000, height: 3000, fit: 'fill', mimeType: 'image/jpeg', input: 'original' },
    ]);
  });
});
