import { createDefaultTesterBuilder, DockerTesterBuilder, S3TesterBuilder } from '@wallpaperdb/test-utils';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { Effect, ManagedRuntime, Result } from 'effect';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ImageHealth, imageLayer } from '../src/adapters/image/index.js';
import { VariantImages, type GenerationInput } from '../src/generation/index.js';

const Tester = createDefaultTesterBuilder().with(DockerTesterBuilder).with(S3TesterBuilder).build();
const input: GenerationInput = {
  wallpaperId: 'wlpr_image_contract', fileType: 'image', mimeType: 'image/jpeg',
  width: 160, height: 100, storage: { bucket: 'originals', key: 'source' },
  occurrence: { source: 'test', id: 'image-contract' }, timestamp: '2026-01-01T00:00:00.000Z',
};

describe('Stored variant image adapter', () => {
  let tester: InstanceType<typeof Tester>;
  let runtime: ManagedRuntime.ManagedRuntime<VariantImages | ImageHealth, never>;
  beforeAll(async () => {
    tester = new Tester();
    tester.withS3().withS3Bucket('wallpapers').withS3Bucket('originals');
    await tester.setup();
    const s3 = tester.getS3();
    runtime = ManagedRuntime.make(imageLayer({
      endpoint: s3.endpoints.fromHost, region: 'us-east-1', accessKeyId: s3.options.accessKey,
      secretAccessKey: s3.options.secretKey, bucket: 'wallpapers', jpegQuality: 83,
      pngCompressionLevel: 4, webpQuality: 76,
    }));
  });
  afterAll(async () => { await runtime?.dispose(); await tester?.destroy(); });

  it.each(['jpeg', 'png', 'webp'] as const)('stores deterministic %s variants in the original bucket with unchanged encoding', async (format) => {
    const original = await sharp({ create: { width: 160, height: 100, channels: 3, background: '#aa3377' } }).toFormat(format).toBuffer();
    await tester.s3.uploadObject('originals', 'source', original);
    const mimeType = `image/${format}` as const;
    const preset = { width: 80, height: 45, label: 'small' };
    const variant = await runtime.runPromise(Effect.gen(function* () {
      return yield* (yield* VariantImages).generate({ ...input, mimeType }, preset);
    }));
    expect(variant).toMatchObject({ wallpaperId: input.wallpaperId, width: 80, height: 45,
      storageBucket: 'originals', storageKey: `${input.wallpaperId}/variant_80x45.${format === 'jpeg' ? 'jpg' : format}`,
      format: mimeType, createdAt: new Date(input.timestamp) });
    const object = await tester.s3.getS3Client().send(new GetObjectCommand({ Bucket: 'originals', Key: variant.storageKey }));
    const bytes = await object.Body?.transformToByteArray();
    expect(bytes).toBeDefined();
    if (!bytes) throw new Error('Missing stored variant');
    expect(object.ContentType).toBe(mimeType);
    expect(bytes.length).toBe(variant.fileSizeBytes);
    const metadata = await sharp(bytes).metadata();
    expect(metadata).toMatchObject({ width: 72, height: 45, format });
    const expected = sharp(original, { limitInputPixels: 268402689, sequentialRead: true, failOnError: false }).resize(80, 45, { fit: 'inside', withoutEnlargement: true });
    if (format === 'jpeg') expected.jpeg({ quality: 83, progressive: true });
    else if (format === 'png') expected.png({ compressionLevel: 4 });
    else expected.webp({ quality: 76 });
    expect(Buffer.from(bytes)).toEqual(await expected.toBuffer());
    const replay = await runtime.runPromise(Effect.gen(function* () {
      return yield* (yield* VariantImages).generate({ ...input, mimeType }, preset);
    }));
    expect(replay).toEqual(variant);
    expect(await tester.s3.objectExists('originals', 'source')).toBe(true);
  });

  it('does not upscale smaller source pixels', async () => {
    const original = await sharp({ create: { width: 16, height: 10, channels: 3, background: '#ffffff' } }).png().toBuffer();
    await tester.s3.uploadObject('originals', 'source', original);
    const variant = await runtime.runPromise(Effect.gen(function* () {
      return yield* (yield* VariantImages).generate({ ...input, mimeType: 'image/png' }, { width: 80, height: 45, label: 'small' });
    }));
    const object = await tester.s3.getS3Client().send(new GetObjectCommand({ Bucket: 'originals', Key: variant.storageKey }));
    const bytes = await object.Body?.transformToByteArray();
    if (!bytes) throw new Error('Missing stored variant');
    expect(await sharp(bytes).metadata()).toMatchObject({ width: 16, height: 10 });
  });

  it.each(['missing', 'corrupt'])('returns typed failure for %s originals', async (key) => {
    if (key === 'corrupt') await tester.s3.uploadObject('originals', key, Buffer.from('invalid image'));
    const result = await runtime.runPromise(Effect.result(Effect.gen(function* () {
      return yield* (yield* VariantImages).generate({ ...input, storage: { bucket: 'originals', key } }, { width: 80, height: 45, label: 'small' });
    })));
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure._tag).toBe('GenerationUnavailable');
  });
  it('rejects originals above the accepted 50 MiB storage limit', async () => {
    await tester.s3.uploadObject('originals', 'oversized', Buffer.alloc(50 * 1024 * 1024 + 1));
    const result = await runtime.runPromise(Effect.result(Effect.gen(function* () {
      return yield* (yield* VariantImages).generate({ ...input, storage: { bucket: 'originals', key: 'oversized' } }, { width: 80, height: 45, label: 'small' });
    })));
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure.operation).toBe('read-image');
  });
  it('checks configured storage health', async () => {
    expect(await runtime.runPromise(Effect.gen(function* () { return yield* (yield* ImageHealth).check(); }))).toBe(true);
  });
});
