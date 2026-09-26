import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';
import { AssetReader, Catalog, ImageTransformer, MediaDelivery, PictureAuthority, deliveryLayer, type Wallpaper } from '../src/delivery/index.js';

const original: Wallpaper = { id: 'wall_1', storageBucket: 'media', storageKey: 'original', mimeType: 'image/png', fileSizeBytes: 3, width: 1920, height: 1080 };
function fixture() {
  const reads: string[] = [];
  const queries: number[][] = [];
  let allowed = true;
  let missingVariant = false;
  let missingOriginal = false;
  const dependencies = Layer.mergeAll(
    Layer.succeed(Catalog, { findWallpaper: () => Effect.succeed(original), findSmallestVariant: (_id, w, h) => { queries.push([w,h]); return Effect.succeed(w <= 960 && h <= 1080 ? { id: 'variant', storageBucket: 'media', storageKey: 'variant', width: 960, height: 1080 } : null); }, findCurrentPicture: () => Effect.succeed(original) }),
    Layer.succeed(AssetReader, { read: (asset) => { reads.push(asset.storageKey); if (missingOriginal && asset.storageKey === 'original') return Effect.succeed(null); if (missingVariant && asset.storageKey === 'variant') return Effect.succeed(null); return Effect.succeed(Object.assign((async function* () { yield new Uint8Array([1,2,3]); })(), { close() {} })); } }),
    Layer.succeed(PictureAuthority, { isAvailable: () => Effect.succeed(allowed) }),
    Layer.succeed(ImageTransformer, { resize: (body) => Effect.succeed(body) }),
  );
  return { reads, queries, loseOriginal: () => { missingOriginal = true; }, loseVariant: () => { missingVariant = true; }, deny: () => { allowed = false; }, run: <A,E>(effect: Effect.Effect<A,E,MediaDelivery>) => Effect.runPromise(effect.pipe(Effect.provide(deliveryLayer({ maxResizeWidth: 16384, maxResizeHeight: 16384, maxOutputPixels: 268435456 }).pipe(Layer.provide(dependencies))))) };
}
describe('media delivery', () => {
  it('treats an authorized picture with a missing object as unavailable', async () => {
    const f = fixture(); f.loseOriginal();
    await expect(f.run(Effect.flatMap(MediaDelivery, d => d.picture('pic_1')))).rejects.toMatchObject({ _tag: 'DeliveryUnavailable', operation: 'read_picture' });
  });
  it('uses the original missing dimension when choosing variants', async () => {
    const f = fixture();
    await f.run(Effect.flatMap(MediaDelivery, d => d.wallpaper('wall_1', { width: 500, fit: 'contain' })));
    expect(f.queries).toEqual([[500, 1080]]);
    expect(f.reads).toEqual(['variant']);
  });
  it('avoids selecting a variant when contain would upscale', async () => {
    const f = fixture();
    await f.run(Effect.flatMap(MediaDelivery, d => d.wallpaper('wall_1', { width: 2000, fit: 'contain' })));
    expect(f.queries).toEqual([]);
    expect(f.reads).toEqual(['original']);
  });
  it('falls back to the original when a selected variant object is absent', async () => {
    const f = fixture(); f.loseVariant();
    const outcome = await f.run(Effect.flatMap(MediaDelivery, d => d.wallpaper('wall_1', { width: 500, height: 300, fit: 'cover' })));
    expect(outcome._tag).toBe('Found');
    expect(f.reads).toEqual(['variant', 'original']);
  });
  it('verifies picture availability and returns fully read bytes', async () => {
    const f = fixture();
    const result = await f.run(Effect.flatMap(MediaDelivery, d => d.picture('pic_1')));
    expect(result._tag).toBe('Found');
    if (result._tag !== 'Found') throw new Error('expected picture');
    expect(result.fileSizeBytes).toBe(3);
    expect(result.mimeType).toBe('image/webp');
    f.deny(); f.reads.length = 0;
    expect(await f.run(Effect.flatMap(MediaDelivery, d => d.picture('pic_1')))).toEqual({ _tag: 'NotFound' });
    expect(f.reads).toEqual([]);
  });
  it('rejects excessive output dimensions before storage access', async () => {
    const f = fixture();
    expect(await f.run(Effect.flatMap(MediaDelivery, d => d.wallpaper('wall_1', { width: 20000, fit: 'fill' })))).toMatchObject({ _tag: 'Rejected' });
    expect(f.reads).toEqual([]);
  });
  it('delivers original bytes and exact metadata without resizing', async () => {
    const f = fixture();
    const outcome = await f.run(Effect.flatMap(MediaDelivery, delivery => delivery.wallpaper('wall_1')));
    expect(outcome._tag).toBe('Found');
    if (outcome._tag !== 'Found') throw new Error('expected asset');
    expect(outcome.mimeType).toBe('image/png');
    expect(outcome.fileSizeBytes).toBe(3);
    const chunks = []; for await (const chunk of outcome.body) chunks.push(...chunk);
    expect(chunks).toEqual([1,2,3]);
    expect(f.reads).toEqual(['original']);
    expect(f.queries).toEqual([]);
  });
});
