import { createDefaultTesterBuilder, DockerTesterBuilder, S3TesterBuilder } from '@wallpaperdb/test-utils';
import { CreateBucketCommand, GetObjectCommand } from '@aws-sdk/client-s3';
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
    expect(variant).toMatchObject({ wallpaperId: input.wallpaperId, width: 72, height: 45,
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

  it('reports exact output pixels while keeping the preset target identity stable', async () => {
    const original = await sharp({ create: { width: 1280, height: 720, channels: 3, background: '#336699' } }).png().toBuffer();
    await tester.s3.uploadObject('originals', 'sixteen-nine.png', original);
    const value: GenerationInput = {
      ...input, wallpaperId: 'wlpr_exact_pixels', mimeType: 'image/png', width: 1280, height: 720,
      storage: { bucket: 'originals', key: 'sixteen-nine.png' },
    };
    const preset = { width: 854, height: 480, label: '480p' };
    const generate = VariantImages.use((images) => images.generate(value, preset));
    const variant = await runtime.runPromise(generate);
    const location = { bucket: variant.storageBucket, key: variant.storageKey };
    expect(location).toEqual({ bucket: 'originals', key: `${value.wallpaperId}/variant_854x480.png` });
    const object = await tester.s3.getS3Client().send(new GetObjectCommand({ Bucket: location.bucket, Key: location.key }));
    if (!object.Body) throw new Error('Missing stored variant');
    const bytes = await object.Body.transformToByteArray();
    const actual = await sharp(bytes).metadata();
    expect(actual).toMatchObject({ width: 853, height: 480 });
    expect(variant).toMatchObject({ width: actual.width, height: actual.height, aspectRatio: 853 / 480 });
    expect(await runtime.runPromise(generate)).toEqual(variant);
  });

  it('does not upscale smaller source pixels', async () => {
    const original = await sharp({ create: { width: 16, height: 10, channels: 3, background: '#ffffff' } }).png().toBuffer();
    await tester.s3.uploadObject('originals', 'source', original);
    const variant = await runtime.runPromise(Effect.gen(function* () {
      return yield* (yield* VariantImages).generate({ ...input, wallpaperId: 'wlpr_no_upscale', mimeType: 'image/png' }, { width: 80, height: 45, label: 'small' });
    }));
    const object = await tester.s3.getS3Client().send(new GetObjectCommand({ Bucket: 'originals', Key: variant.storageKey }));
    const bytes = await object.Body?.transformToByteArray();
    if (!bytes) throw new Error('Missing stored variant');
    expect(await sharp(bytes).metadata()).toMatchObject({ width: 16, height: 10 });
    expect(variant).toMatchObject({ width: 16, height: 10, aspectRatio: 1.6 });
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
  it('returns a typed failure for unsupported image formats without writing a variant', async () => {
    const key = 'unsupported-format';
    const original = await sharp({ create: { width: 160, height: 100, channels: 3, background: '#aa3377' } }).gif().toBuffer();
    expect(await sharp(original).metadata()).toMatchObject({ format: 'gif' });
    await tester.s3.uploadObject('originals', key, original);
    const result = await runtime.runPromise(Effect.result(Effect.gen(function* () {
      return yield* (yield* VariantImages).generate({ ...input, wallpaperId: 'wlpr_unsupported', mimeType: 'image/gif', storage: { bucket: 'originals', key } }, { width: 80, height: 45, label: 'small' });
    })));
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure._tag).toBe('GenerationUnavailable');
      expect(result.failure.operation).toBe('encode-image');
      expect(result.failure.cause).toBeInstanceOf(Error);
    }
    expect(await tester.s3.listObjects('originals', 'wlpr_unsupported/')).toEqual([]);
    expect(await tester.s3.listObjects('wallpapers', 'wlpr_unsupported/')).toEqual([]);
    expect(await tester.s3.objectExists('originals', key)).toBe(true);
  });
  it('checks configured storage health', async () => {
    expect(await runtime.runPromise(Effect.gen(function* () { return yield* (yield* ImageHealth).check(); }))).toBe(true);
  });
  it('generates logical variants without a descriptor bucket and replays their canonical objects', async () => {
    const original = await sharp({ create: { width: 160, height: 100, channels: 3, background: '#aa3377' } }).jpeg().toBuffer();
    const reference = { owner: 'ingestor', id: 'wlpr_logical_original' } as const;
    await tester.s3.uploadObject('wallpapers', `${reference.id}/original.jpg`, original);
    const generate = VariantImages.use((images) => images.generate({
      ...input, wallpaperId: reference.id, storage: reference,
    }, { width: 80, height: 45, label: 'small' }));
    const variant = await runtime.runPromise(generate);
    expect(variant).toMatchObject({ storageBucket: 'wallpapers', storageKey: `${reference.id}/variant_80x45.jpg`, width: 72, height: 45 });
    const object = await tester.s3.getS3Client().send(new GetObjectCommand({ Bucket: variant.storageBucket, Key: variant.storageKey }));
    if (!object.Body) throw new Error('Missing variant');
    expect(await sharp(await object.Body.transformToByteArray()).metadata()).toMatchObject({ width: 72, height: 45 });
    expect(await runtime.runPromise(generate)).toEqual(variant);
    expect(await runtime.runPromise(ImageHealth.use((health) => health.check()))).toBe(true);
  });
  it('reports unavailable object storage and recovers when the configured bucket is restored', async () => {
    const s3 = tester.getS3();
    const bucket = 'recovered-variant-storage';
    const isolated = ManagedRuntime.make(imageLayer({
      endpoint: s3.endpoints.fromHost, region: 'us-east-1',
      accessKeyId: s3.options.accessKey, secretAccessKey: s3.options.secretKey,
      bucket, jpegQuality: 83, pngCompressionLevel: 4, webpQuality: 76,
    }));
    try {
      expect(await isolated.runPromise(ImageHealth.use((health) => health.check()))).toBe(false);
      await tester.s3.getS3Client().send(new CreateBucketCommand({ Bucket: bucket }));
      expect(await isolated.runPromise(ImageHealth.use((health) => health.check()))).toBe(true);
    } finally { await isolated.dispose(); }
  });
});
